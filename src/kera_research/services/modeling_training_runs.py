from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

from kera_research.domain import (
    LABEL_TO_INDEX,
    is_attention_mil_architecture,
    is_lesion_guided_fusion_architecture,
    is_paired_attention_mil_architecture,
    is_three_scale_lesion_guided_fusion_architecture,
    make_id,
    utc_now,
)
from kera_research.services.modeling_data import (
    LesionGuidedFusionDataset,
    ManifestImageDataset,
    PairedCropDataset,
    ThreeScaleLesionGuidedFusionDataset,
    VisitBagDataset,
    VisitPairedBagDataset,
    collate_visit_bags,
    collate_visit_paired_bags,
)

try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    nn = None
    DataLoader = None


def _require_torch() -> None:
    if torch is None or nn is None or DataLoader is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    if torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


def build_cross_validation_splits(
    manager: Any,
    patient_ids: list[str],
    patient_labels: dict[str, str],
    num_folds: int,
    val_split: float,
    seed: int = 42,
) -> list[dict[str, Any]]:
    unique_patient_ids = list(dict.fromkeys(patient_ids))
    if len(unique_patient_ids) < num_folds:
        raise ValueError(f"At least {num_folds} patients are required for {num_folds}-fold cross-validation.")

    label_list = [patient_labels[patient_id] for patient_id in unique_patient_ids]
    label_counts = pd.Series(label_list).value_counts().to_dict()
    use_stratified = len(set(label_list)) > 1 and min(label_counts.values()) >= num_folds

    if use_stratified:
        splitter = StratifiedKFold(n_splits=num_folds, shuffle=True, random_state=seed)
        split_iter = splitter.split(unique_patient_ids, label_list)
    else:
        shuffled_ids = unique_patient_ids[:]
        random.Random(seed).shuffle(shuffled_ids)
        fold_buckets = [[] for _ in range(num_folds)]
        for index, patient_id in enumerate(shuffled_ids):
            fold_buckets[index % num_folds].append(patient_id)
        split_iter = []
        for fold_index in range(num_folds):
            test_ids = fold_buckets[fold_index]
            train_ids = [patient_id for idx, bucket in enumerate(fold_buckets) if idx != fold_index for patient_id in bucket]
            split_iter.append((train_ids, test_ids))

    folds: list[dict[str, Any]] = []
    for fold_index, split in enumerate(split_iter, start=1):
        if use_stratified:
            train_val_idx, test_idx = split
            train_val_ids = [unique_patient_ids[index] for index in train_val_idx.tolist()]
            test_ids = [unique_patient_ids[index] for index in test_idx.tolist()]
        else:
            train_val_ids, test_ids = split
        if len(train_val_ids) < 2 or not test_ids:
            raise ValueError("Cross-validation fold construction failed. Not enough patients in a fold.")
        val_count = max(1, int(round(len(train_val_ids) * val_split)))
        val_count = min(val_count, len(train_val_ids) - 1)
        train_ids, val_ids = manager._split_ids_with_fallback(train_val_ids, patient_labels, val_count, seed + fold_index)
        folds.append(
            {
                "split_id": make_id("cvsplit"),
                "strategy": "patient_level_cross_validation",
                "fold_index": fold_index,
                "num_folds": num_folds,
                "split_seed": seed,
                "val_split": float(val_split),
                "test_split": len(test_ids) / len(unique_patient_ids),
                "train_patient_ids": train_ids,
                "val_patient_ids": val_ids,
                "test_patient_ids": test_ids,
                "n_train_patients": len(train_ids),
                "n_val_patients": len(val_ids),
                "n_test_patients": len(test_ids),
                "total_patients": len(unique_patient_ids),
                "created_at": utc_now(),
            }
        )
    return folds


