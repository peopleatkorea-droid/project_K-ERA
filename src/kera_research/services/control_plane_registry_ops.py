from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import select, update

from kera_research.config import CASE_REFERENCE_SALT_FINGERPRINT, MODEL_DISTRIBUTION_MODE
from kera_research.db import CONTROL_PLANE_ENGINE, admin_jobs, aggregations, audit_events, contributions, model_updates, model_versions
from kera_research.domain import make_id, utc_now
from kera_research.services.federated_update_security import verify_federated_update_signature

_MODEL_VERSION_LOCK = threading.Lock()


class ControlPlaneRegistryOps:
    def __init__(
        self,
        store: Any,
        *,
        payload_record: Callable[[Any, str, list[str]], dict[str, Any]],
    ) -> None:
        self.store = store
        self.payload_record = payload_record

    def _infer_model_source_provider(self, metadata: dict[str, Any]) -> str:
        explicit = str(metadata.get("source_provider") or "").strip()
        if explicit:
            return explicit
        download_url = str(metadata.get("download_url") or "").strip().lower()
        if "sharepoint.com" in download_url or "onedrive" in download_url:
            return "onedrive_sharepoint"
        if download_url:
            return "http_download"
        if str(metadata.get("model_path") or "").strip():
            return "local"
        return "unknown"

    def _admin_job_row_to_dict(self, row: dict[str, Any]) -> dict[str, Any]:
        payload = dict(row.get("payload_json") or {})
        return {
            "job_id": row["job_id"],
            "job_type": row["job_type"],
            "status": row["status"],
            "payload": payload,
            "result": row.get("result_json"),
            "error": row.get("error_text"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
        }

    def _audit_event_row_to_dict(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "event_id": str(row.get("event_id") or "").strip(),
            "actor_type": str(row.get("actor_type") or "").strip(),
            "actor_id": str(row.get("actor_id") or "").strip() or None,
            "action": str(row.get("action") or "").strip(),
            "target_type": str(row.get("target_type") or "").strip(),
            "target_id": str(row.get("target_id") or "").strip() or None,
            "payload_json": dict(row.get("payload_json") or {}),
            "created_at": row.get("created_at"),
        }

    def _normalize_model_metadata(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        merged = dict(model_metadata)
        local_model_path = str(merged.get("model_path") or "").strip()
        download_url = str(merged.get("download_url") or "").strip()
        publish_required = bool(merged.get("publish_required", False))

        if local_model_path:
            local_path = Path(local_model_path).expanduser()
            if local_path.exists():
                merged.setdefault("filename", local_path.name)
                merged.setdefault("size_bytes", int(local_path.stat().st_size))
                merged.setdefault("sha256", self.store._sha256_file(local_path))

        merged.setdefault("model_name", "keratitis_cls")
        merged["source_provider"] = self._infer_model_source_provider(merged)

        if publish_required and MODEL_DISTRIBUTION_MODE == "download_url" and not download_url:
            merged["distribution_status"] = "pending_upload"
            merged["ready"] = False
            merged["is_current"] = False
        elif download_url:
            merged["distribution_status"] = "published"
            merged["ready"] = bool(merged.get("ready", True))
        else:
            merged.setdefault("distribution_status", "local_only")

        return merged

    def list_model_versions(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(model_versions).order_by(model_versions.c.created_at)).all()
        return [
            item
            for item in (
                self.payload_record(
                    row,
                    "payload_json",
                    ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
                )
                for row in rows
            )
            if not item.get("archived", False)
        ]

    def set_model_current_flag(self, conn: Any, version_id: str, is_current: bool) -> None:
        row = conn.execute(select(model_versions).where(model_versions.c.version_id == version_id)).first()
        if row is None:
            return
        payload = self.payload_record(
            row,
            "payload_json",
            ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
        )
        payload["is_current"] = is_current
        conn.execute(
            update(model_versions)
            .where(model_versions.c.version_id == version_id)
            .values(is_current=is_current, payload_json=payload)
        )

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        merged = self._normalize_model_metadata(model_metadata)
        merged.setdefault("ready", True)
        merged.setdefault("is_current", False)
        with _MODEL_VERSION_LOCK, CONTROL_PLANE_ENGINE.begin() as conn:
            if merged.get("stage") == "global" and merged.get("ready", True) and merged.get("is_current"):
                current_rows = conn.execute(select(model_versions.c.version_id).where(model_versions.c.stage == "global")).all()
                for row in current_rows:
                    if row.version_id != merged["version_id"]:
                        self.set_model_current_flag(conn, row.version_id, False)

            existing = conn.execute(select(model_versions).where(model_versions.c.version_id == merged["version_id"])).first()
            if existing:
                existing_payload = self.payload_record(
                    existing,
                    "payload_json",
                    ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
                )
                merged = self._normalize_model_metadata({**existing_payload, **merged})
                conn.execute(
                    update(model_versions)
                    .where(model_versions.c.version_id == merged["version_id"])
                    .values(
                        version_name=merged["version_name"],
                        architecture=merged["architecture"],
                        stage=merged.get("stage"),
                        created_at=merged.get("created_at"),
                        ready=bool(merged.get("ready", True)),
                        is_current=bool(merged.get("is_current", False)),
                        payload_json=merged,
                    )
                )
            else:
                conn.execute(
                    model_versions.insert().values(
                        version_id=merged["version_id"],
                        version_name=merged["version_name"],
                        architecture=merged["architecture"],
                        stage=merged.get("stage"),
                        created_at=merged.get("created_at"),
                        ready=bool(merged.get("ready", True)),
                        is_current=bool(merged.get("is_current", False)),
                        payload_json=merged,
                    )
                )
        return merged

    def current_global_model(self) -> dict[str, Any] | None:
        versions = [item for item in self.list_model_versions() if item.get("stage") == "global" and item.get("ready", True)]
        if not versions:
            return None
        current_versions = [item for item in versions if item.get("is_current")]
        if current_versions:
            return sorted(current_versions, key=lambda item: item.get("created_at", ""))[-1]
        return sorted(versions, key=lambda item: item.get("created_at", ""))[-1]

    def archive_model_version(self, version_id: str) -> dict[str, Any]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(model_versions).where(model_versions.c.version_id == version_id)).first()
            if row is None:
                raise ValueError(f"Unknown model version: {version_id}")
            payload = self.payload_record(
                row,
                "payload_json",
                ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
            )
            if payload.get("is_current"):
                raise ValueError("The current active model cannot be deleted.")
            all_versions = [
                self.payload_record(
                    item,
                    "payload_json",
                    ["version_id", "version_name", "architecture", "stage", "created_at", "ready", "is_current"],
                )
                for item in conn.execute(select(model_versions)).all()
            ]
            all_aggregations = [
                self.payload_record(
                    item,
                    "payload_json",
                    ["aggregation_id", "base_model_version_id", "new_version_name", "architecture", "created_at", "total_cases"],
                )
                for item in conn.execute(select(aggregations)).all()
            ]
            if any(str(item.get("base_model_version_id") or "") == version_id for item in all_aggregations):
                raise ValueError("This model is referenced by an aggregation and cannot be deleted.")
            for item in all_versions:
                component_ids = [str(component_id) for component_id in item.get("component_model_version_ids", [])]
                if version_id in component_ids:
                    raise ValueError("This model is referenced by an ensemble model and cannot be deleted.")
                if str(item.get("base_version_id") or "") == version_id:
                    raise ValueError("This model is referenced as a base model and cannot be deleted.")

            payload["archived"] = True
            payload["archived_at"] = utc_now()
            conn.execute(
                update(model_versions).where(model_versions.c.version_id == version_id).values(is_current=False, payload_json=payload)
            )
        return payload

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        incoming_fingerprint = str(update_metadata.get("salt_fingerprint") or "").strip()
        if incoming_fingerprint and incoming_fingerprint != CASE_REFERENCE_SALT_FINGERPRINT:
            raise ValueError(
                f"Salt fingerprint mismatch: the submitting site uses a different "
                f"KERA_CASE_REFERENCE_SALT (site fingerprint: {incoming_fingerprint!r}, "
                f"server fingerprint: {CASE_REFERENCE_SALT_FINGERPRINT!r}). "
                "All nodes in a federation must share the same KERA_CASE_REFERENCE_SALT "
                "environment variable to ensure consistent case reference IDs."
            )
        record = self.store.normalize_model_update_artifact_metadata(
            self.store._normalize_case_reference(update_metadata)
        )
        artifact_path = str(record.get("artifact_path") or "").strip()
        needs_artifact_copy = artifact_path and (
            not str(record.get("central_artifact_name") or "").strip()
            or not str(record.get("central_artifact_sha256") or "").strip()
            or not int(record.get("central_artifact_size_bytes") or 0)
        )
        if needs_artifact_copy:
            try:
                record.update(
                    self.store.store_model_update_artifact(
                        artifact_path,
                        update_id=str(record["update_id"]),
                        artifact_kind="delta" if record.get("upload_type") == "weight delta" else "model",
                    )
                )
            except FileNotFoundError:
                pass
        verify_federated_update_signature(record)
        record.pop("artifact_path", None)
        record.pop("central_artifact_path", None)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(select(model_updates).where(model_updates.c.update_id == record["update_id"])).first()
            values = {
                "update_id": record["update_id"],
                "site_id": record.get("site_id"),
                "architecture": record.get("architecture"),
                "status": record.get("status"),
                "created_at": record.get("created_at"),
                "payload_json": record,
            }
            if existing:
                conn.execute(update(model_updates).where(model_updates.c.update_id == record["update_id"]).values(**values))
            else:
                conn.execute(model_updates.insert().values(**values))
        return record

    def get_model_update(self, update_id: str) -> dict[str, Any] | None:
        normalized_update_id = update_id.strip()
        if not normalized_update_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(select(model_updates).where(model_updates.c.update_id == normalized_update_id)).first()
        if row is None:
            return None
        return self.store.normalize_model_update_artifact_metadata(
            self.store._normalize_case_reference(
                self.payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
            )
        )

    def update_model_update(self, update_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        current = self.get_model_update(update_id)
        if current is None:
            raise ValueError(f"Unknown update_id: {update_id}")
        merged = self.store.normalize_model_update_artifact_metadata(
            self.store._normalize_case_reference({**current, **updates})
        )
        merged.pop("artifact_path", None)
        merged.pop("central_artifact_path", None)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                update(model_updates)
                .where(model_updates.c.update_id == update_id)
                .values(
                    site_id=merged.get("site_id"),
                    architecture=merged.get("architecture"),
                    status=merged.get("status"),
                    created_at=merged.get("created_at"),
                    payload_json=merged,
                )
            )
        return merged

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(model_updates).where(model_updates.c.update_id.in_(update_ids))).all()
            for row in rows:
                payload = self.payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
                payload["status"] = status
                conn.execute(
                    update(model_updates)
                    .where(model_updates.c.update_id == row._mapping["update_id"])
                    .values(status=status, payload_json=payload)
                )

    def review_model_update(self, update_id: str, reviewer_user_id: str, decision: str, reviewer_notes: str = "") -> dict[str, Any]:
        normalized_decision = decision.strip().lower()
        if normalized_decision not in {"approved", "rejected"}:
            raise ValueError("Invalid review decision.")
        current = self.get_model_update(update_id)
        if current is None:
            raise ValueError(f"Unknown update_id: {update_id}")
        return self.update_model_update(
            update_id,
            {
                "status": normalized_decision,
                "reviewed_by": reviewer_user_id,
                "reviewed_at": utc_now(),
                "reviewer_notes": reviewer_notes.strip(),
            },
        )

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        query = select(model_updates)
        if site_id:
            query = query.where(model_updates.c.site_id == site_id)
        query = query.order_by(model_updates.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            self.store.normalize_model_update_artifact_metadata(
                self.store._normalize_case_reference(
                    self.payload_record(row, "payload_json", ["update_id", "site_id", "architecture", "status", "created_at"])
                )
            )
            for row in rows
        ]

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        record = self.store._normalize_case_reference(contribution)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(select(contributions).where(contributions.c.contribution_id == record["contribution_id"])).first()
            values = {
                "contribution_id": record["contribution_id"],
                "user_id": record.get("user_id"),
                "site_id": record.get("site_id"),
                "created_at": record.get("created_at"),
                "payload_json": record,
            }
            if existing:
                conn.execute(update(contributions).where(contributions.c.contribution_id == record["contribution_id"]).values(**values))
            else:
                conn.execute(contributions.insert().values(**values))
        return record

    def list_contributions(self, user_id: str | None = None, site_id: str | None = None) -> list[dict[str, Any]]:
        query = select(contributions)
        if user_id:
            query = query.where(contributions.c.user_id == user_id)
        if site_id:
            query = query.where(contributions.c.site_id == site_id)
        query = query.order_by(contributions.c.created_at.desc())
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).all()
        return [
            self.store._normalize_case_reference(
                self.payload_record(row, "payload_json", ["contribution_id", "user_id", "site_id", "created_at"])
            )
            for row in rows
        ]

    def get_contribution_leaderboard(
        self,
        *,
        user_id: str | None = None,
        site_id: str | None = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        contributions_for_scope = self.list_contributions(site_id=site_id)
        contributor_counts: dict[str, dict[str, Any]] = {}
        payload_aliases: dict[str, str] = {}

        for item in contributions_for_scope:
            contributor_user_id = str(item.get("user_id") or "").strip()
            if not contributor_user_id:
                continue
            payload_alias = str(item.get("public_alias") or "").strip()
            if payload_alias:
                payload_aliases[contributor_user_id] = payload_alias
            entry = contributor_counts.setdefault(
                contributor_user_id,
                {
                    "user_id": contributor_user_id,
                    "contribution_count": 0,
                    "last_contribution_at": None,
                },
            )
            entry["contribution_count"] = int(entry["contribution_count"]) + 1
            created_at = str(item.get("created_at") or "").strip() or None
            if created_at and (entry["last_contribution_at"] is None or created_at > str(entry["last_contribution_at"])):
                entry["last_contribution_at"] = created_at

        alias_map = self.store.list_user_public_aliases(list(contributor_counts))
        sorted_contributors = sorted(
            contributor_counts.values(),
            key=lambda item: (
                int(item.get("contribution_count") or 0),
                str(item.get("last_contribution_at") or ""),
                str(item.get("user_id") or ""),
            ),
            reverse=True,
        )

        top_entries: list[dict[str, Any]] = []
        current_user_entry: dict[str, Any] | None = None
        normalized_user_id = str(user_id or "").strip() or None
        for rank, item in enumerate(sorted_contributors, start=1):
            contributor_user_id = str(item.get("user_id") or "").strip()
            alias = (
                payload_aliases.get(contributor_user_id)
                or alias_map.get(contributor_user_id)
                or "Anonymous member"
            )
            entry = {
                "rank": rank,
                "user_id": contributor_user_id,
                "public_alias": alias,
                "contribution_count": int(item.get("contribution_count") or 0),
                "last_contribution_at": item.get("last_contribution_at"),
                "is_current_user": contributor_user_id == normalized_user_id,
            }
            if rank <= max(1, int(limit or 5)):
                top_entries.append(entry)
            if normalized_user_id and contributor_user_id == normalized_user_id:
                current_user_entry = entry

        return {
            "scope": "site" if site_id else "global",
            "site_id": site_id,
            "leaderboard": top_entries,
            "current_user": current_user_entry,
        }

    def get_contribution_stats(self, user_id: str | None = None) -> dict[str, Any]:
        all_contribs = self.list_contributions()
        total = len(all_contribs)
        user_contribs = [item for item in all_contribs if item.get("user_id") == user_id] if user_id else []
        user_total = len(user_contribs)
        pct = round(user_total / total * 100, 1) if total > 0 else 0.0
        current_model = self.current_global_model()
        leaderboard = self.get_contribution_leaderboard(user_id=user_id, limit=5)
        current_user_entry = leaderboard.get("current_user") if isinstance(leaderboard, dict) else None
        return {
            "total_contributions": total,
            "user_contributions": user_total,
            "user_contribution_pct": pct,
            "current_model_version": current_model["version_name"] if current_model else "—",
            "user_public_alias": current_user_entry.get("public_alias") if isinstance(current_user_entry, dict) else self.store.get_user_public_alias(user_id or ""),
            "user_rank": current_user_entry.get("rank") if isinstance(current_user_entry, dict) else None,
            "leaderboard": leaderboard,
        }

    def list_aggregations(self) -> list[dict[str, Any]]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(select(aggregations).order_by(aggregations.c.created_at.desc())).all()
        return [
            self.payload_record(row, "payload_json", ["aggregation_id", "architecture", "created_at", "total_cases"])
            for row in rows
        ]

    def write_audit_event(
        self,
        *,
        actor_type: str,
        actor_id: str | None,
        action: str,
        target_type: str,
        target_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        record = {
            "event_id": make_id("audit"),
            "actor_type": str(actor_type or "").strip() or "system",
            "actor_id": str(actor_id or "").strip() or None,
            "action": str(action or "").strip(),
            "target_type": str(target_type or "").strip(),
            "target_id": str(target_id or "").strip() or None,
            "payload_json": dict(payload or {}),
            "created_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(audit_events.insert().values(**record))
        return self._audit_event_row_to_dict(record)

    def list_audit_events(self, *, limit: int = 20) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit or 20), 100))
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(
                select(audit_events).order_by(audit_events.c.created_at.desc()).limit(normalized_limit)
            ).mappings().all()
        return [self._audit_event_row_to_dict(row) for row in rows]

    def create_admin_job(
        self,
        *,
        job_type: str,
        payload: dict[str, Any] | None = None,
        status: str = "running",
    ) -> dict[str, Any]:
        record = {
            "job_id": make_id("job"),
            "job_type": str(job_type or "").strip(),
            "status": str(status or "running").strip() or "running",
            "payload_json": dict(payload or {}),
            "result_json": None,
            "error_text": None,
            "created_at": utc_now(),
            "updated_at": None,
            "started_at": utc_now() if str(status or "").strip().lower() == "running" else None,
            "finished_at": None,
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(admin_jobs.insert().values(**record))
        return self._admin_job_row_to_dict(record)

    def update_admin_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        payload: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        normalized_job_id = str(job_id or "").strip()
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(admin_jobs).where(admin_jobs.c.job_id == normalized_job_id)
            ).mappings().first()
            if existing is None:
                raise ValueError(f"Unknown admin job: {normalized_job_id}")
            now = utc_now()
            next_status = str(status or existing.get("status") or "").strip() or str(existing.get("status") or "running")
            values: dict[str, Any] = {
                "status": next_status,
                "payload_json": dict(payload) if payload is not None else existing.get("payload_json"),
                "result_json": result if result is not None else existing.get("result_json"),
                "error_text": error if error is not None else existing.get("error_text"),
                "updated_at": now,
            }
            if next_status == "running" and not existing.get("started_at"):
                values["started_at"] = now
            if next_status in {"done", "failed", "cancelled"}:
                values["finished_at"] = now
            conn.execute(
                update(admin_jobs).where(admin_jobs.c.job_id == normalized_job_id).values(**values)
            )
            row = conn.execute(
                select(admin_jobs).where(admin_jobs.c.job_id == normalized_job_id)
            ).mappings().first()
        if row is None:
            raise ValueError(f"Unknown admin job: {normalized_job_id}")
        return self._admin_job_row_to_dict(row)

    def list_admin_jobs(
        self,
        *,
        job_type: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        query = select(admin_jobs).order_by(admin_jobs.c.created_at.desc())
        normalized_job_type = str(job_type or "").strip()
        normalized_status = str(status or "").strip()
        if normalized_job_type:
            query = query.where(admin_jobs.c.job_type == normalized_job_type)
        if normalized_status:
            query = query.where(admin_jobs.c.status == normalized_status)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [self._admin_job_row_to_dict(row) for row in rows]

    def get_admin_job(self, job_id: str) -> dict[str, Any] | None:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(admin_jobs).where(admin_jobs.c.job_id == normalized_job_id)
            ).mappings().first()
        if row is None:
            return None
        return self._admin_job_row_to_dict(row)

    def register_aggregation(
        self,
        base_model_version_id: str,
        new_model_path: str,
        new_version_name: str,
        architecture: str,
        site_weights: dict[str, int],
        requires_medsam_crop: bool = False,
        decision_threshold: float | None = None,
        threshold_selection_metric: str | None = None,
        threshold_selection_metrics: dict[str, Any] | None = None,
        aggregation_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        agg_id = make_id("agg")
        record = {
            "aggregation_id": agg_id,
            "base_model_version_id": base_model_version_id,
            "new_version_name": new_version_name,
            "architecture": architecture,
            "site_weights": site_weights,
            "total_cases": sum(site_weights.values()),
            "created_at": utc_now(),
        }
        if aggregation_metadata:
            record.update({key: value for key, value in aggregation_metadata.items() if value is not None})
        if isinstance(record.get("dp_budget"), dict):
            dp_budget = dict(record["dp_budget"])
            if dp_budget.get("formal_dp_accounting"):
                dp_budget.setdefault("last_accounted_aggregation_id", agg_id)
                dp_budget.setdefault("last_accounted_at", record["created_at"])
                dp_budget.setdefault("last_accounted_new_version_name", new_version_name)
                dp_budget.setdefault("last_accounted_base_model_version_id", base_model_version_id)
            record["dp_budget"] = dp_budget
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(
                aggregations.insert().values(
                    aggregation_id=agg_id,
                    base_model_version_id=base_model_version_id,
                    new_version_name=new_version_name,
                    architecture=architecture,
                    total_cases=sum(site_weights.values()),
                    created_at=record["created_at"],
                    payload_json=record,
                )
            )
        new_version = {
            "version_id": make_id("model"),
            "version_name": new_version_name,
            "model_name": "keratitis_cls",
            "architecture": architecture,
            "stage": "global",
            "base_version_id": base_model_version_id,
            "model_path": new_model_path,
            "filename": Path(new_model_path).name if str(new_model_path).strip() else "",
            "created_at": utc_now(),
            "aggregation_id": agg_id,
            "requires_medsam_crop": bool(requires_medsam_crop),
            "training_input_policy": "medsam_cornea_crop_only" if requires_medsam_crop else "raw_or_model_defined",
            "decision_threshold": float(decision_threshold) if decision_threshold is not None else 0.5,
            "threshold_selection_metric": threshold_selection_metric or "inherited_from_base_model",
            "threshold_selection_metrics": threshold_selection_metrics,
            "publish_required": MODEL_DISTRIBUTION_MODE == "download_url",
            "is_current": MODEL_DISTRIBUTION_MODE != "download_url",
            "ready": True,
            "notes": f"Federated aggregation of {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
            "notes_ko": f"{len(site_weights)}개 사이트, 총 {sum(site_weights.values())}개 케이스의 Federated aggregation 결과입니다.",
            "notes_en": f"Federated aggregation result from {len(site_weights)} site(s), {sum(site_weights.values())} cases.",
        }
        self.ensure_model_version(new_version)
        return record
