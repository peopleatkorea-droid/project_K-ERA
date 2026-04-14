from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pandas as pd


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def local_metadata_backup_db_paths(store: Any) -> list[Path]:
    bundle_root = store._storage_bundle_root()
    if not bundle_root.exists():
        return []
    current_db_path = store._current_data_plane_db_path()
    candidates: list[Path] = []
    for path in sorted(bundle_root.glob("kera*.db"), key=lambda item: item.stat().st_mtime, reverse=True):
        resolved_path = path.resolve()
        if current_db_path is not None and resolved_path == current_db_path:
            continue
        if not resolved_path.is_file():
            continue
        candidates.append(resolved_path)
    return candidates


def storage_bundle_root(store: Any) -> Path:
    site_parent = store.site_dir.parent.resolve()
    if site_parent.name.strip().lower() == "sites":
        return site_parent.parent.resolve()
    return site_parent


def _sqlite_database_path(database_url: str) -> Path | None:
    normalized = str(database_url or "").strip()
    if not normalized.startswith("sqlite:///"):
        return None
    raw_path = unquote(normalized[len("sqlite:///") :]).strip()
    if not raw_path or raw_path == ":memory:":
        return None
    if os.name == "nt" and raw_path.startswith("/") and len(raw_path) >= 3 and raw_path[2] == ":":
        raw_path = raw_path[1:]
    return Path(raw_path)


def current_data_plane_db_path(store: Any) -> Path | None:
    dp = _deps()
    return _sqlite_database_path(dp.DATA_PLANE_DATABASE_URL)


def clear_site_metadata_rows(store: Any) -> None:
    dp = _deps()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.delete(dp.db_images).where(dp.db_images.c.site_id == store.site_id))
        conn.execute(dp.delete(dp.db_visits).where(dp.db_visits.c.site_id == store.site_id))
        conn.execute(dp.delete(dp.db_patients).where(dp.db_patients.c.site_id == store.site_id))


def load_patient_metadata_snapshot_from_db(
    store: Any,
    db_path: Path,
    patient_id: str,
) -> dict[str, Any] | None:
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        try:
            patient_row = conn.execute(
                "select * from patients where site_id=? and patient_id=?",
                (store.site_id, patient_id),
            ).fetchone()
        except sqlite3.OperationalError:
            return None
        if patient_row is None:
            return None
        visit_rows = conn.execute(
            "select * from visits where site_id=? and patient_id=? order by visit_index, visit_date, created_at",
            (store.site_id, patient_id),
        ).fetchall()
        image_rows = conn.execute(
            "select * from images where site_id=? and patient_id=? order by uploaded_at, image_path",
            (store.site_id, patient_id),
        ).fetchall()
        if not visit_rows or not image_rows:
            return None
        return {
            "patient": dict(patient_row),
            "visits": [dict(row) for row in visit_rows],
            "images": [dict(row) for row in image_rows],
        }
    finally:
        conn.close()


def patient_snapshot_is_richer_than_placeholder(store: Any, snapshot: dict[str, Any] | None) -> bool:
    dp = _deps()
    if not snapshot:
        return False
    patient_row = snapshot.get("patient", {}) or {}
    sex_value = str(patient_row.get("sex") or "").strip().lower()
    age_value = dp._coerce_optional_int(patient_row.get("age"), 0)
    if sex_value and sex_value != "unknown":
        return True
    if age_value > 0:
        return True
    for visit_row in snapshot.get("visits", []) or []:
        if dp._derive_culture_status(
            visit_row.get("culture_status"),
            visit_row.get("culture_confirmed"),
            visit_row.get("culture_category"),
            visit_row.get("culture_species"),
        ) == "positive":
            return True
        if str(visit_row.get("research_registry_source") or "").strip().lower() != dp._PLACEHOLDER_SYNC_SOURCE:
            return True
    return False


def normalize_snapshot_image_paths(store: Any, rows: list[dict[str, Any]]) -> set[str]:
    normalized_paths: set[str] = set()
    for row in rows:
        resolved_path, _ = store._resolve_site_runtime_path(row.get("image_path"), require_exists=False)
        normalized_paths.add(str(resolved_path.resolve()))
    return normalized_paths


def find_matching_richer_metadata_snapshot(
    store: Any,
    patient_id: str,
    expected_image_paths: set[str],
) -> dict[str, Any] | None:
    if not expected_image_paths:
        return None
    for db_path in store._local_metadata_backup_db_paths():
        snapshot = store._load_patient_metadata_snapshot_from_db(db_path, patient_id)
        if not store._patient_snapshot_is_richer_than_placeholder(snapshot):
            continue
        snapshot_image_paths = store._normalize_snapshot_image_paths(snapshot.get("images", []) or [])
        if snapshot_image_paths != expected_image_paths:
            continue
        return snapshot
    return None


