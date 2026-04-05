from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import asdict
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
    default_ssl_checkpoint_path,
    run_retrieval_component,
    summarize_dataset,
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
from scripts.run_dinov2_image_retrieval_validation import (
    evaluate_query_images,
)
from scripts.run_dinov2_recovery_validation import (
    ExperimentSpec,
    evaluate_saved_model,
    split_records,
    train_custom_experiment,
    training_input_policy_for_crop_mode,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.retrieval import Dinov2ImageRetriever


DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "mil_backbone_ablation_cv_20260403_5fold"

COMPONENT_ORDER = {
    "official_dinov2_retrieval_lesion_crop": 1,
    "official_dinov2_mil": 2,
    "dinov2_retrieval_guided_lesion_mil_top2": 3,
    "efficientnet_v2_s_mil_full": 4,
    "convnext_tiny_mil_full": 5,
    "densenet121_mil_cornea": 6,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run white-view MIL backbone ablation with retrieval-guided DINO lesion-aware MIL."
    )
    subparsers = parser.add_subparsers(dest="command", required=False)

    queue_parser = subparsers.add_parser("queue", help="Run the resumable MIL ablation queue.")
    queue_parser.add_argument("--site-id", default="39100103")
    queue_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    queue_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    queue_parser.add_argument("--python-exe", type=Path, default=Path(sys.executable))
    queue_parser.add_argument("--num-folds", type=int, default=5)
    queue_parser.add_argument("--val-split", type=float, default=0.2)
    queue_parser.add_argument(
        "--view-filter",
        default="white",
        choices=["all", "white", "slit", "fluorescein"],
        help="Clinical view filter to apply before split generation and training.",
    )
    queue_parser.add_argument("--components", nargs="*", default=None)
    queue_parser.add_argument("--epochs-override", type=int, default=None)
    queue_parser.add_argument("--lesion-top-k", type=int, default=2)
    queue_parser.add_argument("--max-retries", type=int, default=1)
    queue_parser.add_argument("--retry-delay-seconds", type=int, default=15)
    queue_parser.add_argument("--force-rerun", action="store_true")
    queue_parser.add_argument("--max-jobs", type=int, default=None)

    job_parser = subparsers.add_parser("job", help="Run a single MIL ablation component/fold job.")
    job_parser.add_argument("--site-id", default="39100103")
    job_parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    job_parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    job_parser.add_argument("--fold-index", type=int, required=True)
    job_parser.add_argument("--component", required=True)
    job_parser.add_argument(
        "--view-filter",
        default="white",
        choices=["all", "white", "slit", "fluorescein"],
        help="Clinical view filter to apply before running the job.",
    )
    job_parser.add_argument("--epochs-override", type=int, default=None)
    job_parser.add_argument("--lesion-top-k", type=int, default=2)

    args = parser.parse_args()
    if not args.command:
        args.command = "queue"
    return args


def filter_manifest_records_by_view(records: list[dict[str, Any]], view_filter: str) -> list[dict[str, Any]]:
    normalized = str(view_filter or "all").strip().lower() or "all"
    if normalized == "all":
        return list(records)
    filtered = [record for record in records if str(record.get("view") or "").strip().lower() == normalized]
    if not filtered:
        raise RuntimeError(f"No manifest records matched view_filter={normalized!r}.")
    return filtered


def base_mil_experiment(
    *,
    name: str,
    architecture: str,
    crop_mode: str,
    epochs_override: int | None,
) -> ExperimentSpec:
    return ExperimentSpec(
        name=name,
        hypothesis=f"mil_ablation::{name}",
        architecture=architecture,
        crop_mode=crop_mode,
        fine_tuning_mode="full",
        learning_rate=5e-5,
        backbone_learning_rate=1e-5,
        head_learning_rate=1.5e-4,
        warmup_epochs=3,
        early_stop_patience=10,
        epochs=int(epochs_override or 30),
        batch_size=2,
        case_aggregation="attention_mil",
        model_selection_metric="val_auroc",
        pretraining_source="imagenet",
        use_pretrained=True,
    )


def build_components(epochs_override: int | None, lesion_top_k: int, selected_names: list[str] | None) -> list[dict[str, Any]]:
    selected = {str(name).strip() for name in (selected_names or []) if str(name).strip()} or None
    components = [
        {
            "kind": "retrieval",
            "name": "official_dinov2_retrieval_lesion_crop",
            "order": COMPONENT_ORDER["official_dinov2_retrieval_lesion_crop"],
            "label": "Official DINOv2 Retrieval (Lesion Crop)",
            "family": "Retrieval",
            "include_in_summary": True,
            "spec": RetrievalSuiteSpec(
                name="official_dinov2_retrieval_lesion_crop",
                label="Official DINOv2 Retrieval (Lesion Crop)",
                order=COMPONENT_ORDER["official_dinov2_retrieval_lesion_crop"],
                family="Retrieval",
                experiment=VisitRetrievalSpec(
                    name="official_dinov2_retrieval_lesion_crop",
                    backbone_source="official",
                    crop_variant="lesion_crop",
                    top_k=10,
                ),
            ),
        },
        {
            "kind": "mil_custom",
            "name": "official_dinov2_mil",
            "order": COMPONENT_ORDER["official_dinov2_mil"],
            "label": "Official DINOv2 MIL",
            "family": "MIL",
            "include_in_summary": True,
            "spec": base_mil_experiment(
                name="official_dinov2_mil",
                architecture="dinov2_mil",
                crop_mode="automated",
                epochs_override=epochs_override,
            ),
        },
        {
            "kind": "mil_custom",
            "name": f"dinov2_retrieval_guided_lesion_mil_top{int(lesion_top_k)}",
            "order": COMPONENT_ORDER["dinov2_retrieval_guided_lesion_mil_top2"],
            "label": f"DINOv2 Retrieval-Guided Lesion MIL (Top-{int(lesion_top_k)})",
            "family": "MIL",
            "include_in_summary": True,
            "spec": base_mil_experiment(
                name=f"dinov2_retrieval_guided_lesion_mil_top{int(lesion_top_k)}",
                architecture="dinov2_mil",
                crop_mode="manual",
                epochs_override=epochs_override,
            ),
            "selection_mode": "retrieval_guided_lesion_topk",
            "selection_top_k": int(lesion_top_k),
        },
        {
            "kind": "mil_custom",
            "name": "efficientnet_v2_s_mil_full",
            "order": COMPONENT_ORDER["efficientnet_v2_s_mil_full"],
            "label": "EfficientNetV2-S MIL (Full)",
            "family": "MIL",
            "include_in_summary": True,
            "spec": base_mil_experiment(
                name="efficientnet_v2_s_mil_full",
                architecture="efficientnet_v2_s_mil",
                crop_mode="raw",
                epochs_override=epochs_override,
            ),
        },
        {
            "kind": "mil_custom",
            "name": "convnext_tiny_mil_full",
            "order": COMPONENT_ORDER["convnext_tiny_mil_full"],
            "label": "ConvNeXt-Tiny MIL (Full)",
            "family": "MIL",
            "include_in_summary": True,
            "spec": base_mil_experiment(
                name="convnext_tiny_mil_full",
                architecture="convnext_tiny_mil",
                crop_mode="raw",
                epochs_override=epochs_override,
            ),
        },
        {
            "kind": "mil_custom",
            "name": "densenet121_mil_cornea",
            "order": COMPONENT_ORDER["densenet121_mil_cornea"],
            "label": "DenseNet121 MIL (Cornea ROI)",
            "family": "MIL",
            "include_in_summary": True,
            "spec": base_mil_experiment(
                name="densenet121_mil_cornea",
                architecture="densenet121_mil",
                crop_mode="automated",
                epochs_override=epochs_override,
            ),
        },
    ]
    filtered = [component for component in components if selected is None or component["name"] in selected]
    filtered.sort(key=lambda item: int(item["order"]))
    return filtered


def component_index(epochs_override: int | None, lesion_top_k: int, selected_names: list[str] | None) -> dict[str, dict[str, Any]]:
    return {component["name"]: component for component in build_components(epochs_override, lesion_top_k, selected_names)}


def run_mil_component(
    *,
    component_name: str,
    label: str,
    order: int,
    family: str,
    spec: ExperimentSpec,
    records: list[dict[str, Any]],
    workflow: ResearchWorkflowService,
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
    extra_result_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    experiment_dir = output_root / component_name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    output_model_path = experiment_dir / f"{component_name}.pth"
    training_input_policy = training_input_policy_for_crop_mode(workflow, spec.crop_mode, spec.architecture)
    result = train_custom_experiment(
        spec=spec,
        model_manager=workflow.model_manager,
        records=records,
        split=shared_split,
        ssl_checkpoint_path="",
        output_model_path=output_model_path,
        device=device,
        training_input_policy=training_input_policy,
        progress_callback=lambda epoch, total_epochs, train_loss, val_acc: print(
            f"[{component_name}] epoch {epoch}/{total_epochs} train_loss={train_loss:.4f} val_acc={val_acc:.4f}",
            flush=True,
        ),
    )
    if extra_result_fields:
        result.update(extra_result_fields)
    recomputed = evaluate_saved_model(
        workflow.model_manager,
        architecture=spec.architecture,
        model_path=output_model_path,
        records=records,
        split=result["patient_split"],
        device=device,
        batch_size=spec.batch_size,
        decision_threshold=float(result["decision_threshold"]),
        crop_mode=spec.crop_mode,
        case_aggregation=spec.case_aggregation,
        training_input_policy=training_input_policy,
    )
    payload = {
        "suite_component": {
            "name": component_name,
            "label": label,
            "family": family,
            "order": int(order),
            "kind": "custom",
            "spec": asdict(spec),
        },
        "result": result,
        "recomputed_metrics": recomputed,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def build_retrieval_guided_score_map(
    *,
    records: list[dict[str, Any]],
    split: dict[str, Any],
    output_root: Path,
    device: str,
) -> dict[str, float]:
    train_records, val_records, test_records = split_records(records, split)
    all_records = train_records + val_records + test_records
    retriever = Dinov2ImageRetriever(ssl_checkpoint_path=None)
    all_image_paths = [str(record["image_path"]) for record in all_records]
    cache_dir = output_root / "_retrieval_guidance_cache" / "official" / "lesion_crop"
    embeddings = retriever.encode_images(all_image_paths, requested_device=device, persistence_dir=cache_dir)
    path_to_index = {path: index for index, path in enumerate(all_image_paths)}
    score_map: dict[str, float] = {}
    for query_records in (train_records, val_records, test_records):
        outputs = evaluate_query_images(
            query_records=query_records,
            gallery_records=train_records,
            path_to_index=path_to_index,
            all_embeddings=embeddings,
            top_k=10,
        )
        for row in outputs["predictions"]:
            prepared_path = str(row.get("image_path") or "").strip()
            if prepared_path:
                score_map[prepared_path] = float(row.get("positive_probability") or 0.5)
    return score_map


def group_records_by_visit(records: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        key = (str(record["patient_id"]), str(record["visit_date"]))
        grouped[key].append(record)
    return grouped


def select_topk_records_per_visit(
    *,
    records: list[dict[str, Any]],
    score_map: dict[str, float],
    top_k: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    grouped = group_records_by_visit(records)
    selected_records: list[dict[str, Any]] = []
    before_sizes: list[int] = []
    after_sizes: list[int] = []
    for (_patient_id, _visit_date), visit_records in grouped.items():
        before_sizes.append(len(visit_records))
        ranked = sorted(
            [
                {
                    **record,
                    "retrieval_positive_probability": float(score_map.get(str(record["image_path"]), 0.5)),
                }
                for record in visit_records
            ],
            key=lambda item: (-float(item["retrieval_positive_probability"]), str(item.get("image_path") or "")),
        )
        kept = ranked[: max(1, int(top_k))]
        after_sizes.append(len(kept))
        for index, record in enumerate(kept, start=1):
            selected_records.append({**record, "retrieval_guidance_rank": int(index)})
    metadata = {
        "selection_top_k": int(top_k),
        "n_input_images": len(records),
        "n_selected_images": len(selected_records),
        "n_visits": len(grouped),
        "mean_bag_size_before": round(sum(before_sizes) / len(before_sizes), 6) if before_sizes else 0.0,
        "mean_bag_size_after": round(sum(after_sizes) / len(after_sizes), 6) if after_sizes else 0.0,
        "max_bag_size_before": max(before_sizes) if before_sizes else 0,
        "max_bag_size_after": max(after_sizes) if after_sizes else 0,
    }
    return selected_records, metadata


def run_retrieval_guided_lesion_mil_component(
    *,
    component_name: str,
    label: str,
    order: int,
    spec: ExperimentSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
    selection_top_k: int,
) -> dict[str, Any]:
    lesion_records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode="manual")
    score_map = build_retrieval_guided_score_map(
        records=lesion_records,
        split=shared_split,
        output_root=output_root / "_guidance_cache",
        device=device,
    )
    selected_records, selection_metadata = select_topk_records_per_visit(
        records=lesion_records,
        score_map=score_map,
        top_k=selection_top_k,
    )
    component_dir = output_root / component_name
    component_dir.mkdir(parents=True, exist_ok=True)
    write_json(
        component_dir / "selection_audit.json",
        {
            "created_at": utc_now(),
            "component_name": component_name,
            "selection_mode": "retrieval_guided_lesion_topk",
            "selection_metadata": selection_metadata,
        },
    )
    return run_mil_component(
        component_name=component_name,
        label=label,
        order=order,
        family="MIL",
        spec=spec,
        records=selected_records,
        workflow=workflow,
        shared_split=shared_split,
        output_root=output_root,
        device=device,
        extra_result_fields={
            "selection_mode": "retrieval_guided_lesion_topk",
            "selection_top_k": int(selection_top_k),
            "selection_metadata": selection_metadata,
        },
    )


def run_job(args: argparse.Namespace) -> int:
    output_root = args.output_root.expanduser().resolve()
    fold_index = int(args.fold_index)
    component_name = str(args.component).strip()
    component_map = component_index(args.epochs_override, args.lesion_top_k, None)
    if component_name not in component_map:
        raise ValueError(f"Unknown component: {component_name}")

    folds_payload = load_json(folds_path(output_root))
    folds = [dict(item) for item in folds_payload.get("folds", [])]
    fold = next((item for item in folds if int(item["fold_index"]) == fold_index), None)
    if fold is None:
        raise ValueError(f"Fold {fold_index} is not defined in {folds_path(output_root)}")

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = filter_manifest_records_by_view(site_store.generate_manifest().to_dict("records"), args.view_filter)
    component = component_map[component_name]
    spec = component["spec"]

    try:
        if component["kind"] == "retrieval":
            payload = run_retrieval_component(
                spec=spec,
                workflow=workflow,
                site_store=site_store,
                manifest_records=manifest_records,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
                ssl_checkpoint_path=default_ssl_checkpoint_path(),
            )
            write_json(component_leakage_audit_path(output_root, fold_index, component_name), audit_retrieval_payload(payload))
        elif component_name.startswith("dinov2_retrieval_guided_lesion_mil_top"):
            payload = run_retrieval_guided_lesion_mil_component(
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
                selection_top_k=int(component["selection_top_k"]),
            )
        else:
            records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode=spec.crop_mode)
            payload = run_mil_component(
                component_name=component_name,
                label=str(component["label"]),
                order=int(component["order"]),
                family=str(component["family"]),
                spec=spec,
                records=records,
                workflow=workflow,
                shared_split=fold,
                output_root=fold_dir(output_root, fold_index),
                device=args.device,
            )
        write_json(result_path(output_root, fold_index, component_name), payload)
        failure_path(output_root, fold_index, component_name).unlink(missing_ok=True)
        return 0
    except Exception as exc:
        failure_payload = {
            "created_at": utc_now(),
            "fold_index": fold_index,
            "component_name": component_name,
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        write_json(failure_path(output_root, fold_index, component_name), failure_payload)
        raise


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
    manifest_records = filter_manifest_records_by_view(site_store.generate_manifest().to_dict("records"), args.view_filter)
    dataset_summary = summarize_dataset(manifest_records)
    folds = load_or_build_folds(
        output_root,
        workflow=workflow,
        manifest_records=manifest_records,
        num_folds=int(args.num_folds),
        val_split=float(args.val_split),
        force_rerun=bool(args.force_rerun),
    )
    components = build_components(args.epochs_override, args.lesion_top_k, args.components)
    jobs = build_jobs(components, folds)
    if args.max_jobs is not None:
        jobs = jobs[: max(0, int(args.max_jobs))]
    if not jobs:
        raise ValueError("No MIL ablation jobs selected.")

    write_json(
        config_path(output_root),
        {
            "created_at": utc_now(),
            "queue_name": "mil_backbone_ablation_cv",
            "site_id": str(args.site_id),
            "device": str(args.device),
            "python_exe": str(python_exe),
            "view_filter": str(args.view_filter),
            "num_folds": int(args.num_folds),
            "val_split": float(args.val_split),
            "dataset_summary": dataset_summary,
            "epochs_override": int(args.epochs_override) if args.epochs_override is not None else None,
            "lesion_top_k": int(args.lesion_top_k),
            "max_retries": int(args.max_retries),
            "retry_delay_seconds": int(args.retry_delay_seconds),
            "force_rerun": bool(args.force_rerun),
            "components": [
                {
                    "name": str(component["name"]),
                    "label": str(component["label"]),
                    "family": str(component["family"]),
                    "kind": str(component["kind"]),
                    "order": int(component["order"]),
                    "spec": (
                        asdict(component["spec"].experiment)
                        if component["kind"] == "retrieval"
                        else asdict(component["spec"])
                    ),
                }
                for component in components
            ],
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
            site_id=str(args.site_id),
            device=str(args.device),
            fold_index=fold_index,
            component_name=component_name,
            view_filter=str(args.view_filter),
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
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "job":
        return run_job(args)
    return run_queue(args)


if __name__ == "__main__":
    raise SystemExit(main())
