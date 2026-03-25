from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.config import STORAGE_DIR
from kera_research.domain import MODEL_ARCHITECTURES, make_id, utc_now
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import SSL_BACKBONE_ARCHITECTURE_BY_MODEL
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.ssl_archive import scan_ssl_archive, write_ssl_archive_outputs
from kera_research.services.ssl_pretraining import (
    SSLTrainingConfig,
    SUPPORTED_SSL_ARCHITECTURES,
    resolve_device,
    run_ssl_pretraining,
)

LOGGER = logging.getLogger("ssl_overnight_plan")

DEFAULT_SSL_BATCH_SIZE = {
    "densenet121": 24,
    "convnext_tiny": 24,
    "swin": 12,
    "vit": 12,
    "dinov2": 6,
    "efficientnet_v2_s": 24,
}
DEFAULT_BENCHMARK_ARCHITECTURES = [
    "densenet121",
    "convnext_tiny",
    "vit",
    "swin",
    "efficientnet_v2_s",
    "dinov2",
    "dinov2_mil",
    "dual_input_concat",
]


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run an overnight SSL + downstream benchmark plan sequentially.",
    )
    parser.add_argument("--archive-base-dir", type=Path, default=Path(r"C:\전안부 사진"))
    parser.add_argument("--site-id", default="", help="Site ID for downstream benchmark. Default: auto-detect largest non-empty site.")
    parser.add_argument("--device", default="cuda", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--plan-root", type=Path, default=None)
    parser.add_argument(
        "--wait-existing-ssl-run",
        type=Path,
        default=REPO_ROOT / "artifacts" / "ssl_runs" / "byol_convnext_tiny_imagenet_bg_20260325_133854",
        help="If provided, wait for an existing SSL run to complete and reuse its encoder.",
    )
    parser.add_argument(
        "--existing-ssl-architecture",
        default="convnext_tiny",
        choices=list(SUPPORTED_SSL_ARCHITECTURES),
    )
    parser.add_argument(
        "--ssl-architectures",
        nargs="+",
        default=["efficientnet_v2_s", "densenet121", "swin", "vit", "dinov2"],
        choices=list(SUPPORTED_SSL_ARCHITECTURES),
    )
    parser.add_argument("--ssl-init-mode", default="imagenet", choices=["imagenet", "random"])
    parser.add_argument("--ssl-image-size", type=int, default=224)
    parser.add_argument("--ssl-epochs", type=int, default=10)
    parser.add_argument("--ssl-learning-rate", type=float, default=1e-4)
    parser.add_argument("--ssl-weight-decay", type=float, default=1e-4)
    parser.add_argument("--ssl-num-workers", type=int, default=8)
    parser.add_argument("--ssl-min-patient-quality", default="medium", choices=["low", "medium", "high"])
    parser.add_argument("--ssl-include-review-rows", action="store_true")
    parser.add_argument("--ssl-disable-amp", action="store_true")
    parser.add_argument(
        "--benchmark-architectures",
        nargs="+",
        default=DEFAULT_BENCHMARK_ARCHITECTURES,
        choices=MODEL_ARCHITECTURES,
    )
    parser.add_argument("--benchmark-crop-mode", default="automated", choices=["automated", "manual", "both", "paired"])
    parser.add_argument("--benchmark-case-aggregation", default="mean", choices=["mean", "logit_mean", "quality_weighted_mean", "attention_mil"])
    parser.add_argument("--benchmark-epochs", type=int, default=30)
    parser.add_argument("--benchmark-learning-rate", type=float, default=1e-4)
    parser.add_argument("--benchmark-batch-size", type=int, default=16)
    parser.add_argument("--benchmark-val-split", type=float, default=0.2)
    parser.add_argument("--benchmark-test-split", type=float, default=0.2)
    parser.add_argument("--benchmark-regenerate-split", action="store_true")
    parser.add_argument("--benchmark-scratch-fallback", action="store_true")
    parser.add_argument("--skip-benchmark", action="store_true")
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def benchmark_crop_mode_for_architecture(base_crop_mode: str, architecture: str) -> str:
    normalized_crop_mode = str(base_crop_mode or "automated").strip().lower() or "automated"
    normalized_architecture = str(architecture or "").strip().lower()
    if normalized_architecture == "dual_input_concat":
        return "paired"
    if normalized_crop_mode == "paired":
        return "automated"
    return normalized_crop_mode


def configure_logging(log_path: Path, log_level: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, str(log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path, encoding="utf-8"),
        ],
    )


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def detect_site_id() -> tuple[str, dict[str, Any]]:
    sites_root = STORAGE_DIR / "sites"
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    if not sites_root.exists():
        raise RuntimeError(f"Sites root does not exist: {sites_root}")
    for site_dir in sorted(sites_root.iterdir()):
        if not site_dir.is_dir():
            continue
        try:
            site_store = SiteStore(site_dir.name)
            summary = site_store.site_summary_stats()
        except Exception as exc:
            LOGGER.warning("Skipping site %s during auto-detect: %s", site_dir.name, exc)
            continue
        image_count = int(summary.get("n_images") or 0)
        if image_count <= 0:
            continue
        candidates.append((image_count, site_dir.name, summary))
    if not candidates:
        raise RuntimeError("No non-empty local site could be auto-detected.")
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    best = candidates[0]
    return best[1], best[2]