def restore_placeholder_metadata_from_snapshot(store: Any, snapshot: dict[str, Any]) -> dict[str, int]:
    dp = _deps()
    patient_row = snapshot.get("patient", {}) or {}
    patient_id = dp._coerce_optional_text(patient_row.get("patient_id"))
    if not patient_id:
        return {"patients": 0, "visits": 0, "images": 0}

    restored = {"patients": 0, "visits": 0, "images": 0}
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        patient_update = conn.execute(
            dp.update(dp.db_patients)
            .where(dp.and_(dp.db_patients.c.site_id == store.site_id, dp.db_patients.c.patient_id == patient_id))
            .values(
                sex=patient_row.get("sex"),
                age=patient_row.get("age"),
                chart_alias=patient_row.get("chart_alias"),
                local_case_code=patient_row.get("local_case_code"),
                created_at=patient_row.get("created_at"),
                created_by_user_id=patient_row.get("created_by_user_id"),
            )
        )
        restored["patients"] += int(patient_update.rowcount or 0)

        for visit_row in snapshot.get("visits", []) or []:
            normalized_culture = dp._normalize_visit_culture_fields(
                culture_status=visit_row.get("culture_status"),
                culture_confirmed=visit_row.get("culture_confirmed"),
                culture_category=visit_row.get("culture_category"),
                culture_species=visit_row.get("culture_species"),
                additional_organisms=list(visit_row.get("additional_organisms") or []),
                polymicrobial=visit_row.get("polymicrobial"),
            )
            visit_update = conn.execute(
                dp.update(dp.db_visits)
                .where(
                    dp.and_(
                        dp.db_visits.c.site_id == store.site_id,
                        dp.db_visits.c.patient_id == patient_id,
                        dp.db_visits.c.visit_date == dp._coerce_optional_text(visit_row.get("visit_date")),
                    )
                )
                .values(
                    **normalized_culture,
                    contact_lens_use=visit_row.get("contact_lens_use"),
                    predisposing_factor=visit_row.get("predisposing_factor"),
                    other_history=visit_row.get("other_history"),
                    visit_status=visit_row.get("visit_status"),
                    active_stage=visit_row.get("active_stage"),
                    smear_result=visit_row.get("smear_result"),
                    created_at=visit_row.get("created_at"),
                    is_initial_visit=visit_row.get("is_initial_visit"),
                    created_by_user_id=visit_row.get("created_by_user_id"),
                    actual_visit_date=visit_row.get("actual_visit_date"),
                    research_registry_status=visit_row.get("research_registry_status"),
                    research_registry_updated_at=visit_row.get("research_registry_updated_at"),
                    research_registry_updated_by=visit_row.get("research_registry_updated_by"),
                    research_registry_source=visit_row.get("research_registry_source"),
                    patient_reference_id=visit_row.get("patient_reference_id"),
                    visit_index=visit_row.get("visit_index"),
                )
            )
            restored["visits"] += int(visit_update.rowcount or 0)

        for image_row in snapshot.get("images", []) or []:
            resolved_path, _ = store._resolve_site_runtime_path(image_row.get("image_path"), require_exists=False)
            image_update = conn.execute(
                dp.update(dp.db_images)
                .where(
                    dp.and_(
                        dp.db_images.c.site_id == store.site_id,
                        dp.db_images.c.patient_id == patient_id,
                        dp.db_images.c.visit_date == dp._coerce_optional_text(image_row.get("visit_date")),
                        dp.db_images.c.image_path == str(resolved_path.resolve()),
                    )
                )
                .values(
                    view=image_row.get("view"),
                    is_representative=image_row.get("is_representative"),
                    uploaded_at=image_row.get("uploaded_at"),
                    lesion_prompt_box=image_row.get("lesion_prompt_box"),
                    created_by_user_id=image_row.get("created_by_user_id"),
                    has_lesion_box=image_row.get("has_lesion_box"),
                    has_roi_crop=image_row.get("has_roi_crop"),
                    has_medsam_mask=image_row.get("has_medsam_mask"),
                    has_lesion_crop=image_row.get("has_lesion_crop"),
                    has_lesion_mask=image_row.get("has_lesion_mask"),
                    artifact_status_updated_at=image_row.get("artifact_status_updated_at"),
                    quality_scores=image_row.get("quality_scores"),
                )
            )
            restored["images"] += int(image_update.rowcount or 0)
    return restored


