from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from scripts.run_dinov2_recovery_validation import (
    DEFAULT_REFERENCE_RESULT,
    ExperimentSpec,
    evaluate_saved_model,
    train_custom_experiment,
    training_input_policy_for_crop_mode,
)
from scripts.run_dinov2_visit_retrieval_validation import (
    RetrievalSpec as VisitRetrievalSpec,
    run_experiment as run_visit_retrieval_experiment,
    summarize_result as summarize_visit_retrieval_result,
)
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService


DEFAULT_OUTPUT_ROOT = REPO_ROOT / "artifacts" / "current_model_suite_20260330"


@dataclass(slots=True)
class StandardSpec:
    name: str
    label: str
    architecture: str
    crop_mode: str
    case_aggregation: str
    order: int
    family: str
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    pretraining_source: str | None = "imagenet"
    use_pretrained: bool = True
    fine_tuning_mode: str = "full"
    backbone_learning_rate: float | None = None
    head_learning_rate: float | None = None
    warmup_epochs: int = 0
    early_stop_patience: int | None = None
    partial_unfreeze_blocks: int = 1


@dataclass(slots=True)
class CustomSpec:
    name: str
    label: str
    order: int
    family: str
    experiment: ExperimentSpec
    include_in_summary: bool = True


@dataclass(slots=True)
class RetrievalSuiteSpec:
    name: str
    label: str
    order: int
    family: str
    experiment: VisitRetrievalSpec


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the current 71-patient / 195-visit / 615-image comparison suite with a shared patient split."
    )
    parser.add_argument("--site-id", default="39100103")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--force-rerun", action="store_true")
    parser.add_argument("--components", nargs="*", default=None)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--test-split", type=float, default=0.2)
    parser.add_argument("--epochs-override", type=int, default=None)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_summary_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_status_payload(
    *,
    overall_status: str,
    current_component: str | None,
    completed_components: list[str],
    failed_components: list[str],
    dataset_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "overall_status": overall_status,
        "current_component": current_component,
        "completed_components": completed_components,
        "failed_components": failed_components,
        "dataset_summary": dataset_summary or {},
    }


def default_ssl_checkpoint_path() -> str:
    payload = load_json(DEFAULT_REFERENCE_RESULT)
    result = payload.get("result", payload)
    ssl_checkpoint_path = str(result.get("ssl_checkpoint_path") or "").strip()
    if not ssl_checkpoint_path:
        raise ValueError(f"SSL checkpoint path missing in reference result: {DEFAULT_REFERENCE_RESULT}")
    return ssl_checkpoint_path


def build_shared_split(
    workflow: ResearchWorkflowService,
    manifest_records: list[dict[str, Any]],
    *,
    val_split: float,
    test_split: float,
) -> dict[str, Any]:
    patient_labels: dict[str, str] = {}
    for record in manifest_records:
        patient_labels.setdefault(str(record["patient_id"]), str(record["culture_category"]))
    patient_ids = sorted(patient_labels)
    split = workflow.model_manager._build_patient_split(
        patient_ids=patient_ids,
        patient_labels=patient_labels,
        val_split=val_split,
        test_split=test_split,
        saved_split=None,
        seed=42,
    )
    return {
        **split,
        "site_id": str(manifest_records[0].get("site_id") or "") if manifest_records else "",
    }


def summarize_dataset(manifest_records: list[dict[str, Any]]) -> dict[str, Any]:
    patients = sorted({str(record["patient_id"]) for record in manifest_records})
    visits = {(str(record["patient_id"]), str(record["visit_date"])) for record in manifest_records}
    return {
        "n_images": len(manifest_records),
        "n_patients": len(patients),
        "n_visits": len(visits),
    }


