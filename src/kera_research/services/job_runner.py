from __future__ import annotations

import json
import os
import inspect
import time
from pathlib import Path
from typing import Any, Callable

from kera_research.config import MODEL_DIR
from kera_research.domain import is_dual_input_training_architecture, make_id
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.ssl_archive import scan_ssl_archive, write_ssl_archive_outputs
from kera_research.services.ssl_pretraining import SSLTrainingConfig, run_ssl_pretraining_with_progress

WorkflowFactory = Callable[[ControlPlaneStore], Any]

QUEUE_BY_JOB_TYPE = {
    "initial_training": "training",
    "initial_training_benchmark": "training",
    "cross_validation": "training",
    "ssl_pretraining": "training",
    "site_validation": "validation",
}


def queue_name_for_job_type(job_type: str) -> str:
    return QUEUE_BY_JOB_TYPE.get(job_type, "default")


def benchmark_crop_mode_for_architecture(base_crop_mode: str, architecture: str) -> str:
    normalized_crop_mode = str(base_crop_mode or "automated").strip().lower() or "automated"
    normalized_architecture = str(architecture or "").strip().lower()
    if is_dual_input_training_architecture(normalized_architecture):
        return "paired"
    if normalized_crop_mode == "paired":
        return "automated"
    return normalized_crop_mode


