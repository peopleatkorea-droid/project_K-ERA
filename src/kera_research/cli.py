from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from kera_research.config import MODEL_DIR
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.institution_directory import HiraApiError
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.storage import read_json, write_json


def _execution_device(mode: str) -> str:
    normalized = mode.strip().lower()
    selection = {
        "gpu": "GPU mode",
        "cpu": "CPU mode",
        "auto": "Auto",
    }.get(normalized, "Auto")
    return resolve_execution_mode(selection, detect_hardware())


def _workflow() -> tuple[ControlPlaneStore, ResearchWorkflowService]:
    control_plane = ControlPlaneStore()
    return control_plane, ResearchWorkflowService(control_plane)


def _model_version_or_exit(cp: ControlPlaneStore, model_version_id: str | None) -> dict[str, Any]:
    if model_version_id:
        model_version = next(
            (item for item in cp.list_model_versions() if item.get("version_id") == model_version_id),
            None,
        )
    else:
        model_version = cp.current_global_model()
    if model_version is None:
        raise SystemExit("No ready model version is available.")
    return model_version


def cmd_train(args: argparse.Namespace) -> dict[str, Any]:
    cp, workflow = _workflow()
    site_store = SiteStore(args.site_id)
    output_path = MODEL_DIR / f"cli_{args.architecture}_{args.crop_mode}.pth"
    return workflow.run_initial_training(
        site_store=site_store,
        architecture=args.architecture,
        output_model_path=str(output_path),
        execution_device=_execution_device(args.execution_mode),
        crop_mode=args.crop_mode,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        batch_size=args.batch_size,
        val_split=args.val_split,
        test_split=args.test_split,
        use_pretrained=not args.no_pretrained,
        regenerate_split=args.regenerate_split,
    )


def cmd_cross_validate(args: argparse.Namespace) -> dict[str, Any]:
    _cp, workflow = _workflow()
    site_store = SiteStore(args.site_id)
    output_dir = MODEL_DIR / f"cli_cv_{args.architecture}_{args.crop_mode}"
    return workflow.run_cross_validation(
        site_store=site_store,
        architecture=args.architecture,
        output_dir=str(output_dir),
        execution_device=_execution_device(args.execution_mode),
        crop_mode=args.crop_mode,
        num_folds=args.num_folds,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        batch_size=args.batch_size,
        val_split=args.val_split,
        use_pretrained=not args.no_pretrained,
    )


def cmd_external_validate(args: argparse.Namespace) -> dict[str, Any]:
    cp, workflow = _workflow()
    site_store = SiteStore(args.site_id)
    model_version = _model_version_or_exit(cp, args.model_version_id)
    summary, case_predictions, _manifest_df = workflow.run_external_validation(
        project_id=args.project_id,
        site_store=site_store,
        model_version=model_version,
        execution_device=_execution_device(args.execution_mode),
        generate_gradcam=not args.no_gradcam,
        generate_medsam=not args.no_medsam,
    )
    return {
        "summary": summary,
        "case_predictions": case_predictions,
    }


def cmd_export_report(args: argparse.Namespace) -> dict[str, Any]:
    cp = ControlPlaneStore()
    output_path = Path(args.output).expanduser().resolve()
    if args.validation_id:
        summary = next(
            (item for item in cp.list_validation_runs(site_id=args.site_id) if item.get("validation_id") == args.validation_id),
            None,
        )
        if summary is None:
            raise SystemExit(f"Validation run not found: {args.validation_id}")
        payload = {
            "summary": summary,
            "case_predictions": cp.load_case_predictions(args.validation_id),
        }
    else:
        if not args.site_id or not args.cross_validation_id:
            raise SystemExit("site_id and cross_validation_id are required for cross-validation export.")
        site_store = SiteStore(args.site_id)
        report_path = site_store.validation_dir / f"{args.cross_validation_id}.json"
        payload = read_json(report_path, {})
        if not payload:
            raise SystemExit(f"Cross-validation report not found: {args.cross_validation_id}")
    write_json(output_path, payload)
    return {
        "output_path": str(output_path),
    }


def cmd_sync_ophthalmology_directory(args: argparse.Namespace) -> dict[str, Any]:
    cp = ControlPlaneStore()
    try:
        return cp.sync_hira_ophthalmology_directory(
            page_size=args.page_size,
            max_pages=args.max_pages,
        )
    except HiraApiError as exc:
        raise SystemExit(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m kera_research.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="Run initial training without the HTTP API.")
    train_parser.add_argument("--site-id", required=True)
    train_parser.add_argument("--architecture", default="convnext_tiny")
    train_parser.add_argument("--crop-mode", default="automated", choices=["automated", "manual", "both"])
    train_parser.add_argument("--execution-mode", default="auto", choices=["auto", "cpu", "gpu"])
    train_parser.add_argument("--epochs", type=int, default=30)
    train_parser.add_argument("--learning-rate", type=float, default=1e-4)
    train_parser.add_argument("--batch-size", type=int, default=16)
    train_parser.add_argument("--val-split", type=float, default=0.2)
    train_parser.add_argument("--test-split", type=float, default=0.2)
    train_parser.add_argument("--regenerate-split", action="store_true")
    train_parser.add_argument("--no-pretrained", action="store_true")
    train_parser.set_defaults(func=cmd_train)

    cv_parser = subparsers.add_parser("cross-validate", help="Run cross-validation without the HTTP API.")
    cv_parser.add_argument("--site-id", required=True)
    cv_parser.add_argument("--architecture", default="convnext_tiny")
    cv_parser.add_argument("--crop-mode", default="automated", choices=["automated", "manual"])
    cv_parser.add_argument("--execution-mode", default="auto", choices=["auto", "cpu", "gpu"])
    cv_parser.add_argument("--num-folds", type=int, default=5)
    cv_parser.add_argument("--epochs", type=int, default=10)
    cv_parser.add_argument("--learning-rate", type=float, default=1e-4)
    cv_parser.add_argument("--batch-size", type=int, default=16)
    cv_parser.add_argument("--val-split", type=float, default=0.2)
    cv_parser.add_argument("--no-pretrained", action="store_true")
    cv_parser.set_defaults(func=cmd_cross_validate)

    eval_parser = subparsers.add_parser("external-validate", help="Run site-level external validation.")
    eval_parser.add_argument("--site-id", required=True)
    eval_parser.add_argument("--project-id", default="default")
    eval_parser.add_argument("--model-version-id")
    eval_parser.add_argument("--execution-mode", default="auto", choices=["auto", "cpu", "gpu"])
    eval_parser.add_argument("--no-gradcam", action="store_true")
    eval_parser.add_argument("--no-medsam", action="store_true")
    eval_parser.set_defaults(func=cmd_external_validate)

    export_parser = subparsers.add_parser("export-report", help="Export a saved validation or cross-validation report.")
    export_parser.add_argument("--site-id")
    export_parser.add_argument("--validation-id")
    export_parser.add_argument("--cross-validation-id")
    export_parser.add_argument("--output", required=True)
    export_parser.set_defaults(func=cmd_export_report)

    sync_parser = subparsers.add_parser(
        "sync-ophthalmology-directory",
        help="Sync the Korean ophthalmology institution directory from HIRA.",
    )
    sync_parser.add_argument("--page-size", type=int, default=100)
    sync_parser.add_argument("--max-pages", type=int)
    sync_parser.set_defaults(func=cmd_sync_ophthalmology_directory)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    result = args.func(args)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