def build_standard_specs() -> list[StandardSpec]:
    return [
        StandardSpec(
            name="densenet121",
            label="DenseNet121",
            architecture="densenet121",
            crop_mode="automated",
            case_aggregation="mean",
            order=1,
            family="CNN",
        ),
        StandardSpec(
            name="swin",
            label="Swin",
            architecture="swin",
            crop_mode="automated",
            case_aggregation="mean",
            order=2,
            family="Transformer",
        ),
        StandardSpec(
            name="swin_mil",
            label="Swin MIL",
            architecture="swin_mil",
            crop_mode="automated",
            case_aggregation="attention_mil",
            order=3,
            family="MIL",
            batch_size=2,
        ),
        StandardSpec(
            name="efficientnet_v2_s",
            label="EfficientNetV2-S",
            architecture="efficientnet_v2_s",
            crop_mode="automated",
            case_aggregation="mean",
            order=6,
            family="CNN",
        ),
        StandardSpec(
            name="lesion_guided_fusion__swin",
            label="LGF Swin",
            architecture="lesion_guided_fusion__swin",
            crop_mode="paired",
            case_aggregation="mean",
            order=7,
            family="Paired",
            batch_size=2,
        ),
        StandardSpec(
            name="convnext_tiny",
            label="ConvNeXt-Tiny",
            architecture="convnext_tiny",
            crop_mode="automated",
            case_aggregation="mean",
            order=9,
            family="CNN",
        ),
        StandardSpec(
            name="dinov2",
            label="Original DINOv2",
            architecture="dinov2",
            crop_mode="automated",
            case_aggregation="mean",
            order=10,
            family="Transformer",
        ),
        StandardSpec(
            name="vit",
            label="ViT",
            architecture="vit",
            crop_mode="automated",
            case_aggregation="mean",
            order=11,
            family="Transformer",
        ),
    ]


def build_custom_specs() -> list[CustomSpec]:
    prereq_h2 = ExperimentSpec(
        name="prereq_h2_current_ssl_tuned",
        hypothesis="suite_prerequisite_h2",
        architecture="dinov2",
        crop_mode="automated",
        fine_tuning_mode="full",
        learning_rate=5e-5,
        backbone_learning_rate=2e-5,
        head_learning_rate=1e-4,
        warmup_epochs=3,
        early_stop_patience=7,
        epochs=30,
        pretraining_source="ssl",
        use_pretrained=True,
    )
    official_dinov2_mil = ExperimentSpec(
        name="official_dinov2_mil",
        hypothesis="suite_official_dinov2_mil",
        architecture="dinov2_mil",
        crop_mode="automated",
        fine_tuning_mode="full",
        learning_rate=5e-5,
        backbone_learning_rate=1e-5,
        head_learning_rate=1.5e-4,
        warmup_epochs=3,
        early_stop_patience=10,
        epochs=30,
        batch_size=2,
        case_aggregation="attention_mil",
        model_selection_metric="val_auroc",
        pretraining_source="imagenet",
        use_pretrained=True,
    )
    h5_lgf = ExperimentSpec(
        name="h5_lgf_current",
        hypothesis="suite_h5_lgf",
        architecture="lesion_guided_fusion__dinov2",
        crop_mode="paired",
        fine_tuning_mode="full",
        learning_rate=5e-5,
        backbone_learning_rate=1e-5,
        head_learning_rate=1.5e-4,
        warmup_epochs=3,
        early_stop_patience=10,
        epochs=30,
        batch_size=2,
        pretraining_source="ssl",
        use_pretrained=True,
    )
    return [
        CustomSpec(
            name="prereq_h2_current_ssl_tuned",
            label="Prereq h2 SSL-Tuned DINOv2",
            order=0,
            family="Prerequisite",
            experiment=prereq_h2,
            include_in_summary=False,
        ),
        CustomSpec(
            name="official_dinov2_mil",
            label="Official DINOv2 MIL",
            order=4,
            family="MIL",
            experiment=official_dinov2_mil,
        ),
        CustomSpec(
            name="h5_lgf_current",
            label="h5 LGF",
            order=5,
            family="Paired",
            experiment=h5_lgf,
        ),
    ]


def build_retrieval_specs() -> list[RetrievalSuiteSpec]:
    return [
        RetrievalSuiteSpec(
            name="official_dinov2_retrieval",
            label="Official DINOv2 Retrieval",
            order=8,
            family="Retrieval",
            experiment=VisitRetrievalSpec(
                name="official_dinov2_retrieval",
                backbone_source="official",
                crop_variant="cornea_roi",
                top_k=10,
            ),
        )
    ]


def selected_component_names(args: argparse.Namespace) -> set[str] | None:
    if not args.components:
        return None
    return {str(item).strip() for item in args.components if str(item).strip()}


def should_run(name: str, selected: set[str] | None) -> bool:
    return selected is None or name in selected


def result_file(output_root: Path, component_name: str) -> Path:
    return output_root / component_name / "result.json"


def failure_file(output_root: Path, component_name: str) -> Path:
    return output_root / component_name / "failure.json"