def resolve_site_id(requested_site_id: str) -> tuple[str, dict[str, Any]]:
    normalized = str(requested_site_id or "").strip()
    if normalized:
        site_store = SiteStore(normalized)
        return normalized, site_store.site_summary_stats()
    return detect_site_id()


def resolve_ssl_checkpoint_for_architecture(
    architecture: str,
    ssl_runs: dict[str, dict[str, Any]],
) -> str | None:
    backbone_architecture = SSL_BACKBONE_ARCHITECTURE_BY_MODEL.get(str(architecture or "").strip().lower())
    if not backbone_architecture:
        return None
    run = ssl_runs.get(backbone_architecture)
    if not run:
        return None
    checkpoint_path = str(run.get("encoder_latest_path") or "").strip()
    return checkpoint_path or None


def wait_for_existing_ssl_run(
    run_dir: Path,
    architecture: str,
    *,
    poll_seconds: int,
) -> dict[str, Any]:
    summary_path = run_dir / "training_summary.json"
    if not summary_path.exists():
        raise FileNotFoundError(f"Existing SSL summary does not exist: {summary_path}")
    while True:
        summary = load_json(summary_path)
        status = str(summary.get("status") or "").strip().lower()
        if status == "completed":
            encoder_path = Path(str(summary.get("encoder_latest_path") or run_dir / "ssl_encoder_latest.pth")).expanduser().resolve()
            if not encoder_path.exists():
                raise FileNotFoundError(f"Completed SSL run is missing encoder checkpoint: {encoder_path}")
            return {
                "architecture": architecture,
                "run_dir": str(run_dir.resolve()),
                "summary_path": str(summary_path.resolve()),
                "encoder_latest_path": str(encoder_path),
                "summary": summary,
            }
        if status in {"failed", "cancelled"}:
            raise RuntimeError(f"Existing SSL run ended with status={status}: {summary_path}")
        LOGGER.info(
            "Waiting for existing SSL run %s: status=%s epoch=%s step=%s",
            run_dir,
            status or "unknown",
            summary.get("latest_epoch") or summary.get("current_epoch"),
            summary.get("current_step_in_epoch"),
        )
        time.sleep(max(10, int(poll_seconds)))