def restore_placeholder_metadata_from_local_backups(store: Any) -> dict[str, int]:
    dp = _deps()
    restored = {"patients": 0, "visits": 0, "images": 0}
    candidate_query = (
        dp.select(dp.db_patients.c.patient_id)
        .join(
            dp.db_visits,
            dp.and_(
                dp.db_patients.c.site_id == dp.db_visits.c.site_id,
                dp.db_patients.c.patient_id == dp.db_visits.c.patient_id,
            ),
        )
        .where(
            dp.and_(
                dp.db_patients.c.site_id == store.site_id,
                dp.db_patients.c.sex == "unknown",
                dp.db_patients.c.age == 0,
                dp.db_visits.c.culture_status != "positive",
                dp.db_visits.c.research_registry_source == dp._PLACEHOLDER_SYNC_SOURCE,
            )
        )
        .group_by(dp.db_patients.c.patient_id)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        candidate_patient_ids = [
            dp._coerce_optional_text(row[0])
            for row in conn.execute(candidate_query).all()
            if dp._coerce_optional_text(row[0])
        ]
    for patient_id in candidate_patient_ids:
        with dp.DATA_PLANE_ENGINE.begin() as conn:
            visit_rows = conn.execute(
                dp.select(
                    dp.db_visits.c.culture_status,
                    dp.db_visits.c.culture_confirmed,
                    dp.db_visits.c.research_registry_source,
                ).where(dp.and_(dp.db_visits.c.site_id == store.site_id, dp.db_visits.c.patient_id == patient_id))
            ).mappings().all()
            image_rows = conn.execute(
                dp.select(dp.db_images.c.image_path).where(dp.and_(dp.db_images.c.site_id == store.site_id, dp.db_images.c.patient_id == patient_id))
            ).mappings().all()
        if not visit_rows:
            continue
        if any(
            dp._derive_culture_status(
                visit.get("culture_status"),
                visit.get("culture_confirmed"),
                None,
                None,
            ) == "positive"
            for visit in visit_rows
        ):
            continue
        if any(
            str(visit.get("research_registry_source") or "").strip().lower() != dp._PLACEHOLDER_SYNC_SOURCE
            for visit in visit_rows
        ):
            continue
        expected_image_paths = {
            str(store._resolve_site_runtime_path(row.get("image_path"), require_exists=False)[0].resolve())
            for row in image_rows
        }
        snapshot = store._find_matching_richer_metadata_snapshot(patient_id, expected_image_paths)
        if snapshot is None:
            continue
        result = store._restore_placeholder_metadata_from_snapshot(snapshot)
        restored["patients"] += result["patients"]
        restored["visits"] += result["visits"]
        restored["images"] += result["images"]
    return restored


def sync_raw_inventory_metadata(store: Any) -> dict[str, Any]:
    dp = _deps()
    store._repair_missing_image_paths_if_due(force=True)
    restored_from_backup = store._restore_placeholder_metadata_from_local_backups()
    if not store.raw_dir.exists():
        return {
            "site_id": store.site_id,
            "scanned_patients": 0,
            "scanned_visits": 0,
            "scanned_images": 0,
            "created_patients": 0,
            "created_visits": 0,
            "created_images": 0,
            "skipped_existing_images": 0,
            "skipped_invalid_patients": 0,
            "skipped_invalid_visits": 0,
            "restored_patients": restored_from_backup["patients"],
            "restored_visits": restored_from_backup["visits"],
            "restored_images": restored_from_backup["images"],
        }

    patient_records: list[dict[str, Any]] = []
    visit_records: list[dict[str, Any]] = []
    image_records: list[dict[str, Any]] = []
    scanned_patients = 0
    scanned_visits = 0
    scanned_images = 0
    skipped_existing_images = 0
    skipped_invalid_patients = 0
    skipped_invalid_visits = 0

    with dp.DATA_PLANE_ENGINE.begin() as conn:
        existing_patient_ids = {
            str(row[0] or "").strip()
            for row in conn.execute(dp.select(dp.db_patients.c.patient_id).where(dp.db_patients.c.site_id == store.site_id)).all()
            if str(row[0] or "").strip()
        }
        existing_visits_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for row in conn.execute(
            dp.select(dp.db_visits.c.visit_id, dp.db_visits.c.patient_id, dp.db_visits.c.visit_date).where(
                dp.db_visits.c.site_id == store.site_id
            )
        ).mappings():
            patient_id = str(row["patient_id"] or "").strip()
            visit_date = str(row["visit_date"] or "").strip()
            if not patient_id or not visit_date:
                continue
            existing_visits_by_key[(patient_id, visit_date)] = {
                "visit_id": str(row["visit_id"] or "").strip(),
                "has_representative": False,
            }

        existing_image_paths: set[str] = set()
        existing_image_keys: set[tuple[str, str, str]] = set()
        representative_visit_ids: set[str] = set()
        for row in conn.execute(
            dp.select(
                dp.db_images.c.visit_id,
                dp.db_images.c.patient_id,
                dp.db_images.c.visit_date,
                dp.db_images.c.image_path,
                dp.db_images.c.is_representative,
            ).where(dp.db_images.c.site_id == store.site_id)
        ).mappings():
            patient_id = str(row["patient_id"] or "").strip()
            visit_date = str(row["visit_date"] or "").strip()
            resolved_path, _ = store._resolve_site_runtime_path(row["image_path"], require_exists=False)
            resolved_path = resolved_path.resolve()
            existing_image_paths.add(str(resolved_path))
            existing_image_keys.add((patient_id, visit_date, resolved_path.name.lower()))
            if bool(row.get("is_representative")):
                representative_visit_ids.add(str(row["visit_id"] or "").strip())
        for visit_state in existing_visits_by_key.values():
            visit_state["has_representative"] = str(visit_state.get("visit_id") or "").strip() in representative_visit_ids

    scan_timestamp = dp.utc_now()
    for patient_dir in sorted((path for path in store.raw_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
        raw_patient_id = str(patient_dir.name or "").strip()
        if not raw_patient_id:
            continue
        try:
            normalized_patient_id = dp.normalize_patient_pseudonym(raw_patient_id)
        except ValueError:
            skipped_invalid_patients += 1
            continue
        scanned_patients += 1
        patient_visit_images: dict[str, list[Path]] = {}
        for visit_dir in sorted((path for path in patient_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
            raw_visit_label = str(visit_dir.name or "").strip()
            if not raw_visit_label:
                continue
            try:
                normalized_visit_date = dp.normalize_visit_label(raw_visit_label)
            except ValueError:
                continue
            visit_images = sorted(
                (
                    image_path
                    for image_path in visit_dir.rglob("*")
                    if image_path.is_file() and image_path.suffix.lower() in dp._RAW_INVENTORY_IMAGE_EXTENSIONS
                ),
                key=lambda path: (str(path.parent).lower(), path.name.lower()),
            )
            if visit_images:
                patient_visit_images[normalized_visit_date] = visit_images

        if normalized_patient_id not in existing_patient_ids:
            expected_image_paths = {
                str(image_path.resolve())
                for visit_images in patient_visit_images.values()
                for image_path in visit_images
            }
            richer_snapshot = store._find_matching_richer_metadata_snapshot(
                normalized_patient_id,
                expected_image_paths,
            )
            if richer_snapshot is not None:
                patient_row = dict(richer_snapshot["patient"])
                patient_records.append(patient_row)
                existing_patient_ids.add(normalized_patient_id)
                for visit_row in richer_snapshot["visits"]:
                    visit_records.append(dict(visit_row))
                    visit_key = (
                        dp._coerce_optional_text(visit_row.get("patient_id")),
                        dp._coerce_optional_text(visit_row.get("visit_date")),
                    )
                    existing_visits_by_key[visit_key] = {
                        "visit_id": dp._coerce_optional_text(visit_row.get("visit_id")),
                        "has_representative": False,
                    }
                for image_row in richer_snapshot["images"]:
                    normalized_image_row = dict(image_row)
                    resolved_image_path, _ = store._resolve_site_runtime_path(
                        normalized_image_row.get("image_path"),
                        require_exists=False,
                    )
                    normalized_image_row["image_path"] = str(resolved_image_path.resolve())
                    image_records.append(normalized_image_row)
                    existing_image_paths.add(normalized_image_row["image_path"])
                    existing_image_keys.add(
                        (
                            dp._coerce_optional_text(normalized_image_row.get("patient_id")),
                            dp._coerce_optional_text(normalized_image_row.get("visit_date")),
                            Path(normalized_image_row["image_path"]).name.lower(),
                        )
                    )
                    if bool(normalized_image_row.get("is_representative")):
                        visit_id = dp._coerce_optional_text(normalized_image_row.get("visit_id"))
                        if visit_id:
                            representative_visit_ids.add(visit_id)
                for visit_state in existing_visits_by_key.values():
                    visit_state["has_representative"] = dp._coerce_optional_text(visit_state.get("visit_id")) in representative_visit_ids
                continue

            if not patient_visit_images:
                continue

            patient_records.append(
                {
                    "site_id": store.site_id,
                    "patient_id": normalized_patient_id,
                    "created_by_user_id": None,
                    "sex": "unknown",
                    "age": 0,
                    "chart_alias": "",
                    "local_case_code": "",
                    "created_at": dp._filesystem_timestamp_to_utc(patient_dir.stat().st_mtime if patient_dir.exists() else None),
                }
            )
            existing_patient_ids.add(normalized_patient_id)

        for visit_dir in sorted((path for path in patient_dir.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
            raw_visit_label = str(visit_dir.name or "").strip()
            if not raw_visit_label:
                continue
            try:
                normalized_visit_date = dp.normalize_visit_label(raw_visit_label)
            except ValueError:
                skipped_invalid_visits += 1
                continue
            visit_images = sorted(
                (
                    image_path
                    for image_path in visit_dir.rglob("*")
                    if image_path.is_file() and image_path.suffix.lower() in dp._RAW_INVENTORY_IMAGE_EXTENSIONS
                ),
                key=lambda path: (str(path.parent).lower(), path.name.lower()),
            )
            if not visit_images:
                continue
            scanned_visits += 1
            visit_key = (normalized_patient_id, normalized_visit_date)
            visit_state = existing_visits_by_key.get(visit_key)
            if visit_state is None:
                visit_id = dp.make_id("visit")
                visit_records.append(
                    {
                        "visit_id": visit_id,
                        "site_id": store.site_id,
                        "patient_id": normalized_patient_id,
                        "patient_reference_id": dp.make_patient_reference_id(
                            store.site_id,
                            normalized_patient_id,
                            dp.PATIENT_REFERENCE_SALT,
                        ),
                        "created_by_user_id": None,
                        "visit_date": normalized_visit_date,
                        "visit_index": dp.visit_index_from_label(normalized_visit_date),
                        "actual_visit_date": None,
                        "culture_status": "unknown",
                        "culture_confirmed": False,
                        "culture_category": "",
                        "culture_species": "",
                        "contact_lens_use": "unknown",
                        "predisposing_factor": [],
                        "additional_organisms": [],
                        "other_history": "",
                        "visit_status": "active",
                        "active_stage": True,
                        "is_initial_visit": normalized_visit_date == "Initial",
                        "smear_result": "",
                        "polymicrobial": False,
                        "research_registry_status": "analysis_only",
                        "research_registry_updated_at": scan_timestamp,
                        "research_registry_updated_by": None,
                        "research_registry_source": "raw_inventory_sync",
                        "created_at": dp._filesystem_timestamp_to_utc(visit_dir.stat().st_mtime if visit_dir.exists() else None),
                    }
                )
                visit_state = {"visit_id": visit_id, "has_representative": False}
                existing_visits_by_key[visit_key] = visit_state

            for image_path in visit_images:
                scanned_images += 1
                resolved_image_path = image_path.resolve()
                image_key = (normalized_patient_id, normalized_visit_date, resolved_image_path.name.lower())
                if str(resolved_image_path) in existing_image_paths or image_key in existing_image_keys:
                    skipped_existing_images += 1
                    continue
                inferred_view = dp._infer_raw_image_view(resolved_image_path)
                try:
                    quality_scores = dp.score_slit_lamp_image(str(resolved_image_path), view=inferred_view)
                except Exception:
                    quality_scores = None
                uploaded_at = dp._filesystem_timestamp_to_utc(
                    resolved_image_path.stat().st_mtime if resolved_image_path.exists() else None
                )
                is_representative = not bool(visit_state.get("has_representative"))
                image_records.append(
                    {
                        "image_id": dp.make_id("image"),
                        "visit_id": str(visit_state.get("visit_id") or "").strip(),
                        "site_id": store.site_id,
                        "patient_id": normalized_patient_id,
                        "visit_date": normalized_visit_date,
                        "created_by_user_id": None,
                        "view": inferred_view,
                        "image_path": str(resolved_image_path),
                        "is_representative": is_representative,
                        "lesion_prompt_box": None,
                        "has_lesion_box": False,
                        "has_roi_crop": False,
                        "has_medsam_mask": False,
                        "has_lesion_crop": False,
                        "has_lesion_mask": False,
                        "quality_scores": quality_scores,
                        "artifact_status_updated_at": uploaded_at,
                        "uploaded_at": uploaded_at,
                    }
                )
                existing_image_paths.add(str(resolved_image_path))
                existing_image_keys.add(image_key)
                if is_representative:
                    visit_state["has_representative"] = True

    if patient_records or visit_records or image_records:
        with dp.DATA_PLANE_ENGINE.begin() as conn:
            if patient_records:
                conn.execute(dp.db_patients.insert().values(patient_records))
            if visit_records:
                conn.execute(dp.db_visits.insert().values(visit_records))
            if image_records:
                conn.execute(dp.db_images.insert().values(image_records))

    return {
        "site_id": store.site_id,
        "scanned_patients": scanned_patients,
        "scanned_visits": scanned_visits,
        "scanned_images": scanned_images,
        "created_patients": len(patient_records),
        "created_visits": len(visit_records),
        "created_images": len(image_records),
        "skipped_existing_images": skipped_existing_images,
        "skipped_invalid_patients": skipped_invalid_patients,
        "skipped_invalid_visits": skipped_invalid_visits,
        "restored_patients": restored_from_backup["patients"],
        "restored_visits": restored_from_backup["visits"],
        "restored_images": restored_from_backup["images"],
    }


def sync_raw_inventory_metadata_if_due(store: Any, *, force: bool = False) -> dict[str, Any]:
    dp = _deps()
    now = dp.time.monotonic()
    with dp._SITE_RAW_METADATA_SYNC_LOCK:
        last_run = dp._SITE_RAW_METADATA_SYNC_LAST_RUN.get(store.site_id)
        if not force and last_run is not None and (now - last_run) < dp._SITE_RAW_METADATA_SYNC_INTERVAL_SECONDS:
            return {
                "site_id": store.site_id,
                "scanned_patients": 0,
                "scanned_visits": 0,
                "scanned_images": 0,
                "created_patients": 0,
                "created_visits": 0,
                "created_images": 0,
                "skipped_existing_images": 0,
                "skipped_invalid_patients": 0,
                "skipped_invalid_visits": 0,
                "restored_patients": 0,
                "restored_visits": 0,
                "restored_images": 0,
            }
        dp._SITE_RAW_METADATA_SYNC_LAST_RUN[store.site_id] = now
    return store.sync_raw_inventory_metadata()


def raw_inventory_stats(store: Any) -> dict[str, int]:
    inventory = store._raw_inventory_index()
    return {
        "n_patients": len(inventory["patient_ids"]),
        "n_visits": len(inventory["visit_keys"]),
        "n_images": int(inventory["n_images"]),
    }


def metadata_backup_path(store: Any) -> Path:
    return store.manifest_dir / "metadata_backup.json"


def export_metadata_backup(store: Any, path: Path | None = None) -> Path:
    dp = _deps()
    backup_path = path or store.metadata_backup_path()
    payload = {
        "site_id": store.site_id,
        "generated_at": dp.utc_now(),
        "patients": store.list_patients(),
        "visits": store.list_visits(),
        "images": [
            {
                **image,
                "image_path": str(store._resolve_site_runtime_path(image.get("image_path"), require_exists=False)[0].resolve())
                if str(image.get("image_path") or "").strip()
                else "",
            }
            for image in store.list_images()
        ],
    }
    dp.write_json(backup_path, payload)
    return backup_path


def resolve_recovery_image_path(
    store: Any,
    value: Any,
    patient_id: str | None = None,
    image_name: str | None = None,
    *,
    visit_date: str | None = None,
) -> Path:
    dp = _deps()
    raw_value = dp._coerce_optional_text(value)
    normalized_patient_id = dp._coerce_optional_text(patient_id)
    normalized_image_name = dp._coerce_optional_text(image_name)
    normalized_visit_date = dp._coerce_optional_text(visit_date)

    candidates: list[Path] = []
    if normalized_patient_id and normalized_image_name:
        if normalized_visit_date:
            try:
                normalized_visit_date = dp.normalize_visit_label(normalized_visit_date)
            except ValueError:
                normalized_visit_date = dp._coerce_optional_text(visit_date)
        if normalized_patient_id and normalized_image_name and normalized_visit_date:
            candidates.append(
                store._canonical_image_storage_path(
                    normalized_patient_id,
                    normalized_visit_date,
                    normalized_image_name,
                )
            )
    if raw_value:
        original = Path(raw_value).expanduser()
        if original.is_absolute():
            candidates.append(original)
            parts = list(original.parts)
            raw_index: int | None = None
            for index in range(len(parts) - 1):
                if parts[index].lower() == "data" and parts[index + 1].lower() == "raw":
                    raw_index = index
                    break
            if raw_index is not None:
                relative_parts = parts[raw_index + 2 :]
                if relative_parts:
                    candidates.append((store.raw_dir / Path(*relative_parts)).resolve())
        else:
            candidates.append((store.site_dir / original).resolve())

    patient_dir = store.raw_dir / patient_id
    if image_name and patient_dir.exists():
        matches = [path.resolve() for path in patient_dir.rglob(image_name) if path.is_file()]
        if matches:
            candidates.extend(matches)
    if normalized_patient_id and normalized_visit_date:
        visit_dir = store.raw_dir / normalized_patient_id / normalized_visit_date
        if visit_dir.exists():
            allowed_suffixes = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
            visit_files = [
                path.resolve()
                for path in visit_dir.iterdir()
                if path.is_file() and path.suffix.lower() in allowed_suffixes
            ]
            if len(visit_files) == 1:
                candidates.append(visit_files[0])

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate.resolve()
    if candidates:
        raise ValueError(f"Image file not found on disk: {candidates[0]}")
    raise ValueError("Image file path is required for metadata recovery.")


def standardize_visit_storage_layout(store: Any, *, refresh_manifest: bool = True) -> dict[str, int]:
    dp = _deps()
    query = (
        dp.select(
            dp.db_images.c.image_id,
            dp.db_images.c.patient_id,
            dp.db_images.c.visit_date,
            dp.db_images.c.image_path,
        )
        .where(dp.db_images.c.site_id == store.site_id)
        .order_by(dp.db_images.c.patient_id, dp.db_images.c.visit_date, dp.db_images.c.uploaded_at)
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        rows = conn.execute(query).mappings().all()

    moved_files = 0
    updated_paths = 0
    removed_dirs = 0
    skipped_images = 0
    conflict_paths = 0
    patient_dirs: set[Path] = set()
    for row in rows:
        image_id = dp._coerce_optional_text(row.get("image_id"))
        patient_id = dp._coerce_optional_text(row.get("patient_id"))
        visit_date = dp._coerce_optional_text(row.get("visit_date"))
        raw_path = dp._coerce_optional_text(row.get("image_path"))
        image_name = Path(raw_path).name
        if not image_id or not patient_id or not visit_date or not image_name:
            skipped_images += 1
            continue

        patient_dir = (store.raw_dir / patient_id).resolve()
        patient_dirs.add(patient_dir)
        canonical_path = store._canonical_image_storage_path(patient_id, visit_date, image_name)
        try:
            resolved_path = store._resolve_recovery_image_path(raw_path, patient_id, image_name, visit_date=visit_date)
        except ValueError:
            skipped_images += 1
            continue

        runtime_path = canonical_path
        if resolved_path != canonical_path:
            dp.ensure_dir(canonical_path.parent)
            if canonical_path.exists():
                runtime_path = canonical_path
                conflict_paths += 1
            else:
                resolved_path.replace(canonical_path)
                moved_files += 1
                removed_dirs += store._prune_empty_raw_dirs(resolved_path.parent, patient_dir=patient_dir)
                runtime_path = canonical_path
        if str(raw_path) != str(runtime_path):
            store._persist_image_record_path(image_id, runtime_path)
            updated_paths += 1

    manifest_rows = 0
    if refresh_manifest:
        manifest_rows = len(store.generate_manifest())

    return {
        "site_id": store.site_id,
        "scanned_images": len(rows),
        "moved_files": moved_files,
        "updated_paths": updated_paths,
        "removed_dirs": removed_dirs,
        "conflict_paths": conflict_paths,
        "skipped_images": skipped_images,
        "manifest_rows": manifest_rows,
    }


def patient_id_from_recovery_image_path(store: Any, image_path: Path) -> str | None:
    dp = _deps()
    try:
        relative_path = image_path.resolve().relative_to(store.raw_dir.resolve())
    except ValueError:
        return None
    if not relative_path.parts:
        return None
    return dp._coerce_optional_text(relative_path.parts[0]) or None


def recover_metadata_from_backup_payload(
    store: Any,
    payload: dict[str, Any],
    *,
    force_replace: bool,
) -> dict[str, Any]:
    dp = _deps()
    patients_payload = [dict(item) for item in payload.get("patients", []) if isinstance(item, dict)]
    visits_payload = [dict(item) for item in payload.get("visits", []) if isinstance(item, dict)]
    images_payload = [dict(item) for item in payload.get("images", []) if isinstance(item, dict)]
    if not patients_payload and not visits_payload and not images_payload:
        raise ValueError("Metadata backup is empty.")

    if not force_replace and (store.list_patients() or store.list_visits() or store.list_images()):
        raise ValueError("Site metadata already exists. Use force_replace to rebuild it.")

    patient_id_overrides: dict[str, str] = {}
    for row in images_payload:
        raw_patient_id = dp._coerce_optional_text(row.get("patient_id"))
        image_name = Path(dp._coerce_optional_text(row.get("image_path"))).name
        if not raw_patient_id or not image_name:
            continue
        resolved_image_path = store._resolve_recovery_image_path(row.get("image_path"), raw_patient_id, image_name)
        path_patient_id = store._patient_id_from_recovery_image_path(resolved_image_path)
        if path_patient_id:
            patient_id_overrides[raw_patient_id] = path_patient_id

    patient_records: list[dict[str, Any]] = []
    for row in patients_payload:
        raw_patient_id = dp._coerce_optional_text(row.get("patient_id"))
        patient_records.append(
            {
                "site_id": store.site_id,
                "patient_id": dp.normalize_patient_pseudonym(patient_id_overrides.get(raw_patient_id, raw_patient_id)),
                "created_by_user_id": dp._coerce_optional_text(row.get("created_by_user_id")) or None,
                "sex": dp._coerce_optional_text(row.get("sex"), "unknown") or "unknown",
                "age": dp._coerce_optional_int(row.get("age"), 0),
                "chart_alias": dp._coerce_optional_text(row.get("chart_alias")),
                "local_case_code": dp._coerce_optional_text(row.get("local_case_code")),
                "created_at": dp._coerce_optional_text(row.get("created_at"), dp.utc_now()),
            }
        )

    visit_records: list[dict[str, Any]] = []
    visit_index_by_key: dict[tuple[str, str], str] = {}
    for row in visits_payload:
        raw_patient_id = dp._coerce_optional_text(row.get("patient_id"))
        normalized_patient_id = dp.normalize_patient_pseudonym(patient_id_overrides.get(raw_patient_id, raw_patient_id))
        normalized_visit_date = dp.normalize_visit_label(dp._coerce_optional_text(row.get("visit_date")))
        visit_id = dp._coerce_optional_text(row.get("visit_id")) or dp.make_id("visit")
        normalized_culture = dp._normalize_visit_culture_fields(
            culture_status=row.get("culture_status"),
            culture_confirmed=row.get("culture_confirmed"),
            culture_category=row.get("culture_category"),
            culture_species=row.get("culture_species"),
            additional_organisms=list(row.get("additional_organisms") or []),
            polymicrobial=row.get("polymicrobial"),
        )
        visit_record = {
            "visit_id": visit_id,
            "site_id": store.site_id,
            "patient_id": normalized_patient_id,
            "patient_reference_id": dp._coerce_optional_text(row.get("patient_reference_id"))
            or dp.make_patient_reference_id(store.site_id, normalized_patient_id, dp.PATIENT_REFERENCE_SALT),
            "created_by_user_id": dp._coerce_optional_text(row.get("created_by_user_id")) or None,
            "visit_date": normalized_visit_date,
            "visit_index": int(row.get("visit_index") or dp.visit_index_from_label(normalized_visit_date)),
            "actual_visit_date": dp.normalize_actual_visit_date(dp._coerce_optional_text(row.get("actual_visit_date")) or None),
            **normalized_culture,
            "contact_lens_use": dp._coerce_optional_text(row.get("contact_lens_use"), "unknown") or "unknown",
            "predisposing_factor": list(row.get("predisposing_factor") or []),
            "other_history": dp._coerce_optional_text(row.get("other_history")),
            "visit_status": dp._coerce_optional_text(row.get("visit_status"), "active") or "active",
            "active_stage": dp._coerce_optional_bool(row.get("active_stage"), True),
            "is_initial_visit": dp._coerce_optional_bool(row.get("is_initial_visit"), normalized_visit_date == "Initial"),
            "smear_result": dp._coerce_optional_text(row.get("smear_result"), "not done") or "not done",
            "research_registry_status": dp._coerce_optional_text(row.get("research_registry_status"), "analysis_only") or "analysis_only",
            "research_registry_updated_at": dp._coerce_optional_text(row.get("research_registry_updated_at"), dp.utc_now()),
            "research_registry_updated_by": dp._coerce_optional_text(row.get("research_registry_updated_by")) or None,
            "research_registry_source": dp._coerce_optional_text(row.get("research_registry_source"), "metadata_backup_restore") or "metadata_backup_restore",
            "created_at": dp._coerce_optional_text(row.get("created_at"), dp.utc_now()),
        }
        visit_records.append(visit_record)
        visit_index_by_key[(normalized_patient_id, normalized_visit_date)] = visit_id

    image_records: list[dict[str, Any]] = []
    for row in images_payload:
        raw_patient_id = dp._coerce_optional_text(row.get("patient_id"))
        normalized_visit_date = dp.normalize_visit_label(dp._coerce_optional_text(row.get("visit_date")))
        image_name = Path(dp._coerce_optional_text(row.get("image_path"))).name
        resolved_image_path = store._resolve_recovery_image_path(
            row.get("image_path"),
            patient_id_overrides.get(raw_patient_id, raw_patient_id),
            image_name,
        )
        path_patient_id = store._patient_id_from_recovery_image_path(resolved_image_path)
        normalized_patient_id = dp.normalize_patient_pseudonym(path_patient_id or patient_id_overrides.get(raw_patient_id, raw_patient_id))
        lesion_prompt_box = dp._parse_manifest_box(row.get("lesion_prompt_box"))
        image_records.append(
            {
                "image_id": dp._coerce_optional_text(row.get("image_id")) or resolved_image_path.stem or dp.make_id("image"),
                "visit_id": visit_index_by_key[(normalized_patient_id, normalized_visit_date)],
                "site_id": store.site_id,
                "patient_id": normalized_patient_id,
                "visit_date": normalized_visit_date,
                "created_by_user_id": dp._coerce_optional_text(row.get("created_by_user_id")) or None,
                "view": dp._coerce_optional_text(row.get("view"), "white") or "white",
                "image_path": str(resolved_image_path),
                "is_representative": dp._coerce_optional_bool(row.get("is_representative"), False),
                "lesion_prompt_box": lesion_prompt_box if not isinstance(row.get("lesion_prompt_box"), dict) else row.get("lesion_prompt_box"),
                "has_lesion_box": dp._coerce_optional_bool(row.get("has_lesion_box"), bool(lesion_prompt_box)),
                "has_roi_crop": dp._coerce_optional_bool(row.get("has_roi_crop"), False),
                "has_medsam_mask": dp._coerce_optional_bool(row.get("has_medsam_mask"), False),
                "has_lesion_crop": dp._coerce_optional_bool(row.get("has_lesion_crop"), False),
                "has_lesion_mask": dp._coerce_optional_bool(row.get("has_lesion_mask"), False),
                "quality_scores": row.get("quality_scores") if isinstance(row.get("quality_scores"), dict) else None,
                "artifact_status_updated_at": dp._coerce_optional_text(row.get("artifact_status_updated_at"), dp.utc_now()),
                "uploaded_at": dp._coerce_optional_text(row.get("uploaded_at"), dp.utc_now()),
            }
        )

    store._clear_site_metadata_rows()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        if patient_records:
            conn.execute(dp.db_patients.insert().values(patient_records))
        if visit_records:
            conn.execute(dp.db_visits.insert().values(visit_records))
        if image_records:
            conn.execute(dp.db_images.insert().values(image_records))
    return {
        "source": "backup",
        "restored_patients": len(patient_records),
        "restored_visits": len(visit_records),
        "restored_images": len(image_records),
    }


def recover_metadata_from_manifest(store: Any, *, force_replace: bool) -> dict[str, Any]:
    dp = _deps()
    if not store.manifest_path.exists():
        raise ValueError("Manifest file does not exist.")
    manifest_df = pd.read_csv(store.manifest_path, dtype=str, keep_default_na=False)
    if manifest_df.empty:
        raise ValueError("Manifest file is empty.")

    if not force_replace and (store.list_patients() or store.list_visits() or store.list_images()):
        raise ValueError("Site metadata already exists. Use force_replace to rebuild it.")

    timestamp = dp.utc_now()
    patient_records: dict[str, dict[str, Any]] = {}
    visit_records: dict[tuple[str, str], dict[str, Any]] = {}
    image_records: list[dict[str, Any]] = []

    for row in manifest_df.to_dict(orient="records"):
        raw_patient_id = dp._coerce_optional_text(row.get("patient_id"))
        image_name = Path(dp._coerce_optional_text(row.get("image_path"))).name
        resolved_image_path = store._resolve_recovery_image_path(row.get("image_path"), raw_patient_id, image_name)
        path_patient_id = store._patient_id_from_recovery_image_path(resolved_image_path)
        normalized_patient_id = dp.normalize_patient_pseudonym(path_patient_id or raw_patient_id)
        normalized_visit_date = dp.normalize_visit_label(dp._coerce_optional_text(row.get("visit_date")))
        patient_record = patient_records.get(normalized_patient_id)
        if patient_record is None:
            patient_record = {
                "site_id": store.site_id,
                "patient_id": normalized_patient_id,
                "created_by_user_id": None,
                "sex": dp._coerce_optional_text(row.get("sex"), "unknown") or "unknown",
                "age": dp._coerce_optional_int(row.get("age"), 0),
                "chart_alias": dp._coerce_optional_text(row.get("chart_alias")),
                "local_case_code": dp._coerce_optional_text(row.get("local_case_code")),
                "created_at": timestamp,
            }
            patient_records[normalized_patient_id] = patient_record
        else:
            if not patient_record["chart_alias"]:
                patient_record["chart_alias"] = dp._coerce_optional_text(row.get("chart_alias"))
            if not patient_record["local_case_code"]:
                patient_record["local_case_code"] = dp._coerce_optional_text(row.get("local_case_code"))

        visit_key = (normalized_patient_id, normalized_visit_date)
        visit_record = visit_records.get(visit_key)
        if visit_record is None:
            normalized_status = dp._coerce_optional_text(row.get("visit_status"), "active").lower() or "active"
            if normalized_status not in dp.VISIT_STATUS_OPTIONS:
                normalized_status = "active"
            normalized_culture = dp._normalize_visit_culture_fields(
                culture_status=row.get("culture_status"),
                culture_confirmed=row.get("culture_confirmed"),
                culture_category=row.get("culture_category"),
                culture_species=row.get("culture_species"),
                additional_organisms=[],
                polymicrobial=row.get("polymicrobial"),
            )
            visit_record = {
                "visit_id": dp.make_id("visit"),
                "site_id": store.site_id,
                "patient_id": normalized_patient_id,
                "patient_reference_id": dp.make_patient_reference_id(
                    store.site_id,
                    normalized_patient_id,
                    dp.PATIENT_REFERENCE_SALT,
                ),
                "created_by_user_id": None,
                "visit_date": normalized_visit_date,
                "visit_index": dp.visit_index_from_label(normalized_visit_date),
                "actual_visit_date": None,
                **normalized_culture,
                "contact_lens_use": dp._coerce_optional_text(row.get("contact_lens_use"), "unknown") or "unknown",
                "predisposing_factor": dp._parse_manifest_pipe_list(row.get("predisposing_factor")),
                "other_history": dp._coerce_optional_text(row.get("other_history")),
                "visit_status": normalized_status,
                "active_stage": normalized_status == "active",
                "is_initial_visit": normalized_visit_date == "Initial",
                "smear_result": dp._coerce_optional_text(row.get("smear_result"), "not done") or "not done",
                "research_registry_status": "analysis_only",
                "research_registry_updated_at": timestamp,
                "research_registry_updated_by": None,
                "research_registry_source": "manifest_recovery",
                "created_at": timestamp,
            }
            visit_records[visit_key] = visit_record

        lesion_prompt_box = dp._parse_manifest_box(row.get("lesion_prompt_box"))
        image_records.append(
            {
                "image_id": resolved_image_path.stem or dp.make_id("image"),
                "visit_id": visit_record["visit_id"],
                "site_id": store.site_id,
                "patient_id": normalized_patient_id,
                "visit_date": normalized_visit_date,
                "created_by_user_id": None,
                "view": dp._coerce_optional_text(row.get("view"), "white") or "white",
                "image_path": str(resolved_image_path),
                "is_representative": dp._coerce_optional_bool(row.get("is_representative"), False),
                "lesion_prompt_box": lesion_prompt_box,
                "has_lesion_box": lesion_prompt_box is not None,
                "has_roi_crop": False,
                "has_medsam_mask": False,
                "has_lesion_crop": False,
                "has_lesion_mask": False,
                "quality_scores": None,
                "artifact_status_updated_at": timestamp,
                "uploaded_at": timestamp,
            }
        )

    store._clear_site_metadata_rows()
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        conn.execute(dp.db_patients.insert().values(list(patient_records.values())))
        conn.execute(dp.db_visits.insert().values(list(visit_records.values())))
        conn.execute(dp.db_images.insert().values(image_records))
    return {
        "source": "manifest",
        "restored_patients": len(patient_records),
        "restored_visits": len(visit_records),
        "restored_images": len(image_records),
    }


def recover_metadata(
    store: Any,
    *,
    prefer_backup: bool = True,
    force_replace: bool = False,
    backup_path: str | None = None,
) -> dict[str, Any]:
    dp = _deps()
    backup_candidate = Path(backup_path).expanduser() if backup_path else store.metadata_backup_path()
    if prefer_backup and backup_candidate.exists():
        payload = dp.read_json(backup_candidate, {})
        result = store._recover_metadata_from_backup_payload(payload, force_replace=force_replace)
    else:
        result = store._recover_metadata_from_manifest(force_replace=force_replace)
    store.generate_manifest()
    store.export_metadata_backup()
    return result


def generate_manifest(store: Any, *, positive_only: bool = True) -> pd.DataFrame:
    dp = _deps()
    data_frame = pd.DataFrame(store.dataset_records(positive_only=positive_only), columns=dp.MANIFEST_COLUMNS)
    dp.write_csv(store.manifest_path, data_frame)
    return data_frame


def load_manifest(store: Any) -> pd.DataFrame:
    return store.generate_manifest()