def run_standard_component(
    *,
    spec: StandardSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
) -> dict[str, Any]:
    experiment_dir = output_root / spec.name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    output_model_path = experiment_dir / f"{spec.name}.pth"
    records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode=spec.crop_mode)
    result = workflow.model_manager.initial_train(
        records=records,
        architecture=spec.architecture,
        output_model_path=output_model_path,
        device=device,
        epochs=spec.epochs,
        learning_rate=spec.learning_rate,
        batch_size=spec.batch_size,
        val_split=float(shared_split.get("val_split") or 0.2),
        test_split=float(shared_split.get("test_split") or 0.2),
        use_pretrained=spec.use_pretrained,
        pretraining_source=spec.pretraining_source,
        ssl_checkpoint_path=None,
        saved_split=shared_split,
        crop_mode=spec.crop_mode,
        case_aggregation=spec.case_aggregation,
        training_input_policy=training_input_policy_for_crop_mode(workflow, spec.crop_mode, spec.architecture),
        progress_callback=None,
        fine_tuning_mode=spec.fine_tuning_mode,
        backbone_learning_rate=spec.backbone_learning_rate,
        head_learning_rate=spec.head_learning_rate,
        warmup_epochs=spec.warmup_epochs,
        early_stop_patience=spec.early_stop_patience,
        partial_unfreeze_blocks=spec.partial_unfreeze_blocks,
    )
    recomputed = evaluate_saved_model(
        workflow.model_manager,
        architecture=spec.architecture,
        model_path=output_model_path,
        records=records,
        split=result["patient_split"],
        device=device,
        batch_size=spec.batch_size,
        decision_threshold=float(result["decision_threshold"]),
    )
    payload = {
        "suite_component": {
            "name": spec.name,
            "label": spec.label,
            "family": spec.family,
            "order": spec.order,
            "kind": "standard",
            "spec": asdict(spec),
        },
        "result": result,
        "recomputed_metrics": recomputed,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def run_custom_component(
    *,
    spec: CustomSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
    ssl_checkpoint_path: str,
    warm_start_override: str | None = None,
) -> dict[str, Any]:
    experiment_dir = output_root / spec.name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    output_model_path = experiment_dir / f"{spec.name}.pth"
    experiment = spec.experiment
    if warm_start_override is not None:
        experiment = ExperimentSpec(**{**asdict(experiment), "warm_start_model_path": warm_start_override})
    records = workflow._prepare_records_for_model(site_store, manifest_records, crop_mode=experiment.crop_mode)
    result = train_custom_experiment(
        spec=experiment,
        model_manager=workflow.model_manager,
        records=records,
        split=shared_split,
        ssl_checkpoint_path=ssl_checkpoint_path,
        output_model_path=output_model_path,
        device=device,
        training_input_policy=training_input_policy_for_crop_mode(workflow, experiment.crop_mode, experiment.architecture),
        progress_callback=lambda epoch, total_epochs, train_loss, val_acc: print(
            f"[{spec.name}] epoch {epoch}/{total_epochs} train_loss={train_loss:.4f} val_acc={val_acc:.4f}",
            flush=True,
        ),
    )
    recomputed = evaluate_saved_model(
        workflow.model_manager,
        architecture=experiment.architecture,
        model_path=output_model_path,
        records=records,
        split=result["patient_split"],
        device=device,
        batch_size=experiment.batch_size,
        decision_threshold=float(result["decision_threshold"]),
        medium_crop_scale_factor=experiment.medium_crop_scale_factor,
    )
    payload = {
        "suite_component": {
            "name": spec.name,
            "label": spec.label,
            "family": spec.family,
            "order": spec.order,
            "kind": "custom",
            "spec": asdict(experiment),
        },
        "result": result,
        "recomputed_metrics": recomputed,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def run_retrieval_component(
    *,
    spec: RetrievalSuiteSpec,
    workflow: ResearchWorkflowService,
    site_store: SiteStore,
    manifest_records: list[dict[str, Any]],
    shared_split: dict[str, Any],
    output_root: Path,
    device: str,
    ssl_checkpoint_path: str,
) -> dict[str, Any]:
    experiment_dir = output_root / spec.name
    experiment_dir.mkdir(parents=True, exist_ok=True)
    result = run_visit_retrieval_experiment(
        spec=spec.experiment,
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
            "name": spec.name,
            "label": spec.label,
            "family": spec.family,
            "order": spec.order,
            "kind": "retrieval",
            "spec": {
                "name": spec.experiment.name,
                "backbone_source": spec.experiment.backbone_source,
                "crop_variant": spec.experiment.crop_variant,
                "top_k": spec.experiment.top_k,
            },
        },
        "result": result,
    }
    write_json(experiment_dir / "result.json", payload)
    return payload


def summarize_training_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    recomputed = payload["recomputed_metrics"]
    train_metrics = recomputed["train_metrics"]
    val_metrics = result["val_metrics"]
    test_metrics = result["test_metrics"]
    component = payload["suite_component"]
    return {
        "order": component["order"],
        "label": component["label"],
        "family": component["family"],
        "kind": component["kind"],
        "architecture": result["architecture"],
        "evaluation_unit": result.get("evaluation_unit", "image"),
        "n_test_patients": int(result["n_test_patients"]),
        "n_test_cases": result.get("n_test_cases"),
        "train_acc": float(train_metrics["accuracy"]),
        "train_bal_acc": float(train_metrics["balanced_accuracy"]),
        "train_auroc": float(train_metrics["AUROC"]) if train_metrics.get("AUROC") is not None else None,
        "val_acc": float(val_metrics["accuracy"]),
        "val_bal_acc": float(val_metrics["balanced_accuracy"]),
        "val_auroc": float(val_metrics["AUROC"]) if val_metrics.get("AUROC") is not None else None,
        "test_acc": float(test_metrics["accuracy"]),
        "test_bal_acc": float(test_metrics["balanced_accuracy"]),
        "test_auroc": float(test_metrics["AUROC"]) if test_metrics.get("AUROC") is not None else None,
        "test_sensitivity": float(test_metrics["sensitivity"]),
        "test_specificity": float(test_metrics["specificity"]),
        "best_val_acc": float(result["best_val_acc"]),
        "best_val_auroc": float(result["best_val_auroc"]) if result.get("best_val_auroc") is not None else None,
        "decision_threshold": float(result["decision_threshold"]),
        "output_model_path": str(result["output_model_path"]),
    }


def summarize_retrieval_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    row = summarize_visit_retrieval_result(result)
    component = payload["suite_component"]
    return {
        "order": component["order"],
        "label": component["label"],
        "family": component["family"],
        "kind": component["kind"],
        "architecture": "retrieval_dinov2",
        "evaluation_unit": result.get("evaluation_unit", "visit"),
        "n_test_patients": int(result["n_test_patients"]),
        "n_test_cases": int(result["n_test_cases"]),
        "train_acc": None,
        "train_bal_acc": None,
        "train_auroc": None,
        "val_acc": float(row["val_acc"]),
        "val_bal_acc": float(row["val_bal_acc"]),
        "val_auroc": float(row["val_auroc"]) if row["val_auroc"] is not None else None,
        "test_acc": float(row["test_acc"]),
        "test_bal_acc": float(row["test_bal_acc"]),
        "test_auroc": float(row["test_auroc"]) if row["test_auroc"] is not None else None,
        "test_sensitivity": float(row["test_sensitivity"]),
        "test_specificity": float(row["test_specificity"]),
        "best_val_acc": None,
        "best_val_auroc": None,
        "decision_threshold": float(row["decision_threshold"]),
        "output_model_path": "",
    }


def main() -> int:
    args = parse_args()
    output_root = args.output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    status_path = output_root / "status.json"

    control_plane = ControlPlaneStore()
    workflow = ResearchWorkflowService(control_plane)
    site_store = SiteStore(args.site_id)
    manifest_records = site_store.generate_manifest().to_dict("records")
    dataset_summary = summarize_dataset(manifest_records)
    ssl_checkpoint_path = default_ssl_checkpoint_path()

    shared_split_path = output_root / "shared_split.json"
    if shared_split_path.exists() and not args.force_rerun:
        shared_split = load_json(shared_split_path)
    else:
        shared_split = build_shared_split(
            workflow,
            manifest_records,
            val_split=args.val_split,
            test_split=args.test_split,
        )
        write_json(shared_split_path, shared_split)

    write_json(output_root / "dataset_summary.json", dataset_summary)
    selected = selected_component_names(args)
    standard_specs = build_standard_specs()
    custom_specs = build_custom_specs()
    retrieval_specs = build_retrieval_specs()
    if args.epochs_override is not None:
        for spec in standard_specs:
            spec.epochs = int(args.epochs_override)
        for spec in custom_specs:
            spec.experiment.epochs = int(args.epochs_override)

    components: list[tuple[str, Any]] = []
    include_prereq_h2 = selected is None or "h5_lgf_current" in selected or "prereq_h2_current_ssl_tuned" in selected
    components.extend(
        ("custom", spec)
        for spec in custom_specs
        if should_run(spec.name, selected) or (spec.name == "prereq_h2_current_ssl_tuned" and include_prereq_h2)
    )
    components.extend(("standard", spec) for spec in standard_specs if should_run(spec.name, selected))
    components.extend(("retrieval", spec) for spec in retrieval_specs if should_run(spec.name, selected))
    components.sort(key=lambda item: int(item[1].order))

    completed: list[str] = []
    failed: list[str] = []
    payloads: dict[str, Any] = {}
    summary_rows: list[dict[str, Any]] = []
    write_json(
        status_path,
        build_status_payload(
            overall_status="starting",
            current_component=None,
            completed_components=completed,
            failed_components=failed,
            dataset_summary=dataset_summary,
        ),
    )

    current_h2_model_path: str | None = None
    prereq_result_path = result_file(output_root, "prereq_h2_current_ssl_tuned")
    if prereq_result_path.exists() and not args.force_rerun:
        prereq_payload = load_json(prereq_result_path)
        current_h2_model_path = str(prereq_payload["result"]["output_model_path"])

    for component_kind, spec in components:
        component_name = spec.name
        result_path = result_file(output_root, component_name)
        failure_path = failure_file(output_root, component_name)
        if result_path.exists() and not args.force_rerun:
            payload = load_json(result_path)
            payloads[component_name] = payload
            if component_kind != "custom" or spec.include_in_summary:
                summary_rows.append(
                    summarize_retrieval_payload(payload)
                    if component_kind == "retrieval"
                    else summarize_training_payload(payload)
                )
            completed.append(component_name)
            if component_name == "prereq_h2_current_ssl_tuned":
                current_h2_model_path = str(payload["result"]["output_model_path"])
            continue

        write_json(
            status_path,
            build_status_payload(
                overall_status="running",
                current_component=component_name,
                completed_components=completed,
                failed_components=failed,
                dataset_summary=dataset_summary,
            ),
        )
        try:
            if component_kind == "standard":
                payload = run_standard_component(
                    spec=spec,
                    workflow=workflow,
                    site_store=site_store,
                    manifest_records=manifest_records,
                    shared_split=shared_split,
                    output_root=output_root,
                    device=args.device,
                )
            elif component_kind == "retrieval":
                payload = run_retrieval_component(
                    spec=spec,
                    workflow=workflow,
                    site_store=site_store,
                    manifest_records=manifest_records,
                    shared_split=shared_split,
                    output_root=output_root,
                    device=args.device,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                )
            else:
                warm_start_override = current_h2_model_path if component_name == "h5_lgf_current" else None
                if component_name == "h5_lgf_current" and not warm_start_override:
                    raise RuntimeError("h5 LGF requires the prerequisite h2 checkpoint, but it is not available.")
                payload = run_custom_component(
                    spec=spec,
                    workflow=workflow,
                    site_store=site_store,
                    manifest_records=manifest_records,
                    shared_split=shared_split,
                    output_root=output_root,
                    device=args.device,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                    warm_start_override=warm_start_override,
                )

            if failure_path.exists():
                failure_path.unlink()
            payloads[component_name] = payload
            if component_kind != "custom" or spec.include_in_summary:
                summary_rows.append(
                    summarize_retrieval_payload(payload)
                    if component_kind == "retrieval"
                    else summarize_training_payload(payload)
                )
            completed.append(component_name)
            if component_name == "prereq_h2_current_ssl_tuned":
                current_h2_model_path = str(payload["result"]["output_model_path"])
        except Exception as exc:
            failed.append(component_name)
            write_json(
                failure_path,
                {
                    "component": component_name,
                    "error": repr(exc),
                },
            )

    summary_rows.sort(key=lambda item: int(item["order"]))
    write_json(output_root / "all_results.json", payloads)
    write_summary_csv(output_root / "summary.csv", summary_rows)
    write_json(
        status_path,
        build_status_payload(
            overall_status="completed" if not failed else "completed_with_failures",
            current_component=None,
            completed_components=completed,
            failed_components=failed,
            dataset_summary=dataset_summary,
        ),
    )
    print(json.dumps({"output_root": str(output_root), "completed": completed, "failed": failed}, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