def initial_train_attention_mil(
    manager: Any,
    *,
    records: list[dict[str, Any]],
    architecture: str,
    output_model_path: str | Path,
    device: str,
    epochs: int,
    learning_rate: float,
    batch_size: int,
    val_split: float,
    test_split: float,
    use_pretrained: bool,
    pretraining_source: str | None,
    ssl_checkpoint_path: str | Path | None,
    saved_split: dict[str, Any] | None,
    crop_mode: str | None,
    training_input_policy: str | None,
    progress_callback: Any,
    fine_tuning_mode: str,
    backbone_learning_rate: float | None,
    head_learning_rate: float | None,
    warmup_epochs: int,
    early_stop_patience: int | None,
    partial_unfreeze_blocks: int,
) -> dict[str, Any]:
    _require_torch()
    patient_to_records: dict[str, list[dict[str, Any]]] = {}
    patient_to_label: dict[str, str] = {}
    for record in records:
        patient_id = str(record["patient_id"])
        patient_to_records.setdefault(patient_id, []).append(record)
        patient_to_label.setdefault(patient_id, str(record["culture_category"]))

    patient_ids = list(patient_to_records)
    if len(patient_ids) < 4:
        raise ValueError(f"최소 4명의 환자가 필요합니다 (현재 {len(patient_ids)}명).")

    patient_split = manager._build_patient_split(
        patient_ids=patient_ids,
        patient_labels=patient_to_label,
        val_split=val_split,
        test_split=test_split,
        saved_split=saved_split,
        seed=42,
    )
    train_patient_ids = patient_split["train_patient_ids"]
    val_patient_ids = patient_split["val_patient_ids"]
    test_patient_ids = patient_split["test_patient_ids"]

    train_records = [record for patient_id in train_patient_ids for record in patient_to_records[patient_id]]
    val_records = [record for patient_id in val_patient_ids for record in patient_to_records[patient_id]]
    test_records = [record for patient_id in test_patient_ids for record in patient_to_records[patient_id]]

    preprocess_metadata = manager.preprocess_metadata()
    dataset_cls = VisitPairedBagDataset if is_paired_attention_mil_architecture(architecture) else VisitBagDataset
    collate_fn = collate_visit_paired_bags if is_paired_attention_mil_architecture(architecture) else collate_visit_bags
    train_ds = dataset_cls(train_records, augment=True, preprocess_metadata=preprocess_metadata)
    val_ds = dataset_cls(val_records, augment=False, preprocess_metadata=preprocess_metadata)
    test_ds = dataset_cls(test_records, augment=False, preprocess_metadata=preprocess_metadata)

    train_case_count = len(train_ds)
    val_case_count = len(val_ds)
    test_case_count = len(test_ds)
    if train_case_count == 0 or val_case_count == 0 or test_case_count == 0:
        raise ValueError("Attention MIL training requires at least one visit in each train/val/test split.")

    bs = max(1, min(batch_size, train_case_count))
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(val_ds, batch_size=max(1, min(batch_size, val_case_count)), shuffle=False, collate_fn=collate_fn)
    test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, test_case_count)), shuffle=False, collate_fn=collate_fn)

    model, resolved_pretraining_source, ssl_metadata = manager.build_model_for_training(
        architecture,
        pretraining_source=pretraining_source,
        use_pretrained=use_pretrained,
        ssl_checkpoint_path=ssl_checkpoint_path,
    )
    model = model.to(device)
    resolved_fine_tuning_mode = manager.normalize_fine_tuning_mode(fine_tuning_mode)
    if resolved_pretraining_source == "scratch" and resolved_fine_tuning_mode != "full":
        raise ValueError("linear_probe/partial modes require pretrained or SSL-initialized weights.")

    manager._configure_fine_tuning(
        model,
        architecture,
        fine_tuning_mode=resolved_fine_tuning_mode,
        unfreeze_last_blocks=partial_unfreeze_blocks,
    )
    backbone_frozen = resolved_fine_tuning_mode != "full"

    optimizer = manager._build_training_optimizer(
        model,
        architecture,
        learning_rate=learning_rate,
        backbone_learning_rate=backbone_learning_rate,
        head_learning_rate=head_learning_rate,
        weight_decay=1e-4,
    )
    scheduler = manager._build_training_scheduler(
        optimizer,
        epochs=epochs,
        learning_rate=learning_rate,
        warmup_epochs=warmup_epochs,
    )
    train_case_labels = [LABEL_TO_INDEX[str(visit_records[0]["culture_category"])] for visit_records in train_ds.visit_records]
    class_counts = np.bincount(train_case_labels, minlength=len(LABEL_TO_INDEX))
    class_weights = np.array(
        [0.0 if count == 0 else len(train_case_labels) / (len(LABEL_TO_INDEX) * count) for count in class_counts],
        dtype=np.float32,
    )
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

    best_val_acc = -1.0
    best_state: dict[str, Any] = {}
    history: list[dict[str, Any]] = []
    epochs_without_improvement = 0
    stopped_early = False

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses: list[float] = []
        for batch_inputs, batch_mask, batch_labels in train_loader:
            batch_inputs = manager._bag_inputs_to_device(batch_inputs, device)
            batch_mask = batch_mask.to(device)
            batch_labels = batch_labels.to(device)
            optimizer.zero_grad()
            logits = manager._bag_forward(model, batch_inputs, batch_mask)
            loss = loss_fn(logits, batch_labels)
            loss.backward()
            optimizer.step()
            train_losses.append(float(loss.item()))
        scheduler.step()

        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for batch_inputs, batch_mask, batch_labels in val_loader:
                batch_inputs = manager._bag_inputs_to_device(batch_inputs, device)
                batch_mask = batch_mask.to(device)
                batch_labels = batch_labels.to(device)
                preds = torch.argmax(manager._bag_forward(model, batch_inputs, batch_mask), dim=1)
                correct += int((preds == batch_labels).sum().item())
                total += len(batch_labels)

        train_loss = float(np.mean(train_losses)) if train_losses else math.nan
        val_acc = correct / total if total > 0 else 0.0
        history.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best_state = {key: value.cpu().clone() for key, value in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        if progress_callback:
            progress_callback(epoch, epochs, train_loss, val_acc)

        if early_stop_patience is not None and epochs_without_improvement >= max(1, int(early_stop_patience)):
            stopped_early = True
            break

    output = Path(output_model_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model.load_state_dict(best_state)
    val_outputs = manager._collect_bag_loader_outputs(model, val_loader, device)
    threshold_selection = manager.select_decision_threshold(
        [int(value) for value in val_outputs["true_labels"]],
        [float(value) for value in val_outputs["positive_probabilities"]],
    )
    decision_threshold = float(threshold_selection["decision_threshold"])
    val_metrics = manager.classification_metrics(
        [int(value) for value in val_outputs["true_labels"]],
        [],
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    val_metrics["n_samples"] = len(val_outputs["true_labels"])
    val_predictions = manager._build_prediction_records(
        manager._visit_prediction_rows_from_records(val_ds.visit_records),
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    test_outputs = manager._collect_bag_loader_outputs(model, test_loader, device)
    test_metrics = manager.classification_metrics(
        [int(value) for value in test_outputs["true_labels"]],
        [],
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    test_metrics["n_samples"] = len(test_outputs["true_labels"])
    test_predictions = manager._build_prediction_records(
        manager._visit_prediction_rows_from_records(test_ds.visit_records),
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    torch.save(
        {
            "architecture": architecture,
            "state_dict": best_state,
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model",
                crop_mode=crop_mode,
                case_aggregation="attention_mil",
                bag_level=True,
                training_input_policy=training_input_policy,
            ),
        },
        output,
    )

    return {
        "training_id": make_id("train"),
        "output_model_path": str(output),
        "architecture": architecture,
        "epochs": epochs,
        "n_train": len(train_records),
        "n_val": len(val_records),
        "n_test": len(test_records),
        "n_train_images": len(train_records),
        "n_val_images": len(val_records),
        "n_test_images": len(test_records),
        "n_train_cases": train_case_count,
        "n_val_cases": val_case_count,
        "n_test_cases": test_case_count,
        "n_train_patients": len(train_patient_ids),
        "n_val_patients": len(val_patient_ids),
        "n_test_patients": len(test_patient_ids),
        "best_val_acc": round(best_val_acc, 4),
        "best_val_auroc": round(float(val_metrics["AUROC"]), 4) if val_metrics.get("AUROC") is not None else None,
        "use_pretrained": resolved_pretraining_source != "scratch",
        "pretraining_source": resolved_pretraining_source,
        "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
        "ssl_checkpoint": ssl_metadata,
        "history": history,
        "patient_split": patient_split,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": threshold_selection["selection_metric"],
        "threshold_selection_metrics": threshold_selection["selection_metrics"],
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "val_predictions": val_predictions,
        "test_predictions": test_predictions,
        "case_aggregation": "attention_mil",
        "bag_level": True,
        "evaluation_unit": "visit",
        "backbone_frozen": backbone_frozen,
        "fine_tuning_mode": resolved_fine_tuning_mode,
        "backbone_learning_rate": float(backbone_learning_rate) if backbone_learning_rate is not None else None,
        "head_learning_rate": float(head_learning_rate) if head_learning_rate is not None else None,
        "warmup_epochs": int(max(0, warmup_epochs)),
        "early_stop_patience": int(early_stop_patience) if early_stop_patience is not None else None,
        "stopped_early": bool(stopped_early),
        "epochs_completed": len(history),
        "partial_unfreeze_blocks": int(max(1, partial_unfreeze_blocks)),
    }


def initial_train(
    manager: Any,
    *,
    records: list[dict[str, Any]],
    architecture: str,
    output_model_path: str | Path,
    device: str,
    epochs: int = 30,
    learning_rate: float = 1e-4,
    batch_size: int = 16,
    val_split: float = 0.2,
    test_split: float = 0.2,
    use_pretrained: bool = True,
    pretraining_source: str | None = None,
    ssl_checkpoint_path: str | Path | None = None,
    saved_split: dict[str, Any] | None = None,
    crop_mode: str | None = None,
    case_aggregation: str | None = None,
    training_input_policy: str | None = None,
    progress_callback: Any = None,
    fine_tuning_mode: str = "full",
    backbone_learning_rate: float | None = None,
    head_learning_rate: float | None = None,
    warmup_epochs: int = 0,
    early_stop_patience: int | None = None,
    partial_unfreeze_blocks: int = 1,
) -> dict[str, Any]:
    _require_torch()
    if len(records) < 4:
        raise ValueError(f"최소 4개 케이스가 필요합니다 (현재 {len(records)}개).")

    seed_everything(42)
    normalized_case_aggregation = manager.normalize_case_aggregation(case_aggregation, architecture)
    if is_attention_mil_architecture(architecture):
        return initial_train_attention_mil(
            manager,
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=saved_split,
            crop_mode=crop_mode,
            training_input_policy=training_input_policy,
            progress_callback=progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )

    patient_to_records: dict[str, list[dict[str, Any]]] = {}
    patient_to_label: dict[str, str] = {}
    for record in records:
        patient_id = str(record["patient_id"])
        patient_to_records.setdefault(patient_id, []).append(record)
        patient_to_label.setdefault(patient_id, str(record["culture_category"]))

    patient_ids = list(patient_to_records)
    if len(patient_ids) < 4:
        raise ValueError(f"최소 4명의 환자가 필요합니다 (현재 {len(patient_ids)}명).")

    patient_split = manager._build_patient_split(
        patient_ids=patient_ids,
        patient_labels=patient_to_label,
        val_split=val_split,
        test_split=test_split,
        saved_split=saved_split,
        seed=42,
    )
    train_patient_ids = patient_split["train_patient_ids"]
    val_patient_ids = patient_split["val_patient_ids"]
    test_patient_ids = patient_split["test_patient_ids"]

    train_records = [record for patient_id in train_patient_ids for record in patient_to_records[patient_id]]
    val_records = [record for patient_id in val_patient_ids for record in patient_to_records[patient_id]]
    test_records = [record for patient_id in test_patient_ids for record in patient_to_records[patient_id]]

    preprocess_metadata = manager.preprocess_metadata()
    if manager.is_dual_input_architecture(architecture):
        dataset_cls = (
            ThreeScaleLesionGuidedFusionDataset
            if is_three_scale_lesion_guided_fusion_architecture(architecture)
            else LesionGuidedFusionDataset
        ) if is_lesion_guided_fusion_architecture(architecture) else PairedCropDataset
        train_ds = dataset_cls(train_records, augment=True, preprocess_metadata=preprocess_metadata)
        val_ds = dataset_cls(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = dataset_cls(test_records, augment=False, preprocess_metadata=preprocess_metadata)
    else:
        train_ds = ManifestImageDataset(train_records, augment=True, preprocess_metadata=preprocess_metadata)
        val_ds = ManifestImageDataset(val_records, augment=False, preprocess_metadata=preprocess_metadata)
        test_ds = ManifestImageDataset(test_records, augment=False, preprocess_metadata=preprocess_metadata)
    bs = max(1, min(batch_size, len(train_records)))
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=bs, shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=max(1, min(batch_size, len(test_records))), shuffle=False)

    model, resolved_pretraining_source, ssl_metadata = manager.build_model_for_training(
        architecture,
        pretraining_source=pretraining_source,
        use_pretrained=use_pretrained,
        ssl_checkpoint_path=ssl_checkpoint_path,
    )
    model = model.to(device)
    resolved_fine_tuning_mode = manager.normalize_fine_tuning_mode(fine_tuning_mode)
    if resolved_pretraining_source == "scratch" and resolved_fine_tuning_mode != "full":
        raise ValueError("linear_probe/partial modes require pretrained or SSL-initialized weights.")
    manager._configure_fine_tuning(
        model,
        architecture,
        fine_tuning_mode=resolved_fine_tuning_mode,
        unfreeze_last_blocks=partial_unfreeze_blocks,
    )

    optimizer = manager._build_training_optimizer(
        model,
        architecture,
        learning_rate=learning_rate,
        backbone_learning_rate=backbone_learning_rate,
        head_learning_rate=head_learning_rate,
        weight_decay=1e-4,
    )
    scheduler = manager._build_training_scheduler(
        optimizer,
        epochs=epochs,
        learning_rate=learning_rate,
        warmup_epochs=warmup_epochs,
    )
    class_counts = np.bincount(
        [LABEL_TO_INDEX[item["culture_category"]] for item in train_records],
        minlength=len(LABEL_TO_INDEX),
    )
    class_weights = np.array(
        [0.0 if count == 0 else len(train_records) / (len(LABEL_TO_INDEX) * count) for count in class_counts],
        dtype=np.float32,
    )
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

    best_val_acc = 0.0
    best_state: dict[str, Any] = {}
    history: list[dict[str, Any]] = []
    epochs_without_improvement = 0
    stopped_early = False

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses: list[float] = []
        if manager.is_dual_input_architecture(architecture):
            for batch in train_loader:
                optimizer.zero_grad()
                logits, batch_labels = manager._paired_forward_from_batch(model, batch, device)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        else:
            for batch_inputs, batch_labels in train_loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                loss = loss_fn(model(batch_inputs), batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        scheduler.step()

        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            if manager.is_dual_input_architecture(architecture):
                for batch in val_loader:
                    logits, batch_labels = manager._paired_forward_from_batch(model, batch, device)
                    preds = torch.argmax(logits, dim=1)
                    correct += int((preds == batch_labels).sum().item())
                    total += len(batch_labels)
            else:
                for batch_inputs, batch_labels in val_loader:
                    batch_inputs = batch_inputs.to(device)
                    batch_labels = batch_labels.to(device)
                    preds = torch.argmax(model(batch_inputs), dim=1)
                    correct += int((preds == batch_labels).sum().item())
                    total += len(batch_labels)

        train_loss = float(np.mean(train_losses)) if train_losses else math.nan
        val_acc = correct / total if total > 0 else 0.0
        history.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        if progress_callback:
            progress_callback(epoch, epochs, train_loss, val_acc)

        if early_stop_patience is not None and epochs_without_improvement >= max(1, int(early_stop_patience)):
            stopped_early = True
            break

    output = Path(output_model_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model.load_state_dict(best_state)
    val_outputs = (
        manager._collect_paired_loader_outputs(model, val_loader, device)
        if manager.is_dual_input_architecture(architecture)
        else manager._collect_loader_outputs(model, val_loader, device)
    )
    threshold_selection = manager.select_decision_threshold(
        [int(value) for value in val_outputs["true_labels"]],
        [float(value) for value in val_outputs["positive_probabilities"]],
    )
    decision_threshold = float(threshold_selection["decision_threshold"])
    val_metrics = manager.classification_metrics(
        [int(value) for value in val_outputs["true_labels"]],
        [],
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    val_metrics["n_samples"] = len(val_outputs["true_labels"])
    val_predictions = manager._build_prediction_records(
        manager._image_prediction_rows_from_records(val_records),
        [float(value) for value in val_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    test_outputs = (
        manager._collect_paired_loader_outputs(model, test_loader, device)
        if manager.is_dual_input_architecture(architecture)
        else manager._collect_loader_outputs(model, test_loader, device)
    )
    test_metrics = manager.classification_metrics(
        [int(value) for value in test_outputs["true_labels"]],
        [],
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    test_metrics["n_samples"] = len(test_outputs["true_labels"])
    test_predictions = manager._build_prediction_records(
        manager._image_prediction_rows_from_records(test_records),
        [float(value) for value in test_outputs["positive_probabilities"]],
        threshold=decision_threshold,
    )
    torch.save(
        {
            "architecture": architecture,
            "state_dict": best_state,
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model",
                crop_mode=crop_mode,
                case_aggregation=normalized_case_aggregation,
                bag_level=False,
                training_input_policy=training_input_policy,
                preprocess_metadata=preprocess_metadata,
            ),
        },
        output,
    )

    return {
        "training_id": make_id("train"),
        "output_model_path": str(output),
        "architecture": architecture,
        "epochs": epochs,
        "n_train": len(train_records),
        "n_val": len(val_records),
        "n_test": len(test_records),
        "n_train_patients": len(train_patient_ids),
        "n_val_patients": len(val_patient_ids),
        "n_test_patients": len(test_patient_ids),
        "best_val_acc": round(best_val_acc, 4),
        "use_pretrained": resolved_pretraining_source != "scratch",
        "pretraining_source": resolved_pretraining_source,
        "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
        "ssl_checkpoint": ssl_metadata,
        "history": history,
        "patient_split": patient_split,
        "decision_threshold": decision_threshold,
        "threshold_selection_metric": threshold_selection["selection_metric"],
        "threshold_selection_metrics": threshold_selection["selection_metrics"],
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
        "val_predictions": val_predictions,
        "test_predictions": test_predictions,
        "case_aggregation": normalized_case_aggregation,
        "bag_level": False,
        "fine_tuning_mode": resolved_fine_tuning_mode,
        "backbone_learning_rate": float(backbone_learning_rate) if backbone_learning_rate is not None else None,
        "head_learning_rate": float(head_learning_rate) if head_learning_rate is not None else None,
        "warmup_epochs": int(max(0, warmup_epochs)),
        "early_stop_patience": int(early_stop_patience) if early_stop_patience is not None else None,
        "stopped_early": bool(stopped_early),
        "epochs_completed": len(history),
        "partial_unfreeze_blocks": int(max(1, partial_unfreeze_blocks)),
    }


def refit_all_cases(
    manager: Any,
    *,
    records: list[dict[str, Any]],
    architecture: str,
    output_model_path: str | Path,
    device: str,
    epochs: int = 30,
    learning_rate: float = 1e-4,
    batch_size: int = 16,
    use_pretrained: bool = True,
    pretraining_source: str | None = None,
    ssl_checkpoint_path: str | Path | None = None,
    crop_mode: str | None = None,
    case_aggregation: str | None = None,
    training_input_policy: str | None = None,
    progress_callback: Any = None,
    fine_tuning_mode: str = "full",
    backbone_learning_rate: float | None = None,
    head_learning_rate: float | None = None,
    warmup_epochs: int = 0,
    early_stop_patience: int | None = None,
    partial_unfreeze_blocks: int = 1,
) -> dict[str, Any]:
    _require_torch()
    if len(records) < 4:
        raise ValueError(f"최소 4개 케이스가 필요합니다 (현재 {len(records)}개).")
    if is_attention_mil_architecture(architecture):
        raise ValueError("Full-dataset refit does not currently support attention MIL architectures.")

    seed_everything(42)
    normalized_case_aggregation = manager.normalize_case_aggregation(case_aggregation, architecture)
    unique_patient_ids = list(dict.fromkeys(str(record["patient_id"]) for record in records))
    if len(unique_patient_ids) < 4:
        raise ValueError(f"최소 4명의 환자가 필요합니다 (현재 {len(unique_patient_ids)}명).")

    preprocess_metadata = manager.preprocess_metadata()
    if manager.is_dual_input_architecture(architecture):
        dataset_cls = (
            ThreeScaleLesionGuidedFusionDataset
            if is_three_scale_lesion_guided_fusion_architecture(architecture)
            else LesionGuidedFusionDataset
        ) if is_lesion_guided_fusion_architecture(architecture) else PairedCropDataset
        train_ds = dataset_cls(records, augment=True, preprocess_metadata=preprocess_metadata)
    else:
        train_ds = ManifestImageDataset(records, augment=True, preprocess_metadata=preprocess_metadata)
    bs = max(1, min(batch_size, len(records)))
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True)

    model, resolved_pretraining_source, ssl_metadata = manager.build_model_for_training(
        architecture,
        pretraining_source=pretraining_source,
        use_pretrained=use_pretrained,
        ssl_checkpoint_path=ssl_checkpoint_path,
    )
    model = model.to(device)
    resolved_fine_tuning_mode = manager.normalize_fine_tuning_mode(fine_tuning_mode)
    if resolved_pretraining_source == "scratch" and resolved_fine_tuning_mode != "full":
        raise ValueError("linear_probe/partial modes require pretrained or SSL-initialized weights.")
    manager._configure_fine_tuning(
        model,
        architecture,
        fine_tuning_mode=resolved_fine_tuning_mode,
        unfreeze_last_blocks=partial_unfreeze_blocks,
    )

    optimizer = manager._build_training_optimizer(
        model,
        architecture,
        learning_rate=learning_rate,
        backbone_learning_rate=backbone_learning_rate,
        head_learning_rate=head_learning_rate,
        weight_decay=1e-4,
    )
    scheduler = manager._build_training_scheduler(
        optimizer,
        epochs=epochs,
        learning_rate=learning_rate,
        warmup_epochs=warmup_epochs,
    )
    class_counts = np.bincount(
        [LABEL_TO_INDEX[item["culture_category"]] for item in records],
        minlength=len(LABEL_TO_INDEX),
    )
    class_weights = np.array(
        [0.0 if count == 0 else len(records) / (len(LABEL_TO_INDEX) * count) for count in class_counts],
        dtype=np.float32,
    )
    loss_fn = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, device=device))

    best_train_loss = math.inf
    best_state: dict[str, Any] = {}
    history: list[dict[str, Any]] = []
    epochs_without_improvement = 0
    stopped_early = False

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses: list[float] = []
        if manager.is_dual_input_architecture(architecture):
            for batch in train_loader:
                optimizer.zero_grad()
                logits, batch_labels = manager._paired_forward_from_batch(model, batch, device)
                loss = loss_fn(logits, batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        else:
            for batch_inputs, batch_labels in train_loader:
                batch_inputs = batch_inputs.to(device)
                batch_labels = batch_labels.to(device)
                optimizer.zero_grad()
                loss = loss_fn(model(batch_inputs), batch_labels)
                loss.backward()
                optimizer.step()
                train_losses.append(float(loss.item()))
        scheduler.step()

        train_loss = float(np.mean(train_losses)) if train_losses else math.nan
        history.append({"epoch": epoch, "train_loss": train_loss})

        if train_loss <= best_train_loss:
            best_train_loss = train_loss
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        if progress_callback:
            progress_callback(epoch, epochs, train_loss, None)

        if early_stop_patience is not None and epochs_without_improvement >= max(1, int(early_stop_patience)):
            stopped_early = True
            break

    output = Path(output_model_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model.load_state_dict(best_state)
    torch.save(
        {
            "architecture": architecture,
            "state_dict": best_state,
            "artifact_metadata": manager.build_artifact_metadata(
                architecture=architecture,
                artifact_type="model",
                crop_mode=crop_mode,
                case_aggregation=normalized_case_aggregation,
                bag_level=False,
                training_input_policy=training_input_policy,
                preprocess_metadata=preprocess_metadata,
            ),
        },
        output,
    )

    return {
        "training_id": make_id("train"),
        "output_model_path": str(output),
        "architecture": architecture,
        "epochs": epochs,
        "n_train": len(records),
        "n_train_patients": len(unique_patient_ids),
        "best_train_loss": round(float(best_train_loss), 6) if math.isfinite(best_train_loss) else None,
        "use_pretrained": resolved_pretraining_source != "scratch",
        "pretraining_source": resolved_pretraining_source,
        "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
        "ssl_checkpoint": ssl_metadata,
        "history": history,
        "decision_threshold": 0.5,
        "threshold_selection_metric": "default",
        "threshold_selection_metrics": {
            "selection_metric": "default",
            "decision_threshold": 0.5,
        },
        "case_aggregation": normalized_case_aggregation,
        "bag_level": False,
        "refit_scope": "all_cases",
        "fine_tuning_mode": resolved_fine_tuning_mode,
        "backbone_learning_rate": float(backbone_learning_rate) if backbone_learning_rate is not None else None,
        "head_learning_rate": float(head_learning_rate) if head_learning_rate is not None else None,
        "warmup_epochs": int(max(0, warmup_epochs)),
        "early_stop_patience": int(early_stop_patience) if early_stop_patience is not None else None,
        "stopped_early": bool(stopped_early),
        "epochs_completed": len(history),
        "partial_unfreeze_blocks": int(max(1, partial_unfreeze_blocks)),
    }


def cross_validate(
    manager: Any,
    *,
    records: list[dict[str, Any]],
    architecture: str,
    output_dir: str | Path,
    device: str,
    num_folds: int = 5,
    epochs: int = 30,
    learning_rate: float = 1e-4,
    batch_size: int = 16,
    val_split: float = 0.2,
    use_pretrained: bool = True,
    pretraining_source: str | None = None,
    ssl_checkpoint_path: str | Path | None = None,
    case_aggregation: str | None = None,
    progress_callback: Any = None,
) -> dict[str, Any]:
    patient_labels = {
        str(record["patient_id"]): str(record["culture_category"])
        for record in records
    }
    patient_ids = list(dict.fromkeys(str(record["patient_id"]) for record in records))
    folds = build_cross_validation_splits(
        manager,
        patient_ids=patient_ids,
        patient_labels=patient_labels,
        num_folds=num_folds,
        val_split=val_split,
        seed=42,
    )

    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    fold_results: list[dict[str, Any]] = []

    for fold in folds:
        fold_output_path = output_root / f"{architecture}_fold{fold['fold_index']}.pth"
        if progress_callback:
            progress_callback(
                {
                    "stage": "preparing_fold",
                    "fold_index": fold["fold_index"],
                    "num_folds": num_folds,
                }
            )

        def fold_progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float) -> None:
            if progress_callback:
                progress_callback(
                    {
                        "stage": "training_fold",
                        "fold_index": fold["fold_index"],
                        "num_folds": num_folds,
                        "epoch": epoch,
                        "epochs": total_epochs,
                        "train_loss": train_loss,
                        "val_acc": val_acc,
                    }
                )

        train_result = manager.initial_train(
            records=records,
            architecture=architecture,
            output_model_path=fold_output_path,
            device=device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=fold["test_split"],
            use_pretrained=use_pretrained,
            pretraining_source=pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            saved_split=fold,
            case_aggregation=case_aggregation,
            progress_callback=fold_progress_callback,
        )
        fold_results.append(
            {
                "fold_index": fold["fold_index"],
                "output_model_path": train_result["output_model_path"],
                "n_train_patients": train_result["n_train_patients"],
                "n_val_patients": train_result["n_val_patients"],
                "n_test_patients": train_result["n_test_patients"],
                "n_train": train_result["n_train"],
                "n_val": train_result["n_val"],
                "n_test": train_result["n_test"],
                "best_val_acc": train_result["best_val_acc"],
                "val_metrics": train_result["val_metrics"],
                "test_metrics": train_result["test_metrics"],
                "patient_split": train_result["patient_split"],
            }
        )

    aggregate_metrics: dict[str, dict[str, float | None]] = {}
    for metric_name in ["AUROC", "accuracy", "sensitivity", "specificity", "F1", "balanced_accuracy", "brier_score", "ece"]:
        metric_values = [
            float(fold["test_metrics"][metric_name])
            for fold in fold_results
            if fold["test_metrics"].get(metric_name) is not None
        ]
        aggregate_metrics[metric_name] = {
            "mean": round(float(np.mean(metric_values)), 4) if metric_values else None,
            "std": round(float(np.std(metric_values)), 4) if metric_values else None,
        }

    normalized_pretraining_source = manager.normalize_training_pretraining_source(
        pretraining_source,
        use_pretrained=use_pretrained,
    )
    return {
        "cross_validation_id": make_id("cv"),
        "architecture": architecture,
        "num_folds": num_folds,
        "epochs": epochs,
        "val_split": float(val_split),
        "use_pretrained": bool(normalized_pretraining_source != "scratch"),
        "pretraining_source": normalized_pretraining_source,
        "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
        "fold_results": fold_results,
        "aggregate_metrics": aggregate_metrics,
        "total_patients": len(patient_ids),
        "total_records": len(records),
        "created_at": utc_now(),
    }
