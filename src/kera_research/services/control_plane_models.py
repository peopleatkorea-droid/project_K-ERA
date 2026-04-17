from __future__ import annotations

from pathlib import Path
from typing import Any

import requests

from kera_research.db import DATABASE_TOPOLOGY
from kera_research.services.bundled_model_seed import ensure_bundled_current_model, reference_matches_bundled_seed
from kera_research.services.model_artifacts import ModelArtifactStore
from kera_research.services.preferred_operating_models import preferred_operating_model_versions


class ControlPlaneModelFacade:
    def __init__(self, store: Any) -> None:
        self.store = store

    def _model_reference_is_usable(self, model_reference: dict[str, Any] | None) -> bool:
        if not isinstance(model_reference, dict) or not model_reference:
            return False
        if reference_matches_bundled_seed(model_reference) is not None:
            return True
        download_url = str(model_reference.get("download_url") or "").strip()
        try:
            ModelArtifactStore().resolve_model_path(model_reference, allow_download=False)
            return True
        except FileNotFoundError:
            return bool(download_url)
        except Exception:
            local_path = str(model_reference.get("model_path") or model_reference.get("local_path") or "").strip()
            return bool(local_path) and Path(local_path).expanduser().exists()

    def _select_local_current_model(self) -> dict[str, Any] | None:
        local_current = ensure_bundled_current_model(self.store)
        if self._model_reference_is_usable(local_current):
            return reference_matches_bundled_seed(local_current) or local_current

        registry_current = self.store.registry.current_global_model()
        if self._model_reference_is_usable(registry_current):
            return reference_matches_bundled_seed(registry_current) or registry_current

        for preferred_model in preferred_operating_model_versions():
            self.store.registry.ensure_model_version(preferred_model)

        registry_current = self.store.registry.current_global_model()
        if self._model_reference_is_usable(registry_current):
            return reference_matches_bundled_seed(registry_current) or registry_current

        local_versions = [
            item
            for item in self.store.registry.list_model_versions()
            if item.get("stage") == "global" and item.get("ready", True)
        ]
        usable_versions = [item for item in local_versions if self._model_reference_is_usable(item)]
        if not usable_versions:
            return None

        chosen = sorted(
            usable_versions,
            key=lambda item: (
                1 if item.get("is_current") else 0,
                str(item.get("created_at") or ""),
                str(item.get("version_id") or ""),
            ),
        )[-1]
        promoted = self.store.registry.ensure_model_version({**chosen, "is_current": True})
        return reference_matches_bundled_seed(promoted) or promoted

    def list_model_versions(self) -> list[dict[str, Any]]:
        remote_release = self.store._remote_current_release_manifest()
        if remote_release is not None:
            self.store._cache_remote_release_locally(remote_release)
        return self.store.registry.list_model_versions()

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        return self.store.registry.ensure_model_version(model_metadata)

    def current_global_model(self) -> dict[str, Any] | None:
        use_remote_release = DATABASE_TOPOLOGY.get("control_plane_connection_mode") == "remote_api_cache"
        remote_release = self.store._remote_current_release_manifest() if use_remote_release else None
        if remote_release is not None:
            normalized_remote_release = self.store._normalize_remote_release(remote_release)
            effective_remote_release = (
                reference_matches_bundled_seed(normalized_remote_release) or normalized_remote_release
            )
            if self._model_reference_is_usable(effective_remote_release):
                return effective_remote_release
        return self._select_local_current_model()

    def local_current_model(self) -> dict[str, Any] | None:
        return self._select_local_current_model()

    def archive_model_version(self, version_id: str) -> dict[str, Any]:
        return self.store.registry.archive_model_version(version_id)

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        incoming_fingerprint = str(update_metadata.get("salt_fingerprint") or "").strip()
        if incoming_fingerprint and incoming_fingerprint != self.store.case_reference_salt_fingerprint():
            raise ValueError(
                f"Salt fingerprint mismatch: the submitting site uses a different "
                f"KERA_CASE_REFERENCE_SALT (site fingerprint: {incoming_fingerprint!r}, "
                f"server fingerprint: {self.store.case_reference_salt_fingerprint()!r}). "
                "All nodes in a federation must share the same KERA_CASE_REFERENCE_SALT "
                "environment variable to ensure consistent case reference IDs."
            )

        normalized_update = self.store.normalize_model_update_artifact_metadata(
            self.store._normalize_case_reference(update_metadata)
        )
        if self.store.remote_node_sync_enabled():
            review_thumbnail_url = str(normalized_update.get("review_thumbnail_url") or "").strip() or None
            remote_payload = self.store.sanitize_remote_payload(normalized_update)
            try:
                remote_record = self.store.remote_control_plane.upload_model_update(
                    base_model_version_id=str(normalized_update.get("base_model_version_id") or "").strip() or None,
                    payload_json=remote_payload if isinstance(remote_payload, dict) else {},
                    review_thumbnail_url=review_thumbnail_url,
                )
            except (requests.RequestException, RuntimeError) as exc:
                local_record = self.store.registry.register_model_update(normalized_update)
                local_record["control_plane_source"] = "local_fallback"
                local_record["remote_sync_error"] = str(exc)
                return local_record

            merged = dict(normalized_update)
            merged["control_plane_source"] = "remote"
            merged["remote_status"] = str(remote_record.get("status") or "").strip() or None
            merged["status"] = (
                "pending_review"
                if merged["remote_status"] == "pending"
                else (merged["remote_status"] or merged.get("status"))
            )
            merged["update_id"] = str(remote_record.get("update_id") or merged.get("update_id") or "").strip()
            if remote_record.get("created_at"):
                merged["created_at"] = remote_record["created_at"]
            if remote_record.get("site_id"):
                merged["site_id"] = remote_record["site_id"]
            if remote_record.get("node_id"):
                merged["node_id"] = remote_record["node_id"]
            merged.pop("artifact_path", None)
            merged.pop("central_artifact_path", None)
            cached = self.store.registry.register_model_update(merged)
            cached["control_plane_source"] = "remote"
            cached["remote_status"] = merged.get("remote_status")
            return cached

        return self.store.registry.register_model_update(normalized_update)

    def get_model_update(self, update_id: str) -> dict[str, Any] | None:
        return self.store.registry.get_model_update(update_id)

    def update_model_update(self, update_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        return self.store.registry.update_model_update(update_id, updates)

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        self.store.registry.update_model_update_statuses(update_ids, status)

    def review_model_update(
        self,
        update_id: str,
        reviewer_user_id: str,
        decision: str,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        return self.store.registry.review_model_update(update_id, reviewer_user_id, decision, reviewer_notes)

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        return self.store.registry.list_model_updates(site_id)

    def list_aggregations(self) -> list[dict[str, Any]]:
        return self.store.registry.list_aggregations()

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
        return self.store.registry.register_aggregation(
            base_model_version_id,
            new_model_path,
            new_version_name,
            architecture,
            site_weights,
            requires_medsam_crop=requires_medsam_crop,
            decision_threshold=decision_threshold,
            threshold_selection_metric=threshold_selection_metric,
            threshold_selection_metrics=threshold_selection_metrics,
            aggregation_metadata=aggregation_metadata,
        )

    def publish_model_update_artifact(
        self,
        update_id: str,
        *,
        download_url: str,
        artifact_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self.store.registry.get_model_update(update_id)
        if current is None:
            raise ValueError(f"Unknown update_id: {update_id}")
        normalized_download_url = str(download_url or "").strip()
        if not normalized_download_url:
            raise ValueError("download_url is required.")

        normalized = self.store.normalize_model_update_artifact_metadata(current)
        try:
            artifact_path = self.store.resolve_model_update_artifact_path(current, allow_download=False)
        except FileNotFoundError:
            artifact_path = None

        updates: dict[str, Any] = {
            "artifact_download_url": normalized_download_url,
            "artifact_source_provider": self.store.infer_remote_source_provider(normalized_download_url),
            "artifact_distribution_status": "published",
            "central_artifact_key": normalized.get("central_artifact_key"),
            "central_artifact_path": None,
        }
        extra_metadata = dict(artifact_metadata or {})
        if extra_metadata:
            source_provider = str(extra_metadata.get("source_provider") or "").strip()
            if source_provider:
                updates["artifact_source_provider"] = source_provider
            distribution_status = str(extra_metadata.get("distribution_status") or "").strip()
            if distribution_status:
                updates["artifact_distribution_status"] = distribution_status
            metadata_key_map = {
                "onedrive_drive_id": "onedrive_drive_id",
                "onedrive_item_id": "onedrive_item_id",
                "onedrive_remote_path": "onedrive_remote_path",
                "onedrive_web_url": "onedrive_web_url",
                "onedrive_share_url": "onedrive_share_url",
                "onedrive_share_scope": "onedrive_share_scope",
                "onedrive_share_type": "onedrive_share_type",
                "onedrive_share_error": "onedrive_share_error",
            }
            for source_key, target_key in metadata_key_map.items():
                source_value = extra_metadata.get(source_key)
                if source_value not in (None, ""):
                    updates[target_key] = source_value
        if artifact_path is not None and artifact_path.exists():
            updates["central_artifact_name"] = artifact_path.name
            updates["central_artifact_size_bytes"] = int(artifact_path.stat().st_size)
            updates["central_artifact_sha256"] = self.store._sha256_file(artifact_path)
        return self.store.registry.update_model_update(update_id, updates)