class JobCancelledError(RuntimeError):
    def __init__(self, message: str = "Job cancelled.", *, response: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.response = response


class SiteJobWorker:
    def __init__(
        self,
        control_plane: ControlPlaneStore | None = None,
        *,
        worker_id: str | None = None,
        queue_names: list[str] | None = None,
        workflow_factory: WorkflowFactory | None = None,
        stale_job_seconds: int = 60 * 60 * 4,
    ) -> None:
        self.control_plane = control_plane or ControlPlaneStore()
        self.worker_id = worker_id or f"{os.getpid()}-{make_id('worker')[:8]}"
        self.queue_names = queue_names or ["training", "validation"]
        self.workflow_factory = workflow_factory or (lambda cp: ResearchWorkflowService(cp))
        self.stale_job_seconds = max(60, int(stale_job_seconds))
        self._workflow: Any | None = None

    def _workflow_service(self) -> Any:
        if self._workflow is None:
            self._workflow = self.workflow_factory(self.control_plane)
        return self._workflow

    def _call_with_supported_kwargs(self, func: Any, /, **kwargs: Any) -> Any:
        signature = inspect.signature(func)
        if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
            return func(**kwargs)
        supported_kwargs = {key: value for key, value in kwargs.items() if key in signature.parameters}
        return func(**supported_kwargs)

    def _heartbeat(self, job_id: str) -> None:
        SiteStore.heartbeat_job(job_id, self.worker_id)

    def _job_cancel_requested(self, site_store: SiteStore, job_id: str) -> bool:
        current_job = site_store.get_job(job_id)
        if current_job is None:
            return False
        return str(current_job.get("status") or "").strip().lower() in {"cancelling", "cancelled"}

    def _raise_if_cancel_requested(self, site_store: SiteStore, job_id: str, message: str = "Job cancelled.") -> None:
        if self._job_cancel_requested(site_store, job_id):
            raise JobCancelledError(message)

    def _update_progress(self, site_store: SiteStore, job_id: str, progress_payload: dict[str, Any]) -> None:
        self._raise_if_cancel_requested(site_store, job_id)
        site_store.update_job_status(job_id, "running", {"progress": progress_payload})
        self._heartbeat(job_id)

    def _resolve_model_version(self, model_version_id: str | None) -> dict[str, Any]:
        if model_version_id:
            model_version = next(
                (item for item in self.control_plane.list_model_versions() if item.get("version_id") == model_version_id),
                None,
            )
        else:
            model_version = self.control_plane.current_global_model()
        if model_version is None or not model_version.get("ready", True):
            raise ValueError("No ready model version is available.")
        return model_version

    def _resolve_ssl_checkpoint_path(self, site_store: SiteStore, architecture: str) -> str:
        workflow = self._workflow_service()
        expected_backbone = workflow.model_manager.ssl_backbone_architecture_for_model(architecture)
        runs_root = site_store.artifact_dir / "ssl_pretraining"
        if not runs_root.exists():
            raise FileNotFoundError(f"SSL pretraining directory does not exist: {runs_root}")
        run_directories = sorted(
            (item for item in runs_root.iterdir() if item.is_dir()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        for run_dir in run_directories:
            summary_path = run_dir / "training" / "training_summary.json"
            if not summary_path.exists():
                continue
            try:
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            config = summary.get("config") if isinstance(summary.get("config"), dict) else {}
            checkpoint_architecture = str(config.get("architecture") or summary.get("architecture") or "").strip().lower()
            encoder_latest_path = Path(str(summary.get("encoder_latest_path") or "")).expanduser()
            if checkpoint_architecture != expected_backbone or not encoder_latest_path.exists():
                continue
            return str(encoder_latest_path.resolve())
        raise FileNotFoundError(
            f"No SSL encoder checkpoint was found for {expected_backbone} under {runs_root}."
        )

    def _handle_initial_training(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        payload = dict(job.get("payload") or {})
        workflow = self._workflow_service()
        output_model_path = str(payload.get("output_model_path") or (MODEL_DIR / f"global_{payload['architecture']}_{make_id('init')[:8]}.pth"))
        pretraining_source = str(payload.get("pretraining_source") or "").strip().lower() or None
        ssl_checkpoint_path = str(payload.get("ssl_checkpoint_path") or "").strip() or None
        if pretraining_source == "ssl" and not ssl_checkpoint_path:
            ssl_checkpoint_path = self._resolve_ssl_checkpoint_path(site_store, str(payload["architecture"]))
        self._raise_if_cancel_requested(site_store, job["job_id"], "Initial training cancelled.")

        def update_progress(progress_payload: dict[str, Any]) -> None:
            self._update_progress(site_store, job["job_id"], progress_payload)

        result = self._call_with_supported_kwargs(
            workflow.run_initial_training,
            site_store=site_store,
            architecture=str(payload["architecture"]),
            output_model_path=output_model_path,
            execution_device=str(payload["execution_device"]),
            crop_mode=str(payload.get("crop_mode") or "automated"),
            epochs=int(payload.get("epochs") or 30),
            learning_rate=float(payload.get("learning_rate") or 1e-4),
            batch_size=int(payload.get("batch_size") or 16),
            val_split=float(payload.get("val_split") or 0.2),
            test_split=float(payload.get("test_split") or 0.2),
            use_pretrained=bool(payload.get("use_pretrained", True)),
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=str(payload.get("case_aggregation") or "mean"),
            use_medsam_crops=True,
            regenerate_split=bool(payload.get("regenerate_split", False)),
            progress_callback=update_progress,
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": str(payload["execution_device"]),
            "result": result,
            "model_version": result.get("model_version"),
        }

    def _handle_initial_training_benchmark(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        payload = dict(job.get("payload") or {})
        workflow = self._workflow_service()
        architectures = [str(item).strip() for item in payload.get("architectures") or [] if str(item).strip()]
        results: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        requested_crop_mode = str(payload.get("crop_mode") or "automated")
        pretraining_source = str(payload.get("pretraining_source") or "").strip().lower() or None
        self._raise_if_cancel_requested(site_store, job["job_id"], "Benchmark training cancelled.")

        def build_partial_response() -> dict[str, Any]:
            completed_architectures = [
                str(item.get("architecture") or "").strip()
                for item in results
                if str(item.get("architecture") or "").strip()
            ]
            completed_set = set(completed_architectures)
            remaining_architectures = [architecture for architecture in architectures if architecture not in completed_set]
            best_entry = max(results, key=lambda item: float((item.get("result") or {}).get("best_val_acc") or 0.0)) if results else None
            return {
                "site_id": site_store.site_id,
                "execution_device": str(payload["execution_device"]),
                "architectures": architectures,
                "results": results,
                "failures": failures,
                "completed_architectures": completed_architectures,
                "remaining_architectures": remaining_architectures,
                "benchmark_suite_key": str(payload.get("benchmark_suite_key") or "").strip() or None,
                "best_architecture": best_entry.get("architecture") if best_entry else None,
                "best_model_version": best_entry.get("model_version") if best_entry else None,
            }

        for architecture_index, architecture in enumerate(architectures, start=1):
            self._raise_if_cancel_requested(site_store, job["job_id"], "Benchmark training cancelled.")
            crop_mode = benchmark_crop_mode_for_architecture(requested_crop_mode, architecture)
            output_model_path = str(MODEL_DIR / f"global_{architecture}_{make_id('bench')[:8]}.pth")
            ssl_checkpoint_path = str(payload.get("ssl_checkpoint_path") or "").strip() or None
            if pretraining_source == "ssl" and not ssl_checkpoint_path:
                ssl_checkpoint_path = self._resolve_ssl_checkpoint_path(site_store, architecture)

            def update_progress(progress_payload: dict[str, Any]) -> None:
                self._raise_if_cancel_requested(site_store, job["job_id"], "Benchmark training cancelled.")
                child_percent = int(progress_payload.get("percent", 0) or 0)
                overall_percent = int(((architecture_index - 1) + (child_percent / 100.0)) / max(len(architectures), 1) * 100)
                partial_response = build_partial_response()
                self._update_progress(
                    site_store,
                    job["job_id"],
                    {
                        **progress_payload,
                        "percent": overall_percent,
                        "architecture": architecture,
                        "architecture_index": architecture_index,
                        "architecture_count": len(architectures),
                        "completed_architectures": partial_response["completed_architectures"],
                        "remaining_architectures": partial_response["remaining_architectures"],
                        "failed_architectures": [item["architecture"] for item in failures],
                    },
                )

            try:
                result = self._call_with_supported_kwargs(
                    workflow.run_initial_training,
                    site_store=site_store,
                    architecture=architecture,
                    output_model_path=output_model_path,
                    execution_device=str(payload["execution_device"]),
                    crop_mode=crop_mode,
                    epochs=int(payload.get("epochs") or 30),
                    learning_rate=float(payload.get("learning_rate") or 1e-4),
                    batch_size=int(payload.get("batch_size") or 16),
                    val_split=float(payload.get("val_split") or 0.2),
                    test_split=float(payload.get("test_split") or 0.2),
                    use_pretrained=bool(payload.get("use_pretrained", True)),
                    pretraining_source=pretraining_source,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                    case_aggregation=str(payload.get("case_aggregation") or "mean"),
                    use_medsam_crops=True,
                    regenerate_split=bool(payload.get("regenerate_split", False)) if architecture_index == 1 else False,
                    progress_callback=update_progress,
                )
                results.append(
                    {
                        "architecture": architecture,
                        "status": "completed",
                        "result": result,
                        "model_version": result.get("model_version"),
                    }
                )
                partial_response = build_partial_response()
                self._update_progress(
                    site_store,
                    job["job_id"],
                    {
                        "stage": "benchmark_component_completed",
                        "message": f"{architecture} completed.",
                        "percent": int((architecture_index / max(len(architectures), 1)) * 100),
                        "architecture": architecture,
                        "architecture_index": architecture_index,
                        "architecture_count": len(architectures),
                        "crop_mode": crop_mode,
                        "pretraining_source": pretraining_source,
                        "case_aggregation": str(payload.get("case_aggregation") or "mean"),
                        "completed_architectures": partial_response["completed_architectures"],
                        "remaining_architectures": partial_response["remaining_architectures"],
                        "failed_architectures": [item["architecture"] for item in failures],
                    },
                )
            except JobCancelledError as exc:
                raise JobCancelledError(str(exc), response=build_partial_response()) from exc
            except Exception as exc:
                failures.append(
                    {
                        "architecture": architecture,
                        "status": "failed",
                        "error": str(exc),
                    }
                )
                partial_response = build_partial_response()
                self._update_progress(
                    site_store,
                    job["job_id"],
                    {
                        "stage": "benchmark_component_failed",
                        "message": f"{architecture} failed and the benchmark will continue.",
                        "percent": int(((architecture_index - 1) / max(len(architectures), 1)) * 100),
                        "architecture": architecture,
                        "architecture_index": architecture_index,
                        "architecture_count": len(architectures),
                        "crop_mode": crop_mode,
                        "pretraining_source": pretraining_source,
                        "case_aggregation": str(payload.get("case_aggregation") or "mean"),
                        "completed_architectures": partial_response["completed_architectures"],
                        "remaining_architectures": partial_response["remaining_architectures"],
                        "failed_architectures": [item["architecture"] for item in failures],
                    },
                )

        if not results:
            raise RuntimeError("; ".join(item["error"] for item in failures) or "Benchmark training failed.")

        return build_partial_response()

    def _handle_cross_validation(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        payload = dict(job.get("payload") or {})
        workflow = self._workflow_service()
        output_dir = str(payload.get("output_dir") or (MODEL_DIR / f"cross_validation_{make_id('cvdir')[:8]}"))
        self._raise_if_cancel_requested(site_store, job["job_id"], "Cross-validation cancelled.")

        def update_progress(progress_payload: dict[str, Any]) -> None:
            self._update_progress(site_store, job["job_id"], progress_payload)

        report = self._call_with_supported_kwargs(
            workflow.run_cross_validation,
            site_store=site_store,
            architecture=str(payload["architecture"]),
            output_dir=output_dir,
            execution_device=str(payload["execution_device"]),
            crop_mode=str(payload.get("crop_mode") or "automated"),
            num_folds=int(payload.get("num_folds") or 5),
            epochs=int(payload.get("epochs") or 10),
            learning_rate=float(payload.get("learning_rate") or 1e-4),
            batch_size=int(payload.get("batch_size") or 16),
            val_split=float(payload.get("val_split") or 0.2),
            use_pretrained=bool(payload.get("use_pretrained", True)),
            case_aggregation=str(payload.get("case_aggregation") or "mean"),
            use_medsam_crops=True,
            progress_callback=update_progress,
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": str(payload["execution_device"]),
            "report": report,
        }

    def _handle_ssl_pretraining(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        payload = dict(job.get("payload") or {})
        archive_base_dir = Path(str(payload.get("archive_base_dir") or "")).expanduser()
        if not str(archive_base_dir).strip():
            raise ValueError("archive_base_dir is required.")
        if not archive_base_dir.exists():
            raise FileNotFoundError(f"Archive directory does not exist: {archive_base_dir}")
        if not archive_base_dir.is_dir():
            raise NotADirectoryError(f"Archive directory is not a directory: {archive_base_dir}")

        run_id = make_id("ssl")
        run_root = site_store.artifact_dir / "ssl_pretraining" / run_id
        manifest_dir = run_root / "manifest"
        training_dir = run_root / "training"

        self._raise_if_cancel_requested(site_store, job["job_id"], "SSL pretraining cancelled.")
        self._update_progress(
            site_store,
            job["job_id"],
            {
                "stage": "scanning_archive",
                "message": "Scanning the SSL image archive.",
                "percent": 2,
                "run_id": run_id,
                "archive_base_dir": str(archive_base_dir.resolve()),
                "output_dir": str(training_dir),
            },
        )

        clean_rows, anomaly_rows, manifest_summary = scan_ssl_archive(archive_base_dir)
        manifest_paths = write_ssl_archive_outputs(manifest_dir, clean_rows, anomaly_rows, manifest_summary)

        progress_context = {
            "run_id": run_id,
            "archive_base_dir": str(archive_base_dir.resolve()),
            "manifest_total_images": int(manifest_summary.get("total_supported_images") or 0),
            "manifest_clean_images": int(manifest_summary.get("clean_images") or 0),
            "manifest_anomaly_images": int(manifest_summary.get("anomaly_images") or 0),
            "clean_manifest_path": manifest_paths["clean_manifest_path"],
            "anomaly_manifest_path": manifest_paths["anomaly_manifest_path"],
            "manifest_summary_path": manifest_paths["summary_path"],
            "output_dir": str(training_dir),
        }
        self._update_progress(
            site_store,
            job["job_id"],
            {
                "stage": "writing_manifest",
                "message": "Generated SSL manifests and prepared the training run.",
                "percent": 8,
                "architecture": str(payload.get("architecture") or "convnext_tiny"),
                "init_mode": str(payload.get("init_mode") or "imagenet"),
                "method": str(payload.get("method") or "byol"),
                **progress_context,
            },
        )

        def update_progress(progress_payload: dict[str, Any]) -> None:
            self._update_progress(
                site_store,
                job["job_id"],
                {
                    **progress_context,
                    **progress_payload,
                },
            )

        training_summary = run_ssl_pretraining_with_progress(
            SSLTrainingConfig(
                manifest_path=manifest_paths["clean_manifest_path"],
                output_dir=str(training_dir),
                architecture=str(payload.get("architecture") or "convnext_tiny"),
                init_mode=str(payload.get("init_mode") or "imagenet"),
                method=str(payload.get("method") or "byol"),
                image_size=int(payload.get("image_size") or 224),
                batch_size=int(payload.get("batch_size") or 24),
                epochs=int(payload.get("epochs") or 10),
                learning_rate=float(payload.get("learning_rate") or 1e-4),
                weight_decay=float(payload.get("weight_decay") or 1e-4),
                num_workers=int(payload.get("num_workers") or 8),
                device=str(payload.get("execution_device") or "auto"),
                min_patient_quality=str(payload.get("min_patient_quality") or "medium"),
                include_review_rows=bool(payload.get("include_review_rows", False)),
                use_amp=bool(payload.get("use_amp", True)),
                save_every=1,
            ),
            progress_callback=update_progress,
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": str(payload["execution_device"]),
            "run": {
                "run_id": run_id,
                "archive_base_dir": progress_context["archive_base_dir"],
                "manifest": {
                    **manifest_summary,
                    **manifest_paths,
                },
                "training": training_summary,
            },
        }

    def _handle_site_validation(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        payload = dict(job.get("payload") or {})
        workflow = self._workflow_service()
        self._raise_if_cancel_requested(site_store, job["job_id"], "Hospital validation cancelled.")
        self._update_progress(
            site_store,
            job["job_id"],
            {
                "stage": "preparing_validation",
                "message": "Hospital validation started.",
                "percent": 5,
            },
        )
        model_version = self._resolve_model_version(payload.get("model_version_id"))
        summary, _case_predictions, _manifest_df = workflow.run_external_validation(
            project_id=str(payload.get("project_id") or "default"),
            site_store=site_store,
            model_version=model_version,
            execution_device=str(payload["execution_device"]),
            generate_gradcam=bool(payload.get("generate_gradcam", True)),
            generate_medsam=bool(payload.get("generate_medsam", True)),
        )
        self._update_progress(
            site_store,
            job["job_id"],
            {
                "stage": "finalizing",
                "message": "Hospital validation completed.",
                "percent": 95,
            },
        )
        return {
            "summary": summary,
            "execution_device": str(payload["execution_device"]),
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
        }

    def _dispatch_job(self, site_store: SiteStore, job: dict[str, Any]) -> dict[str, Any]:
        job_type = str(job.get("job_type") or "")
        if job_type == "initial_training":
            return self._handle_initial_training(site_store, job)
        if job_type == "initial_training_benchmark":
            return self._handle_initial_training_benchmark(site_store, job)
        if job_type == "cross_validation":
            return self._handle_cross_validation(site_store, job)
        if job_type == "ssl_pretraining":
            return self._handle_ssl_pretraining(site_store, job)
        if job_type == "site_validation":
            return self._handle_site_validation(site_store, job)
        raise ValueError(f"Unsupported queued job type: {job_type}")

    def reclaim_stale_jobs(self) -> int:
        cutoff_epoch = time.time() - self.stale_job_seconds
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(cutoff_epoch))
        return SiteStore.requeue_stale_jobs(heartbeat_before=cutoff)

    def process_next_job(self, *, site_id: str | None = None) -> dict[str, Any] | None:
        self.reclaim_stale_jobs()
        job = SiteStore.claim_next_job(self.worker_id, queue_names=self.queue_names, site_id=site_id)
        if job is None:
            return None
        site_store = SiteStore(str(job["site_id"]))
        try:
            response = self._dispatch_job(site_store, job)
            current_job = site_store.get_job(job["job_id"]) or job
            existing_result = dict(current_job.get("result") or {})
            existing_progress = dict(existing_result.get("progress") or {})
            final_progress = {
                **existing_progress,
                "stage": "completed",
                "message": f"{job['job_type']} completed.",
                "percent": 100,
            }
            site_store.update_job_status(
                job["job_id"],
                "completed",
                {
                    **existing_result,
                    "progress": final_progress,
                    "response": response,
                },
            )
            return site_store.get_job(job["job_id"])
        except JobCancelledError as exc:
            current_job = site_store.get_job(job["job_id"]) or job
            existing_result = dict(current_job.get("result") or {})
            existing_progress = dict(existing_result.get("progress") or {})
            final_progress = {
                **existing_progress,
                "stage": "cancelled",
                "message": str(exc) or f"{job['job_type']} cancelled.",
                "percent": int(existing_progress.get("percent", 0) or 0),
            }
            final_result = {
                **existing_result,
                "progress": final_progress,
            }
            if exc.response is not None:
                final_result["response"] = exc.response
            site_store.update_job_status(job["job_id"], "cancelled", final_result)
            return site_store.get_job(job["job_id"])
        except Exception as exc:
            current_job = site_store.get_job(job["job_id"]) or job
            existing_result = dict(current_job.get("result") or {})
            existing_progress = dict(existing_result.get("progress") or {})
            site_store.update_job_status(
                job["job_id"],
                "failed",
                {
                    **existing_result,
                    "progress": {
                        **existing_progress,
                        "stage": "failed",
                        "message": f"{job['job_type']} failed.",
                        "percent": int(existing_progress.get("percent", 100) or 100),
                    },
                    "error": str(exc),
                },
            )
            return site_store.get_job(job["job_id"])

    def run_until_idle(self, *, max_jobs: int | None = None, site_id: str | None = None) -> int:
        processed = 0
        while max_jobs is None or processed < max_jobs:
            job = self.process_next_job(site_id=site_id)
            if job is None:
                break
            processed += 1
        return processed

    def run_forever(self, *, poll_interval: float = 2.0, site_id: str | None = None) -> None:
        while True:
            processed = self.run_until_idle(max_jobs=1, site_id=site_id)
            if processed == 0:
                time.sleep(max(0.1, float(poll_interval)))
