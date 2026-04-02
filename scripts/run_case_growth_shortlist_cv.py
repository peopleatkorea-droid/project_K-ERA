from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from scripts.run_current_model_suite import (
    RetrievalSuiteSpec,
    VisitRetrievalSpec,
    build_custom_specs,
    build_standard_specs,
    default_ssl_checkpoint_path,
    run_custom_component,
    run_retrieval_component,
    run_standard_component,
    summarize_dataset,
)
from scripts.run_dinov2_image_retrieval_validation import (
    RetrievalSpec as ImageRetrievalSpec,
    run_experiment as run_image_retrieval_experiment,
)
from scripts.run_current_model_suite_cv import (
    audit_retrieval_payload,
    build_jobs,
    build_pre_run_leakage_audit,
    build_queue_status,
    component_leakage_audit_path,
    config_path,
    failure_path,
    fold_dir,
    folds_path,
    job_id,
    job_state_path,
    leakage_audit_path,
    load_json,
    load_or_build_folds,
    planned_jobs_path,
    queue_status_path,
    refresh_summaries,
    result_path,
    run_single_job_subprocess,
    utc_now,
    write_json,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService


DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "case_growth_shortlist_cv_20260331_5fold"

SHORTLIST_ORDER = {
    "prereq_h2_current_ssl_tuned": 0,
    "official_dinov2_mil": 1,
    "official_dinov2_retrieval_lesion_crop": 2,
    "official_dinov2_retrieval_full": 3,
    "official_dinov2_retrieval": 4,
    "h5_lgf_current": 5,
    "swin": 6,
    "efficientnet_v2_s": 7,
    "official_dinov2_image_retrieval": 8,
    "convnext_tiny": 9,
    "vit": 10,
    "densenet121": 11,
}

SHORTLIST_STANDARD_NAMES = {
    "swin",
    "efficientnet_v2_s",
    "convnext_tiny",
    "vit",
    "densenet121",
}

SHORTLIST_CUSTOM_NAMES = {
    "prereq_h2_current_ssl_tuned",
    "official_dinov2_mil",
    "h5_lgf_current",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the case-growth shortlist under a shared patient-level 5-fold CV queue."
    )
    subparsers = parser.add_subparsers(dest="command", required=False)

    queue_parser = subparsers.add_parser("queue", help="Run the resumable shortlist queue.")
    queue_parser.add_argument("--site-id", default="39100103")
    queue_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    queue_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    queue_parser.add_argument("--python-exe", type=Path, default=Path(sys.executable))
    queue_parser.add_argument("--num-folds", type=int, default=5)
    queue_parser.add_argument("--val-split", type=float, default=0.2)
    queue_parser.add_argument(
        "--view-filter",
        default="all",
        choices=["all", "white", "slit", "fluorescein"],
        help="Filter manifest records by clinical view before split generation and training.",
    )
    queue_parser.add_argument("--components", nargs="*", default=None)
    queue_parser.add_argument("--epochs-override", type=int, default=None)
    queue_parser.add_argument("--max-retries", type=int, default=1)
    queue_parser.add_argument("--retry-delay-seconds", type=int, default=15)
    queue_parser.add_argument("--force-rerun", action="store_true")
    queue_parser.add_argument("--max-jobs", type=int, default=None)

    job_parser = subparsers.add_parser("job", help="Run a single shortlist component/fold job.")
    job_parser.add_argument("--site-id", default="39100103")
    job_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    job_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    job_parser.add_argument("--fold-index", type=int, required=True)
    job_parser.add_argument("--component", required=True)
    job_parser.add_argument(
        "--view-filter",
        default="all",
        choices=["all", "white", "slit", "fluorescein"],
        help="Filter manifest records by clinical view before running the job.",
    )
    job_parser.add_argument("--epochs-override", type=int, default=None)

    args = parser.parse_args()
    if not args.command:
        args.command = "queue"
    return args


def build_retrieval_specs() -> list[RetrievalSuiteSpec]:
    return [
        RetrievalSuiteSpec(
            name="official_dinov2_retrieval_lesion_crop",
            label="Official DINOv2 Retrieval (Lesion Crop)",
            order=SHORTLIST_ORDER["official_dinov2_retrieval_lesion_crop"],
            family="Retrieval",
            experiment=VisitRetrievalSpec(
                name="official_dinov2_retrieval_lesion_crop",
                backbone_source="official",
                crop_variant="lesion_crop",
                top_k=10,
            ),
        ),
        RetrievalSuiteSpec(
            name="official_dinov2_retrieval_full",
            label="Official DINOv2 Retrieval (Full Frame)",
            order=SHORTLIST_ORDER["official_dinov2_retrieval_full"],
            family="Retrieval",
            experiment=VisitRetrievalSpec(
                name="official_dinov2_retrieval_full",
                backbone_source="official",
                crop_variant="full",
                top_k=10,
            ),
        ),
        RetrievalSuiteSpec(
            name="official_dinov2_retrieval",
            label="Official DINOv2 Retrieval (Cornea ROI)",
            order=SHORTLIST_ORDER["official_dinov2_retrieval"],
            family="Retrieval",
            experiment=VisitRetrievalSpec(
                name="official_dinov2_retrieval",
                backbone_source="official",
                crop_variant="cornea_roi",
                top_k=10,
            ),
        ),
    ]


def build_image_retrieval_components() -> list[dict[str, Any]]:
    spec = ImageRetrievalSpec(
        name="official_dinov2_image_retrieval",
        backbone_source="official",
        crop_variant="cornea_roi",
        top_k=10,
    )
    return [
        {
            "kind": "retrieval",
            "retrieval_unit": "image",
            "name": "official_dinov2_image_retrieval",
            "order": SHORTLIST_ORDER["official_dinov2_image_retrieval"],
            "label": "Official DINOv2 Image Retrieval",
            "family": "Retrieval",
            "include_in_summary": True,
            "spec": spec,
        }
    ]


def filter_manifest_records_by_view(records: list[dict[str, Any]], view_filter: str) -> list[dict[str, Any]]:
    normalized = str(view_filter or "all").strip().lower() or "all"
    if normalized == "all":
        return list(records)
    filtered = [record for record in records if str(record.get("view") or "").strip().lower() == normalized]
    if not filtered:
        raise RuntimeError(f"No manifest records matched view_filter={normalized!r}.")
    return filtered


def build_components(selected_names: list[str] | None, epochs_override: int | None) -> list[dict[str, Any]]:
    selected = {str(name).strip() for name in (selected_names or []) if str(name).strip()} or None
    standard_specs = [
        replace(spec, order=SHORTLIST_ORDER[spec.name])
        for spec in build_standard_specs()
        if spec.name in SHORTLIST_STANDARD_NAMES
    ]
    custom_specs = [
        replace(spec, order=SHORTLIST_ORDER[spec.name])
        for spec in build_custom_specs()
        if spec.name in SHORTLIST_CUSTOM_NAMES
    ]
    image_retrieval_components = build_image_retrieval_components()
    retrieval_specs = build_retrieval_specs()

    if epochs_override is not None:
        for spec in standard_specs:
            spec.epochs = int(epochs_override)
        for spec in custom_specs:
            spec.experiment.epochs = int(epochs_override)

    include_prereq_h2 = selected is None or "h5_lgf_current" in selected or "prereq_h2_current_ssl_tuned" in selected
    components: list[dict[str, Any]] = []
    for spec in custom_specs:
        if selected is None or spec.name in selected or (spec.name == "prereq_h2_current_ssl_tuned" and include_prereq_h2):
            components.append(
                {
                    "kind": "custom",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": bool(spec.include_in_summary),
                    "spec": spec,
                }
            )
    for spec in standard_specs:
        if selected is None or spec.name in selected:
            components.append(
                {
                    "kind": "standard",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": True,
                    "spec": spec,
                }
            )
    for component in image_retrieval_components:
        if selected is None or component["name"] in selected:
            components.append(component)
    for spec in retrieval_specs:
        if selected is None or spec.name in selected:
            components.append(
                {
                    "kind": "retrieval",
                    "retrieval_unit": "visit",
                    "name": spec.name,
                    "order": int(spec.order),
                    "label": spec.label,
                    "family": spec.family,
                    "include_in_summary": True,
                    "spec": spec,
                }
            )
    components.sort(key=lambda item: int(item["order"]))
    return components


def component_index(selected_names: list[str] | None, epochs_override: int | None) -> dict[str, dict[str, Any]]:
    return {component["name"]: component for component in build_components(selected_names, epochs_override)}


def run_image_retrieval_component(
    *,
    component_name: str,
    label: str,
    order: int,
    spec: ImageRetrievalSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
    ssl_checkpoint_path: str,
) -> dict[str, Any]:
    experiment_dir = output_root / component_name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    result = run_image_retrieval_experiment(
        spec=spec,
        workflow=workflow,
        site_store=site_store,
        manifest_records=manifest_records,
        split=shared_split,
        output_root=output_root / "_retrieval_cache",
        device=device,
        ssl_checkpoint_path=ssl_checkpoint_path,
    )
    payload = {
        "suite_component": {
            "name": component_name,
            "label": label,
            "family": "Retrieval",
            "order": int(order),
            "kind": "retrieval",
            "spec": {
                "name": spec.name,
                "backbone_source": spec.backbone_source,
                "crop_variant": spec.crop_variant,
                "top_k": spec.top_k,
                "retrieval_unit": "image",
            },
        },
        "result": result,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def run_job(args: argparse.Namespace) -> int:
    output_root = args.output_root.expanduser().resolve()
    fold_index = int(args.fold_index)
    component_name = str(args.component).strip()
    component_map = component_index(None, args.epochs_override)
    if component_name not in component_map:
        raise ValueError(f"Unknown shortlist component: {component_name}")

    folds_payload = load_json(folds_path(output_root))
    folds = [dict(item) for item in folds_payload.get("folds", [])]
    fold = next((item for item in folds if int(item["fold_index"]) == fold_index), None)
    if fold is None:
        raise ValueError(f"Fold {fold_index} is not defined in {folds_path(output_root)}")

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = filter_manifest_records_by_view(
        site_store.generate_manifest().to_dict("records"),
        args.view_filter,
    )
    ssl_checkpoint_path = default_ssl_checkpoint_path()
    component = component_map[component_name]
    spec = component["spec"]

    try:
        if component["kind"] == "standard":
            payload = run_standard_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
            )
        elif component["kind"] == "retrieval":
            if str(component.get("retrieval_unit") or "visit") == "image":
                payload = run_image_retrieval_component(
                    component_name=component_name,
                    label=str(component["label"]),
                    order=int(component["order"]),
                    spec=spec,
                    workflow=workflow,
                    site_store=site_store,
                    manifest_records=manifest_records,
                    shared_split=fold,
                    output_root=fold_dir(output_root, fold_index),
                    device=args.device,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                )
            else:
                payload = run_retrieval_component(
                    spec=spec,
                    workflow=workflow,
                    site_store=site_store,
                    manifest_records=manifest_records,
                    shared_split=fold,
                    output_root=fold_dir(output_root, fold_index),
                    device=args.device,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                )
            write_json(component_leakage_audit_path(output_root, fold_index, component_name), audit_retrieval_payload(payload))
        else:
            warm_start_override = None
            if component_name == "h5_lgf_current":
                prereq_payload_path = result_path(output_root, fold_index, "prereq_h2_current_ssl_tuned")
                if not prereq_payload_path.exists():
                    raise RuntimeError(
                        f"h5_lgf_current fold {fold_index} requires prereq_h2_current_ssl_tuned fold {fold_index}, but the prerequisite result is missing."
                    )
                prereq_payload = load_json(prereq_payload_path)
                warm_start_override = str(prereq_payload["result"]["output_model_path"])
            payload = run_custom_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
                ssl_checkpoint_path=ssl_checkpoint_path,
                warm_start_override=warm_start_override,
            )

        current_failure = failure_path(output_root, fold_index, component_name)
        if current_failure.exists():
            current_failure.unlink()
        print(
            json.dumps(
            {
                "job_id": job_id(fold_index, component_name),
                "status": "completed",
                "result_path": str(result_path(output_root, fold_index, component_name)),
                "view_filter": args.view_filter,
            },
            ensure_ascii=False,
            indent=2,
            )
        )
        return 0
    except Exception as exc:
        payload = {
            "job_id": job_id(fold_index, component_name),
            "status": "failed",
            "error": str(exc),
            "failed_at": utc_now(),
            "view_filter": args.view_filter,
        }
        write_json(failure_path(output_root, fold_index, component_name), payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


def run_queue(args: argparse.Namespace) -> int:
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    script_path = Path(__file__).resolve()
    python_exe = args.python_exe.expanduser().resolve()
    if not python_exe.exists():
        raise FileNotFoundError(f"Python executable does not exist: {python_exe}")

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = filter_manifest_records_by_view(
        site_store.generate_manifest().to_dict("records"),
        args.view_filter,
    )
    dataset_summary = summarize_dataset(manifest_records)
    folds = load_or_build_folds(
        output_root,
        workflow=workflow,
        manifest_records=manifest_records,
        num_folds=int(args.num_folds),
        val_split=float(args.val_split),
        force_rerun=bool(args.force_rerun),
    )
    components = build_components(args.components, args.epochs_override)
    jobs = build_jobs(components, folds)

    write_json(
        config_path(output_root),
        {
            "created_at": utc_now(),
            "queue_name": "case_growth_shortlist_cv",
            "site_id": args.site_id,
            "device": args.device,
            "python_exe": str(python_exe),
            "num_folds": int(args.num_folds),
            "val_split": float(args.val_split),
            "view_filter": str(args.view_filter),
            "epochs_override": int(args.epochs_override) if args.epochs_override is not None else None,
            "max_retries": int(args.max_retries),
            "retry_delay_seconds": int(args.retry_delay_seconds),
            "force_rerun": bool(args.force_rerun),
            "dataset_summary": dataset_summary,
            "requested_shortlist": {
                "visit_level": [
                    "official_dinov2_mil",
                    "official_dinov2_retrieval_lesion_crop",
                    "official_dinov2_retrieval_full",
                    "official_dinov2_retrieval",
                ],
                "image_level": [
                    "swin",
                    "efficientnet_v2_s",
                    "official_dinov2_image_retrieval",
                    "h5_lgf_current",
                    "convnext_tiny",
                    "vit",
                    "densenet121",
                ],
            },
        },
    )
    write_json(planned_jobs_path(output_root), {"created_at": utc_now(), "jobs": jobs})
    write_json(leakage_audit_path(output_root), build_pre_run_leakage_audit(manifest_records, folds))

    items: dict[str, dict[str, Any]] = {}
    jobs_run = 0
    for job in jobs:
        current_job_id = str(job["job_id"])
        fold_index = int(job["fold_index"])
        component_name = str(job["component_name"])
        existing_result = result_path(output_root, fold_index, component_name)

        if existing_result.exists() and not args.force_rerun:
            items[current_job_id] = {
                "job_id": current_job_id,
                "status": "skipped_existing",
                "fold_index": fold_index,
                "component_name": component_name,
                "started_at": None,
                "ended_at": utc_now(),
                "result_path": str(existing_result),
                "stdout_log": "",
                "stderr_log": "",
                "skipped_existing": True,
            }
            write_json(
                queue_status_path(output_root),
                build_queue_status(
                    output_root=output_root,
                    jobs=jobs,
                    items=items,
                    current_job=None,
                    dataset_summary=dataset_summary,
                ),
            )
            refresh_summaries(output_root, jobs)
            continue

        dependency = job.get("dependency")
        if dependency and items.get(dependency, {}).get("status") in {"failed", "blocked"}:
            blocked_payload = {
                "job_id": current_job_id,
                "status": "blocked",
                "fold_index": fold_index,
                "component_name": component_name,
                "dependency": dependency,
                "reason": f"Dependency did not complete: {dependency}",
                "ended_at": utc_now(),
            }
            items[current_job_id] = blocked_payload
            write_json(job_state_path(output_root, fold_index, component_name), blocked_payload)
            write_json(
                queue_status_path(output_root),
                build_queue_status(
                    output_root=output_root,
                    jobs=jobs,
                    items=items,
                    current_job=None,
                    dataset_summary=dataset_summary,
                ),
            )
            continue

        write_json(
            queue_status_path(output_root),
            build_queue_status(
                output_root=output_root,
                jobs=jobs,
                items=items,
                current_job=current_job_id,
                dataset_summary=dataset_summary,
            ),
        )
        items[current_job_id] = run_single_job_subprocess(
            output_root=output_root,
            python_exe=python_exe,
            script_path=script_path,
            site_id=args.site_id,
            device=args.device,
            fold_index=fold_index,
            component_name=component_name,
            view_filter=args.view_filter,
            epochs_override=args.epochs_override,
            max_retries=max(0, int(args.max_retries)),
            retry_delay_seconds=max(0, int(args.retry_delay_seconds)),
        )
        write_json(job_state_path(output_root, fold_index, component_name), items[current_job_id])
        jobs_run += 1
        write_json(
            queue_status_path(output_root),
            build_queue_status(
                output_root=output_root,
                jobs=jobs,
                items=items,
                current_job=None,
                dataset_summary=dataset_summary,
            ),
        )
        refresh_summaries(output_root, jobs)
        if args.max_jobs is not None and jobs_run >= int(args.max_jobs):
            break

    refresh_summaries(output_root, jobs)
    write_json(
        queue_status_path(output_root),
        build_queue_status(
            output_root=output_root,
            jobs=jobs,
            items=items,
            current_job=None,
            dataset_summary=dataset_summary,
        ),
    )
    print(
        json.dumps(
            {
                "output_root": str(output_root),
                "total_jobs": len(jobs),
                "jobs_executed_this_run": jobs_run,
                "queue_status": str(queue_status_path(output_root)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "job":
        return run_job(args)
    return run_queue(args)


if __name__ == "__main__":
    raise SystemExit(main())
