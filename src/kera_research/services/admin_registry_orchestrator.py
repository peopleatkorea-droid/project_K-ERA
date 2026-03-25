from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import threading
from typing import Any, Callable

from fastapi import HTTPException, status

from kera_research.services.model_artifacts import ModelArtifactStore
from kera_research.services.onedrive_publisher import OneDrivePublisher


class AdminRegistryOrchestrator:
    def __init__(self, *, make_id: Callable[[str], str], model_dir: Path) -> None:
        self.make_id = make_id
        self.model_dir = Path(model_dir)
        self._jobs: dict[str, dict[str, Any]] = {}
        self._jobs_lock = threading.Lock()
        self._running = threading.Event()

    def publish_model_version(
        self,
        cp: Any,
        *,
        version_id: str,
        download_url: str,
        set_current: bool,
    ) -> dict[str, Any]:
        existing = next((item for item in cp.list_model_versions() if item.get("version_id") == version_id), None)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model version.")

        normalized_download_url = str(download_url or "").strip()
        if not normalized_download_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="download_url is required.")

        local_model_path = str(existing.get("model_path") or "").strip()
        if not local_model_path or not Path(local_model_path).exists():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Local model artifact is missing; cannot publish this version.",
            )

        artifact_store = ModelArtifactStore()
        metadata = artifact_store.register_local_metadata(existing, local_path=local_model_path)
        published = cp.ensure_model_version(
            {
                **existing,
                **metadata,
                "version_id": version_id,
                "download_url": normalized_download_url,
                "source_provider": "",
                "publish_required": False,
                "distribution_status": "published",
                "ready": True,
                "is_current": bool(set_current),
                "model_path": "",
            }
        )
        return {"model_version": published}

    def auto_publish_model_version(
        self,
        cp: Any,
        *,
        version_id: str,
        set_current: bool,
    ) -> dict[str, Any]:
        existing = next((item for item in cp.list_model_versions() if item.get("version_id") == version_id), None)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model version.")

        local_model_path = str(existing.get("model_path") or "").strip()
        if not local_model_path or not Path(local_model_path).exists():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Local model artifact is missing; cannot auto-publish this version.",
            )

        artifact_store = ModelArtifactStore()
        local_metadata = artifact_store.register_local_metadata(existing, local_path=local_model_path)
        try:
            publish_metadata = OneDrivePublisher().publish_local_file(
                local_path=local_model_path,
                category="model_versions",
                artifact_id=version_id,
                filename=str(local_metadata.get("filename") or ""),
            )
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        published = cp.ensure_model_version(
            {
                **existing,
                **local_metadata,
                "version_id": version_id,
                "download_url": str(publish_metadata.get("download_url") or ""),
                "source_provider": str(publish_metadata.get("source_provider") or ""),
                "publish_required": False,
                "distribution_status": str(publish_metadata.get("distribution_status") or "published"),
                "ready": True,
                "is_current": bool(set_current),
                "model_path": "",
                "onedrive_drive_id": publish_metadata.get("onedrive_drive_id"),
                "onedrive_item_id": publish_metadata.get("onedrive_item_id"),
                "onedrive_remote_path": publish_metadata.get("onedrive_remote_path"),
                "onedrive_web_url": publish_metadata.get("onedrive_web_url"),
                "onedrive_share_url": publish_metadata.get("onedrive_share_url"),
                "onedrive_share_scope": publish_metadata.get("onedrive_share_scope"),
                "onedrive_share_type": publish_metadata.get("onedrive_share_type"),
                "onedrive_share_error": publish_metadata.get("onedrive_share_error"),
            }
        )
        return {"model_version": published}

    def activate_local_model_version(
        self,
        cp: Any,
        *,
        version_id: str,
    ) -> dict[str, Any]:
        existing = next((item for item in cp.list_model_versions() if item.get("version_id") == version_id), None)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model version.")

        local_model_path = str(existing.get("model_path") or "").strip()
        if not local_model_path or not Path(local_model_path).exists():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Local model artifact is missing; cannot activate this version.",
            )

        activated = cp.ensure_model_version(
            {
                **existing,
                "version_id": version_id,
                "publish_required": False,
                "distribution_status": str(existing.get("distribution_status") or "local_only"),
                "ready": True,
                "is_current": True,
            }
        )
        return {"model_version": activated}

    def review_model_update(
        self,
        cp: Any,
        *,
        update_id: str,
        reviewer_user_id: str,
        decision: str,
        reviewer_notes: str | None,
        get_workflow: Callable[[Any], Any],
    ) -> dict[str, Any]:
        if decision.strip().lower() == "approved":
            try:
                delta_path = cp.resolve_model_update_artifact_path(cp.get_model_update(update_id))
            except (FileNotFoundError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Delta artifact file is missing; cannot approve: {exc}",
                ) from exc
            try:
                import torch as _torch

                checkpoint = _torch.load(delta_path, map_location="cpu", weights_only=True)
                delta_state = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else None
                if delta_state is None:
                    raise ValueError("Delta file has no state_dict key.")
                workflow = get_workflow(cp)
                workflow.model_manager._validate_deltas([delta_state])
            except ValueError as exc:
                cp.review_model_update(
                    update_id,
                    reviewer_user_id=reviewer_user_id,
                    decision="rejected",
                    reviewer_notes=f"[Auto-rejected by validation] {exc}",
                )
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Delta validation failed; update auto-rejected: {exc}",
                ) from exc
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Delta file could not be loaded: {exc}",
                ) from exc

        try:
            reviewed = cp.review_model_update(
                update_id,
                reviewer_user_id=reviewer_user_id,
                decision=decision,
                reviewer_notes=reviewer_notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"update": reviewed}

    def publish_model_update(
        self,
        cp: Any,
        *,
        update_id: str,
        download_url: str,
    ) -> dict[str, Any]:
        try:
            return {"update": cp.publish_model_update_artifact(update_id, download_url=download_url)}
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    def auto_publish_model_update(self, cp: Any, *, update_id: str) -> dict[str, Any]:
        current = cp.get_model_update(update_id)
        if current is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown model update.")
        try:
            artifact_path = cp.resolve_model_update_artifact_path(current, allow_download=False)
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Local delta artifact is missing; cannot auto-publish this update: {exc}",
            ) from exc
        try:
            publish_metadata = OneDrivePublisher().publish_local_file(
                local_path=artifact_path,
                category="model_updates",
                artifact_id=update_id,
                filename=str(current.get("central_artifact_name") or artifact_path.name),
            )
            published = cp.publish_model_update_artifact(
                update_id,
                download_url=str(publish_metadata.get("download_url") or ""),
                artifact_metadata=publish_metadata,
            )
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"update": published}

    def run_federated_aggregation(
        self,
        cp: Any,
        *,
        get_workflow: Callable[[Any], Any],
        selected_update_ids: list[str],
        new_version_name: str | None,
    ) -> dict[str, Any]:
        if self._running.is_set():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another aggregation job is already running. Poll /api/admin/aggregations/jobs to check status.",
            )

        workflow = get_workflow(cp)
        selected_ids = set(selected_update_ids)
        approved_updates = [
            item
            for item in cp.list_model_updates()
            if item.get("status") == "approved" and (not selected_ids or item.get("update_id") in selected_ids)
        ]
        if not approved_updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No approved updates are available for aggregation.",
            )

        site_update_counts: dict[str, int] = {}
        for item in approved_updates:
            site_key = str(item.get("site_id") or "unknown")
            site_update_counts[site_key] = site_update_counts.get(site_key, 0) + 1
        duplicate_sites = sorted(site_id for site_id, count in site_update_counts.items() if count > 1)
        if duplicate_sites:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only one approved update per site can be aggregated at a time. Duplicate sites: {', '.join(duplicate_sites)}.",
            )

        architectures = {item.get("architecture") for item in approved_updates}
        if len(architectures) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates with the same architecture can be aggregated together.",
            )
        architecture = next(iter(architectures))

        base_model_ids = {item.get("base_model_version_id") for item in approved_updates}
        if len(base_model_ids) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only updates based on the same global model can be aggregated together.",
            )
        base_model_version_id = next(iter(base_model_ids))
        base_model = next(
            (item for item in cp.list_model_versions() if item.get("version_id") == base_model_version_id),
            cp.current_global_model(),
        )
        if base_model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No global model is available for aggregation.",
            )

        try:
            delta_paths = [str(cp.resolve_model_update_artifact_path(item)) for item in approved_updates]
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"One or more approved update artifacts are unavailable: {exc}",
            ) from exc

        site_weights: dict[str, int] = {}
        delta_weights: list[int] = []
        for update_record in approved_updates:
            site_key = str(update_record.get("site_id") or "unknown")
            n_cases = max(1, int(update_record.get("n_cases", 1) or 1))
            site_weights[site_key] = site_weights.get(site_key, 0) + n_cases
            delta_weights.append(n_cases)

        resolved_version_name = (new_version_name or "").strip() or f"global-{architecture}-fedavg-{self.make_id('v')[:6]}"
        output_path = self.model_dir / f"global_{architecture}_{self.make_id('agg')}.pth"
        update_ids = [item["update_id"] for item in approved_updates]

        job_id = self.make_id("job")
        job_record: dict[str, Any] = {
            "job_id": job_id,
            "status": "running",
            "result": None,
            "error": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }
        with self._jobs_lock:
            self._jobs[job_id] = job_record

        def run() -> None:
            self._running.set()
            try:
                workflow.model_manager.aggregate_weight_deltas(
                    delta_paths,
                    output_path,
                    weights=delta_weights,
                    base_model_path=workflow.model_manager.resolve_model_path(base_model, allow_download=True),
                )
                aggregation = cp.register_aggregation(
                    base_model_version_id=base_model["version_id"],
                    new_model_path=str(output_path),
                    new_version_name=resolved_version_name,
                    architecture=str(architecture or base_model.get("architecture") or "unknown"),
                    site_weights=site_weights,
                    requires_medsam_crop=bool(base_model.get("requires_medsam_crop", False)),
                    decision_threshold=base_model.get("decision_threshold"),
                    threshold_selection_metric="inherited_from_base_model",
                    threshold_selection_metrics={
                        "source_model_version_id": base_model.get("version_id"),
                        "source_decision_threshold": base_model.get("decision_threshold"),
                    },
                )
                cp.update_model_update_statuses(update_ids, "aggregated")
                model_version = next(
                    (item for item in cp.list_model_versions() if item.get("aggregation_id") == aggregation["aggregation_id"]),
                    cp.current_global_model(),
                )
                with self._jobs_lock:
                    self._jobs[job_id].update(
                        {
                            "status": "done",
                            "result": {
                                "aggregation": aggregation,
                                "model_version": model_version,
                                "aggregated_update_ids": update_ids,
                            },
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
            except Exception as exc:
                with self._jobs_lock:
                    self._jobs[job_id].update(
                        {
                            "status": "failed",
                            "error": str(exc),
                            "finished_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
            finally:
                self._running.clear()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        thread.join(timeout=0.25)

        job_snapshot = self.get_aggregation_job(job_id)
        if job_snapshot.get("status") == "done" and isinstance(job_snapshot.get("result"), dict):
            return job_snapshot["result"]
        if job_snapshot.get("status") == "failed":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(job_snapshot.get("error") or "Aggregation job failed."),
            )

        return {"job_id": job_id, "status": "running"}

    def list_aggregation_jobs(self) -> list[dict[str, Any]]:
        with self._jobs_lock:
            return [dict(job) for job in self._jobs.values()]

    def get_aggregation_job(self, job_id: str) -> dict[str, Any]:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aggregation job not found.")
        return dict(job)
