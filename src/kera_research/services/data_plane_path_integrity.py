from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from sqlalchemy import and_, select, update

from kera_research.config import resolve_portable_path
from kera_research.db import DATA_PLANE_ENGINE, images as db_images, visits as db_visits
from kera_research.domain import normalize_visit_label, visit_index_from_label
from kera_research.services.data_plane_normalizers import _coerce_optional_text as _coerce_optional_text_impl
from kera_research.storage import ensure_dir

_SITE_LEGACY_VISIT_LABEL_REPAIRED: set[str] = set()
_SITE_LEGACY_VISIT_LABEL_REPAIRED_LOCK = threading.Lock()
_SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN: dict[str, float] = {}
_SITE_MISSING_IMAGE_PATH_REPAIR_LOCK = threading.Lock()
_SITE_MISSING_IMAGE_PATH_REPAIR_INTERVAL_SECONDS = 15.0


class SiteStorePathIntegrityMixin:
    def _seed_defaults(self) -> None:
        for path in (
            self.raw_dir,
            self.manifest_dir,
            self.gradcam_dir,
            self.medsam_mask_dir,
            self.roi_crop_dir,
            self.lesion_mask_dir,
            self.lesion_crop_dir,
            self.embedding_dir,
            self.image_preview_dir,
            self.validation_dir,
            self.update_dir,
            self.case_history_dir,
        ):
            ensure_dir(path)

    def _resolve_site_runtime_path(self, value: Any, *, require_exists: bool = False) -> tuple[Path, bool]:
        resolved, remapped = resolve_portable_path(
            _coerce_optional_text_impl(value),
            base_dir=self.site_dir,
            require_exists=require_exists,
        )
        return resolved, remapped

    def _persist_image_record_path(self, image_id: str, image_path: Path) -> None:
        normalized_image_id = _coerce_optional_text_impl(image_id)
        if not normalized_image_id:
            return
        with DATA_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(db_images)
                .where(and_(db_images.c.site_id == self.site_id, db_images.c.image_id == normalized_image_id))
                .values(image_path=str(image_path))
            )

    def _canonical_image_storage_path(self, patient_id: str, visit_date: str, image_name: str) -> Path:
        return (self.raw_dir / patient_id / visit_date / image_name).resolve()

    def _prune_empty_raw_dirs(self, start_dir: Path, *, patient_dir: Path) -> int:
        removed_count = 0
        current = start_dir.resolve()
        stop_dir = patient_dir.resolve()
        while current != stop_dir and current.exists() and current.is_dir():
            try:
                next(current.iterdir())
                break
            except StopIteration:
                try:
                    current.rmdir()
                except OSError:
                    break
                removed_count += 1
                current = current.parent
        return removed_count

    def _resolve_image_record_path(self, record: dict[str, Any], *, persist: bool = True) -> dict[str, Any]:
        raw_path = _coerce_optional_text_impl(record.get("image_path"))
        if not raw_path:
            return record
        image_id = _coerce_optional_text_impl(record.get("image_id"))
        patient_id = _coerce_optional_text_impl(record.get("patient_id"))
        visit_date = _coerce_optional_text_impl(record.get("visit_date"))
        image_name = Path(raw_path).name
        should_persist = False
        try:
            resolved_path, remapped = self._resolve_site_runtime_path(raw_path, require_exists=True)
            if not resolved_path.exists():
                raise ValueError("Image file not found on disk.")
            should_persist = remapped and Path(raw_path).is_absolute()
        except Exception:
            try:
                resolved_path = self._resolve_recovery_image_path(
                    raw_path,
                    patient_id,
                    image_name,
                    visit_date=visit_date,
                )
                should_persist = str(resolved_path) != raw_path
            except Exception:
                return record
        record["image_path"] = str(resolved_path)
        if persist and should_persist:
            self._persist_image_record_path(image_id, resolved_path)
        return record

    def repair_missing_image_paths(self) -> dict[str, int]:
        query = (
            select(
                db_images.c.image_id,
                db_images.c.patient_id,
                db_images.c.visit_date,
                db_images.c.image_path,
            )
            .where(db_images.c.site_id == self.site_id)
            .order_by(db_images.c.patient_id, db_images.c.visit_date, db_images.c.uploaded_at)
        )
        with DATA_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()

        missing_before = 0
        repaired_paths = 0
        unresolved_paths = 0
        remapped_paths = 0

        for row in rows:
            image_id = _coerce_optional_text_impl(row.get("image_id"))
            patient_id = _coerce_optional_text_impl(row.get("patient_id"))
            visit_date = _coerce_optional_text_impl(row.get("visit_date"))
            raw_path = _coerce_optional_text_impl(row.get("image_path"))
            image_name = Path(raw_path).name
            if not image_id or not raw_path or not image_name:
                unresolved_paths += 1
                continue

            try:
                resolved_path, remapped = self._resolve_site_runtime_path(raw_path, require_exists=True)
                if resolved_path.exists():
                    if remapped and Path(raw_path).is_absolute() and str(resolved_path) != raw_path:
                        self._persist_image_record_path(image_id, resolved_path)
                        repaired_paths += 1
                        remapped_paths += 1
                    continue
            except Exception:
                pass

            missing_before += 1
            try:
                resolved_path = self._resolve_recovery_image_path(
                    raw_path,
                    patient_id,
                    image_name,
                    visit_date=visit_date,
                )
            except ValueError:
                unresolved_paths += 1
                continue

            if str(resolved_path) != raw_path:
                self._persist_image_record_path(image_id, resolved_path)
                repaired_paths += 1

        return {
            "site_id": self.site_id,
            "scanned_images": len(rows),
            "missing_before": missing_before,
            "repaired_paths": repaired_paths,
            "remapped_paths": remapped_paths,
            "unresolved_paths": unresolved_paths,
        }

    def _repair_missing_image_paths_if_due(self, *, force: bool = False) -> dict[str, int]:
        with _SITE_MISSING_IMAGE_PATH_REPAIR_LOCK:
            now = time.monotonic()
            last_run = _SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN.get(self.site_id, 0.0)
            if not force and (now - last_run) < _SITE_MISSING_IMAGE_PATH_REPAIR_INTERVAL_SECONDS:
                return {
                    "site_id": self.site_id,
                    "scanned_images": 0,
                    "missing_before": 0,
                    "repaired_paths": 0,
                    "remapped_paths": 0,
                    "unresolved_paths": 0,
                }
            result = self.repair_missing_image_paths()
            _SITE_MISSING_IMAGE_PATH_REPAIR_LAST_RUN[self.site_id] = time.monotonic()
            return result

    def _repair_legacy_visit_labels_once(self) -> None:
        with _SITE_LEGACY_VISIT_LABEL_REPAIRED_LOCK:
            if self.site_id in _SITE_LEGACY_VISIT_LABEL_REPAIRED:
                return

            history_moves: list[tuple[Path, Path]] = []
            with DATA_PLANE_ENGINE.begin() as conn:
                visit_rows = conn.execute(
                    select(
                        db_visits.c.visit_id,
                        db_visits.c.patient_id,
                        db_visits.c.visit_date,
                    ).where(db_visits.c.site_id == self.site_id)
                ).mappings().all()
                for row in visit_rows:
                    visit_id = _coerce_optional_text_impl(row.get("visit_id"))
                    patient_id = _coerce_optional_text_impl(row.get("patient_id"))
                    raw_visit_date = _coerce_optional_text_impl(row.get("visit_date"))
                    if not visit_id or not patient_id or not raw_visit_date:
                        continue
                    try:
                        normalized_visit_date = normalize_visit_label(raw_visit_date)
                    except ValueError:
                        continue
                    if normalized_visit_date == raw_visit_date:
                        continue
                    collision_visit_id = conn.execute(
                        select(db_visits.c.visit_id).where(
                            and_(
                                db_visits.c.site_id == self.site_id,
                                db_visits.c.patient_id == patient_id,
                                db_visits.c.visit_date == normalized_visit_date,
                                db_visits.c.visit_id != visit_id,
                            )
                        )
                    ).scalar()
                    if collision_visit_id:
                        continue
                    conn.execute(
                        update(db_visits)
                        .where(and_(db_visits.c.site_id == self.site_id, db_visits.c.visit_id == visit_id))
                        .values(
                            visit_date=normalized_visit_date,
                            visit_index=visit_index_from_label(normalized_visit_date),
                            is_initial_visit=normalized_visit_date == "Initial",
                        )
                    )
                    conn.execute(
                        update(db_images)
                        .where(and_(db_images.c.site_id == self.site_id, db_images.c.visit_id == visit_id))
                        .values(visit_date=normalized_visit_date)
                    )
                    source_history_path = self._case_history_path(patient_id, raw_visit_date)
                    target_history_path = self._case_history_path(patient_id, normalized_visit_date)
                    if source_history_path != target_history_path and source_history_path.exists():
                        history_moves.append((source_history_path, target_history_path))

            for source_history_path, target_history_path in history_moves:
                if not source_history_path.exists():
                    continue
                ensure_dir(target_history_path.parent)
                if target_history_path.exists():
                    continue
                source_history_path.replace(target_history_path)

            _SITE_LEGACY_VISIT_LABEL_REPAIRED.add(self.site_id)