def run_ssl_stage(
    *,
    manifest_path: Path,
    output_dir: Path,
    architecture: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    summary_path = output_dir / "training_summary.json"
    if summary_path.exists():
        try:
            existing_summary = load_json(summary_path)
        except Exception:
            existing_summary = {}
        if str(existing_summary.get("status") or "").strip().lower() == "completed":
            LOGGER.info("Reusing completed SSL run for %s: %s", architecture, output_dir)
            return {
                "architecture": architecture,
                "run_dir": str(output_dir.resolve()),
                "summary_path": str(summary_path.resolve()),
                "encoder_latest_path": str(existing_summary.get("encoder_latest_path") or (output_dir / "ssl_encoder_latest.pth")),
                "summary": existing_summary,
            }

    batch_size = int(DEFAULT_SSL_BATCH_SIZE.get(architecture, 16))
    LOGGER.info("Starting SSL run: architecture=%s batch=%s output=%s", architecture, batch_size, output_dir)
    summary = run_ssl_pretraining(
        SSLTrainingConfig(
            manifest_path=str(manifest_path.resolve()),
            output_dir=str(output_dir.resolve()),
            architecture=architecture,
            init_mode=args.ssl_init_mode,
            image_size=int(args.ssl_image_size),
            batch_size=batch_size,
            epochs=int(args.ssl_epochs),
            learning_rate=float(args.ssl_learning_rate),
            weight_decay=float(args.ssl_weight_decay),
            num_workers=int(args.ssl_num_workers),
            device=args.device,
            min_patient_quality=args.ssl_min_patient_quality,
            include_review_rows=bool(args.ssl_include_review_rows),
            use_amp=not bool(args.ssl_disable_amp),
        )
    )
    return {
        "architecture": architecture,
        "run_dir": str(output_dir.resolve()),
        "summary_path": str(Path(summary["summary_path"]).resolve()),
        "encoder_latest_path": str(Path(summary["encoder_latest_path"]).resolve()),
        "summary": summary,
    }


def build_partial_benchmark_response(
    *,
    site_id: str,
    execution_device: str,
    architectures: list[str],
    results: list[dict[str, Any]],
    failures: list[dict[str, Any]],
) -> dict[str, Any]:
    completed_architectures = [
        str(item.get("architecture") or "").strip()
        for item in results
        if str(item.get("architecture") or "").strip()
    ]
    completed_set = set(completed_architectures)
    remaining_architectures = [architecture for architecture in architectures if architecture not in completed_set]
    best_entry = max(results, key=lambda item: float((item.get("result") or {}).get("best_val_acc") or 0.0)) if results else None
    return {
        "site_id": site_id,
        "execution_device": execution_device,
        "architectures": architectures,
        "results": results,
        "failures": failures,
        "completed_architectures": completed_architectures,
        "remaining_architectures": remaining_architectures,
        "best_architecture": best_entry.get("architecture") if best_entry else None,
        "best_model_version": best_entry.get("model_version") if best_entry else None,
    }


def run_benchmark_stage(
    *,
    site_id: str,
    ssl_runs: dict[str, dict[str, Any]],
    output_dir: Path,
    args: argparse.Namespace,
    execution_device: str,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    control_plane = ControlPlaneStore()
    service = ResearchWorkflowService(control_plane)
    site_store = SiteStore(site_id)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    architectures = [str(item).strip() for item in args.benchmark_architectures if str(item).strip()]

    for architecture in architectures:
        crop_mode = benchmark_crop_mode_for_architecture(args.benchmark_crop_mode, architecture)
        ssl_checkpoint_path = resolve_ssl_checkpoint_for_architecture(architecture, ssl_runs)
        pretraining_source = "ssl" if ssl_checkpoint_path else ("scratch" if args.benchmark_scratch_fallback else "imagenet")
        output_model_path = output_dir / f"{architecture}_{make_id('overnight')[:8]}.pth"
        LOGGER.info(
            "Starting benchmark component: architecture=%s pretraining_source=%s crop_mode=%s",
            architecture,
            pretraining_source,
            crop_mode,
        )
        try:
            result = service.run_initial_training(
                site_store=site_store,
                architecture=architecture,
                output_model_path=str(output_model_path),
                execution_device=execution_device,
                crop_mode=crop_mode,
                epochs=int(args.benchmark_epochs),
                learning_rate=float(args.benchmark_learning_rate),
                batch_size=int(args.benchmark_batch_size),
                val_split=float(args.benchmark_val_split),
                test_split=float(args.benchmark_test_split),
                use_pretrained=pretraining_source != "scratch",
                pretraining_source=pretraining_source,
                ssl_checkpoint_path=ssl_checkpoint_path,
                case_aggregation=args.benchmark_case_aggregation,
                use_medsam_crops=True,
                regenerate_split=bool(args.benchmark_regenerate_split),
            )
            results.append(
                {
                    "architecture": architecture,
                    "status": "completed",
                    "pretraining_source": pretraining_source,
                    "ssl_checkpoint_path": ssl_checkpoint_path,
                    "result": result,
                    "model_version": result.get("model_version"),
                }
            )
        except Exception as exc:
            failures.append(
                {
                    "architecture": architecture,
                    "status": "failed",
                    "pretraining_source": pretraining_source,
                    "ssl_checkpoint_path": ssl_checkpoint_path,
                    "error": str(exc),
                }
            )
        partial = build_partial_benchmark_response(
            site_id=site_id,
            execution_device=execution_device,
            architectures=architectures,
            results=results,
            failures=failures,
        )
        write_json(output_dir / "benchmark_summary.json", partial)
    return build_partial_benchmark_response(
        site_id=site_id,
        execution_device=execution_device,
        architectures=architectures,
        results=results,
        failures=failures,
    )


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    plan_id = f"ssl_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    plan_root = (args.plan_root or (REPO_ROOT / "artifacts" / "overnight_plans" / plan_id)).expanduser().resolve()
    log_path = plan_root / "overnight_plan.log"
    configure_logging(log_path, args.log_level)
    execution_device = resolve_device(args.device)

    site_id, site_summary = resolve_site_id(args.site_id)
    LOGGER.info("Using site_id=%s execution_device=%s summary=%s", site_id, execution_device, site_summary)

    manifest_dir = plan_root / "manifest"
    ssl_root = plan_root / "ssl_runs"
    benchmark_root = plan_root / "benchmark"
    clean_rows, anomaly_rows, manifest_summary = scan_ssl_archive(args.archive_base_dir.expanduser().resolve())
    manifest_paths = write_ssl_archive_outputs(manifest_dir, clean_rows, anomaly_rows, manifest_summary)
    LOGGER.info(
        "Prepared SSL manifest: clean=%s anomalies=%s total=%s",
        manifest_summary.get("clean_images"),
        manifest_summary.get("anomaly_images"),
        manifest_summary.get("total_supported_images"),
    )

    ssl_runs: dict[str, dict[str, Any]] = {}
    if args.wait_existing_ssl_run:
        existing = wait_for_existing_ssl_run(
            args.wait_existing_ssl_run.expanduser().resolve(),
            args.existing_ssl_architecture,
            poll_seconds=int(args.poll_seconds),
        )
        ssl_runs[args.existing_ssl_architecture] = existing

    plan_summary: dict[str, Any] = {
        "plan_id": plan_id,
        "created_at": utc_now(),
        "archive_base_dir": str(args.archive_base_dir.expanduser().resolve()),
        "site_id": site_id,
        "execution_device": execution_device,
        "site_summary": site_summary,
        "manifest": {
            "clean_manifest_path": manifest_paths["clean_manifest_path"],
            "anomaly_manifest_path": manifest_paths["anomaly_manifest_path"],
            "summary_path": manifest_paths["summary_path"],
            "summary": manifest_summary,
        },
        "ssl_runs": ssl_runs,
        "benchmark": None,
        "log_path": str(log_path),
    }
    write_json(plan_root / "plan_summary.json", plan_summary)

    for architecture in args.ssl_architectures:
        run_info = run_ssl_stage(
            manifest_path=Path(manifest_paths["clean_manifest_path"]),
            output_dir=ssl_root / architecture,
            architecture=architecture,
            args=args,
        )
        ssl_runs[architecture] = run_info
        plan_summary["ssl_runs"] = ssl_runs
        write_json(plan_root / "plan_summary.json", plan_summary)

    if not args.skip_benchmark:
        benchmark_summary = run_benchmark_stage(
            site_id=site_id,
            ssl_runs=ssl_runs,
            output_dir=benchmark_root,
            args=args,
            execution_device=execution_device,
        )
        plan_summary["benchmark"] = benchmark_summary
        write_json(plan_root / "plan_summary.json", plan_summary)
        LOGGER.info(
            "Benchmark completed: completed=%s failed=%s best=%s",
            len(benchmark_summary.get("completed_architectures") or []),
            len(benchmark_summary.get("failures") or []),
            benchmark_summary.get("best_architecture"),
        )

    LOGGER.info("Overnight plan finished. Summary: %s", plan_root / "plan_summary.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
