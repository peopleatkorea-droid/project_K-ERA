from __future__ import annotations

import math
import random
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score, roc_curve

from kera_research.domain import INDEX_TO_LABEL, LABEL_TO_INDEX, is_attention_mil_architecture, make_id, utc_now

try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader
except ImportError:  # pragma: no cover - dependency guard
    torch = None
    nn = None
    DataLoader = None


def _require_torch() -> None:
    if torch is None or nn is None:
        raise RuntimeError("PyTorch is required for model inference and training.")


def normalize_case_aggregation(
    value: str | None,
    architecture: str | None = None,
    *,
    default_case_aggregation: str,
    case_aggregations: tuple[str, ...],
) -> str:
    normalized = str(value or "").strip().lower()
    if is_attention_mil_architecture(architecture):
        return "attention_mil"
    if normalized not in case_aggregations or normalized == "attention_mil":
        return default_case_aggregation
    return normalized


def bag_inputs_to_device(
    batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
    device: str,
) -> torch.Tensor | tuple[torch.Tensor, ...]:
    if isinstance(batch_inputs, tuple):
        return tuple(item.to(device) for item in batch_inputs)
    if isinstance(batch_inputs, list):
        return tuple(item.to(device) for item in batch_inputs)
    return batch_inputs.to(device)


def bag_forward(
    model: nn.Module,
    batch_inputs: torch.Tensor | tuple[torch.Tensor, ...] | list[torch.Tensor],
    batch_mask: torch.Tensor | None = None,
    *,
    return_attention: bool = False,
) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
    paired_inputs = isinstance(batch_inputs, (tuple, list))
    if batch_mask is None:
        if paired_inputs:
            if return_attention:
                return model(*batch_inputs, return_attention=True)
            return model(*batch_inputs)
        if return_attention:
            return model(batch_inputs, return_attention=True)
        return model(batch_inputs)
    if paired_inputs:
        if return_attention:
            return model(*batch_inputs, bag_mask=batch_mask, return_attention=True)
        return model(*batch_inputs, bag_mask=batch_mask)
    if return_attention:
        return model(batch_inputs, bag_mask=batch_mask, return_attention=True)
    return model(batch_inputs, batch_mask)


def collect_bag_loader_outputs(
    model: nn.Module,
    loader: DataLoader,
    device: str,
) -> dict[str, list[float] | list[int]]:
    _require_torch()
    model.eval()
    true_labels: list[int] = []
    positive_probabilities: list[float] = []
    with torch.no_grad():
        for batch_inputs, batch_mask, batch_labels in loader:
            batch_inputs = bag_inputs_to_device(batch_inputs, device)
            batch_mask = batch_mask.to(device)
            batch_labels = batch_labels.to(device)
            logits = bag_forward(model, batch_inputs, batch_mask)
            probabilities = torch.softmax(logits, dim=1)
            true_labels.extend(int(value) for value in batch_labels.tolist())
            positive_probabilities.extend(float(value) for value in probabilities[:, 1].tolist())
    return {
        "true_labels": true_labels,
        "positive_probabilities": positive_probabilities,
    }


def build_patient_split(
    manager: Any,
    patient_ids: list[str],
    patient_labels: dict[str, str],
    val_split: float,
    test_split: float,
    saved_split: dict[str, Any] | None = None,
    seed: int = 42,
) -> dict[str, Any]:
    unique_patient_ids = list(dict.fromkeys(patient_ids))
    if len(unique_patient_ids) < 4:
        raise ValueError(f"At least 4 patients are required (current: {len(unique_patient_ids)}).")

    if saved_split:
        train_ids = [
            patient_id
            for patient_id in saved_split.get("train_patient_ids", [])
            if patient_id in unique_patient_ids
        ]
        val_ids = [
            patient_id
            for patient_id in saved_split.get("val_patient_ids", [])
            if patient_id in unique_patient_ids
        ]
        test_ids = [
            patient_id
            for patient_id in saved_split.get("test_patient_ids", [])
            if patient_id in unique_patient_ids
        ]
        assigned = set(train_ids + val_ids + test_ids)
        new_ids = [patient_id for patient_id in unique_patient_ids if patient_id not in assigned]
        train_ids.extend(new_ids)
        if train_ids and val_ids and test_ids:
            return {
                **saved_split,
                "train_patient_ids": train_ids,
                "val_patient_ids": val_ids,
                "test_patient_ids": test_ids,
                "n_train_patients": len(train_ids),
                "n_val_patients": len(val_ids),
                "n_test_patients": len(test_ids),
                "total_patients": len(unique_patient_ids),
                "updated_at": utc_now(),
            }

    test_count = max(1, int(round(len(unique_patient_ids) * test_split)))
    test_count = min(test_count, len(unique_patient_ids) - 2)
    train_val_ids, test_ids = manager._split_ids_with_fallback(unique_patient_ids, patient_labels, test_count, seed)

    val_count = max(1, int(round(len(unique_patient_ids) * val_split)))
    val_count = min(val_count, len(train_val_ids) - 1)
    train_ids, val_ids = manager._split_ids_with_fallback(train_val_ids, patient_labels, val_count, seed + 1)

    return {
        "split_id": make_id("split"),
        "strategy": "patient_level_fixed_train_val_test",
        "split_seed": seed,
        "val_split": float(val_split),
        "test_split": float(test_split),
        "train_patient_ids": train_ids,
        "val_patient_ids": val_ids,
        "test_patient_ids": test_ids,
        "n_train_patients": len(train_ids),
        "n_val_patients": len(val_ids),
        "n_test_patients": len(test_ids),
        "total_patients": len(unique_patient_ids),
        "created_at": utc_now(),
    }


def predicted_labels_from_threshold(
    positive_probabilities: list[float],
    threshold: float = 0.5,
) -> list[int]:
    normalized_threshold = min(max(float(threshold), 0.0), 1.0)
    return [1 if float(probability) >= normalized_threshold else 0 for probability in positive_probabilities]


def image_prediction_rows_from_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        patient_id = str(record.get("patient_id") or "")
        visit_date = str(record.get("visit_date") or "")
        true_label = str(record.get("culture_category") or "").strip().lower()
        true_label_index = LABEL_TO_INDEX.get(true_label)
        source_image_path = str(record.get("source_image_path") or record.get("image_path") or "")
        prepared_image_path = str(record.get("image_path") or "")
        cornea_image_path = str(record.get("cornea_image_path") or record.get("roi_crop_path") or prepared_image_path or "")
        lesion_image_path = str(record.get("lesion_image_path") or record.get("lesion_crop_path") or "")
        sample_key = f"image::{patient_id}::{visit_date}::{source_image_path or prepared_image_path or index}"
        rows.append(
            {
                "sample_key": sample_key,
                "sample_kind": "image",
                "patient_id": patient_id,
                "visit_date": visit_date,
                "true_label": true_label or INDEX_TO_LABEL.get(int(true_label_index or 0), "bacterial"),
                "true_label_index": int(true_label_index or 0),
                "source_image_path": source_image_path or None,
                "prepared_image_path": prepared_image_path or None,
                "cornea_image_path": cornea_image_path or None,
                "lesion_image_path": lesion_image_path or None,
                "view": str(record.get("view") or "").strip() or None,
            }
        )
    return rows


def visit_prediction_rows_from_records(visit_records: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, bag_records in enumerate(visit_records):
        if not bag_records:
            continue
        patient_id = str(bag_records[0].get("patient_id") or "")
        visit_date = str(bag_records[0].get("visit_date") or "")
        true_label = str(bag_records[0].get("culture_category") or "").strip().lower()
        true_label_index = LABEL_TO_INDEX.get(true_label)
        source_image_paths = [
            str(item.get("source_image_path") or item.get("image_path") or "")
            for item in bag_records
            if str(item.get("source_image_path") or item.get("image_path") or "").strip()
        ]
        prepared_image_paths = [
            str(item.get("image_path") or "")
            for item in bag_records
            if str(item.get("image_path") or "").strip()
        ]
        views = [str(item.get("view") or "").strip() for item in bag_records if str(item.get("view") or "").strip()]
        sample_key = f"visit::{patient_id}::{visit_date or index}"
        rows.append(
            {
                "sample_key": sample_key,
                "sample_kind": "visit",
                "patient_id": patient_id,
                "visit_date": visit_date,
                "true_label": true_label or INDEX_TO_LABEL.get(int(true_label_index or 0), "bacterial"),
                "true_label_index": int(true_label_index or 0),
                "source_image_paths": source_image_paths,
                "prepared_image_paths": prepared_image_paths,
                "view": views[0] if views else None,
                "views": views,
            }
        )
    return rows


def build_prediction_records(
    sample_rows: list[dict[str, Any]],
    positive_probabilities: list[float],
    *,
    threshold: float = 0.5,
) -> list[dict[str, Any]]:
    if len(sample_rows) != len(positive_probabilities):
        raise ValueError("Prediction rows and probabilities must have the same length.")
    predicted_labels = predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
    prediction_rows: list[dict[str, Any]] = []
    for row, positive_probability, predicted_index in zip(sample_rows, positive_probabilities, predicted_labels):
        true_label_index = int(row.get("true_label_index") or 0)
        true_label = str(row.get("true_label") or INDEX_TO_LABEL.get(true_label_index, "bacterial"))
        prediction_rows.append(
            {
                **row,
                "true_label": true_label,
                "true_label_index": true_label_index,
                "predicted_label": INDEX_TO_LABEL.get(int(predicted_index), str(predicted_index)),
                "predicted_label_index": int(predicted_index),
                "positive_probability": float(positive_probability),
                "is_correct": int(predicted_index) == true_label_index,
            }
        )
    return prediction_rows


def collect_loader_outputs(
    model: nn.Module,
    loader: DataLoader,
    device: str,
) -> dict[str, list[float] | list[int]]:
    _require_torch()
    model.eval()
    true_labels: list[int] = []
    positive_probabilities: list[float] = []
    with torch.no_grad():
        for batch_inputs, batch_labels in loader:
            batch_inputs = batch_inputs.to(device)
            batch_labels = batch_labels.to(device)
            logits = model(batch_inputs)
            probabilities = torch.softmax(logits, dim=1)
            true_labels.extend(int(value) for value in batch_labels.tolist())
            positive_probabilities.extend(float(value) for value in probabilities[:, 1].tolist())
    return {
        "true_labels": true_labels,
        "positive_probabilities": positive_probabilities,
    }


def paired_forward_from_batch(
    model: nn.Module,
    batch: Any,
    device: str,
) -> tuple[torch.Tensor, torch.Tensor]:
    _require_torch()
    if len(batch) == 5:
        cornea_inputs, medium_inputs, lesion_inputs, lesion_masks, batch_labels = batch
        cornea_inputs = cornea_inputs.to(device)
        medium_inputs = medium_inputs.to(device)
        lesion_inputs = lesion_inputs.to(device)
        lesion_masks = lesion_masks.to(device)
        batch_labels = batch_labels.to(device)
        logits = model(cornea_inputs, medium_inputs, lesion_inputs, lesion_masks)
        return logits, batch_labels
    if len(batch) == 4:
        cornea_inputs, lesion_inputs, lesion_masks, batch_labels = batch
        cornea_inputs = cornea_inputs.to(device)
        lesion_inputs = lesion_inputs.to(device)
        lesion_masks = lesion_masks.to(device)
        batch_labels = batch_labels.to(device)
        logits = model(cornea_inputs, lesion_inputs, lesion_masks)
        return logits, batch_labels
    if len(batch) == 3:
        cornea_inputs, lesion_inputs, batch_labels = batch
        cornea_inputs = cornea_inputs.to(device)
        lesion_inputs = lesion_inputs.to(device)
        batch_labels = batch_labels.to(device)
        logits = model(cornea_inputs, lesion_inputs, None)
        return logits, batch_labels
    raise ValueError(f"Unsupported paired batch structure with {len(batch)} items.")


def collect_paired_loader_outputs(
    model: nn.Module,
    loader: DataLoader,
    device: str,
) -> dict[str, list[float] | list[int]]:
    _require_torch()
    model.eval()
    true_labels: list[int] = []
    positive_probabilities: list[float] = []
    with torch.no_grad():
        for batch in loader:
            logits, batch_labels = paired_forward_from_batch(model, batch, device)
            probabilities = torch.softmax(logits, dim=1)
            true_labels.extend(int(value) for value in batch_labels.tolist())
            positive_probabilities.extend(float(value) for value in probabilities[:, 1].tolist())
    return {
        "true_labels": true_labels,
        "positive_probabilities": positive_probabilities,
    }


def evaluate_loader(
    manager: Any,
    model: nn.Module,
    loader: DataLoader,
    device: str,
    threshold: float = 0.5,
) -> dict[str, Any]:
    outputs = collect_loader_outputs(model, loader, device)
    true_labels = [int(value) for value in outputs["true_labels"]]
    positive_probabilities = [float(value) for value in outputs["positive_probabilities"]]
    predicted_labels = predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
    metrics = manager.classification_metrics(
        true_labels,
        predicted_labels,
        positive_probabilities,
        threshold=threshold,
    )
    metrics["n_samples"] = len(true_labels)
    return metrics


def evaluate_paired_loader(
    manager: Any,
    model: nn.Module,
    loader: DataLoader,
    device: str,
    threshold: float = 0.5,
) -> dict[str, Any]:
    outputs = collect_paired_loader_outputs(model, loader, device)
    true_labels = [int(value) for value in outputs["true_labels"]]
    positive_probabilities = [float(value) for value in outputs["positive_probabilities"]]
    predicted_labels = predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
    metrics = manager.classification_metrics(
        true_labels,
        predicted_labels,
        positive_probabilities,
        threshold=threshold,
    )
    metrics["n_samples"] = len(true_labels)
    return metrics


def select_decision_threshold(true_labels: list[int], positive_probabilities: list[float]) -> dict[str, Any]:
    if not true_labels or not positive_probabilities or len(true_labels) != len(positive_probabilities):
        metrics = classification_metrics(true_labels, [], positive_probabilities, threshold=0.5)
        return {
            "decision_threshold": 0.5,
            "selection_metric": "default",
            "selection_metrics": metrics,
        }

    unique_probabilities = sorted({min(max(float(value), 0.0), 1.0) for value in positive_probabilities})
    threshold_candidates: set[float] = {0.5}
    threshold_candidates.update(unique_probabilities)
    threshold_candidates.update(
        round((left + right) / 2.0, 6)
        for left, right in zip(unique_probabilities, unique_probabilities[1:])
    )

    best_result: dict[str, Any] | None = None
    for threshold in sorted(threshold_candidates):
        metrics = classification_metrics(true_labels, [], positive_probabilities, threshold=threshold)
        score_tuple = (
            float(metrics.get("balanced_accuracy") or 0.0),
            float(metrics.get("F1") or 0.0),
            float(metrics.get("accuracy") or 0.0),
            float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0,
            -abs(float(threshold) - 0.5),
        )
        candidate = {
            "decision_threshold": float(threshold),
            "selection_metric": "balanced_accuracy",
            "selection_metrics": metrics,
            "score_tuple": score_tuple,
        }
        if best_result is None or candidate["score_tuple"] > best_result["score_tuple"]:
            best_result = candidate

    assert best_result is not None
    best_result.pop("score_tuple", None)
    return best_result


def classification_metrics(
    true_labels: list[int],
    predicted_labels: list[int],
    positive_probabilities: list[float],
    threshold: float | None = None,
) -> dict[str, Any]:
    if threshold is not None:
        predicted_labels = predicted_labels_from_threshold(positive_probabilities, threshold=threshold)
    accuracy = float(accuracy_score(true_labels, predicted_labels)) if true_labels else 0.0
    f1 = float(f1_score(true_labels, predicted_labels, zero_division=0)) if true_labels else 0.0

    true_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 1)
    true_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 0)
    false_positive = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 0 and p == 1)
    false_negative = sum(1 for t, p in zip(true_labels, predicted_labels) if t == 1 and p == 0)

    sensitivity = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    specificity = true_negative / (true_negative + false_positive) if (true_negative + false_positive) else 0.0
    balanced_accuracy = float((sensitivity + specificity) / 2.0)
    confusion = confusion_matrix(true_labels, predicted_labels, labels=[0, 1]).tolist() if true_labels else [[0, 0], [0, 0]]

    auroc = None
    roc = None
    if len(set(true_labels)) > 1:
        auroc = float(roc_auc_score(true_labels, positive_probabilities))
        fpr, tpr, thresholds = roc_curve(true_labels, positive_probabilities)
        roc = {
            "fpr": [float(value) for value in fpr.tolist()],
            "tpr": [float(value) for value in tpr.tolist()],
            "thresholds": [
                None if not math.isfinite(float(value)) else float(value)
                for value in thresholds.tolist()
            ],
        }

    brier_score = (
        float(np.mean([(float(probability) - float(label)) ** 2 for label, probability in zip(true_labels, positive_probabilities)]))
        if true_labels
        else None
    )
    calibration_bins: list[dict[str, Any]] = []
    ece = 0.0
    if true_labels and positive_probabilities:
        n_bins = 10
        total = len(true_labels)
        for bin_index in range(n_bins):
            lower = bin_index / n_bins
            upper = (bin_index + 1) / n_bins
            if bin_index == n_bins - 1:
                members = [
                    (float(probability), int(label))
                    for label, probability in zip(true_labels, positive_probabilities)
                    if lower <= float(probability) <= upper
                ]
            else:
                members = [
                    (float(probability), int(label))
                    for label, probability in zip(true_labels, positive_probabilities)
                    if lower <= float(probability) < upper
                ]
            if not members:
                continue
            mean_confidence = float(np.mean([member[0] for member in members]))
            positive_rate = float(np.mean([member[1] for member in members]))
            fraction = len(members) / total
            ece += fraction * abs(positive_rate - mean_confidence)
            calibration_bins.append(
                {
                    "bin_start": round(lower, 4),
                    "bin_end": round(upper, 4),
                    "count": len(members),
                    "mean_confidence": round(mean_confidence, 4),
                    "positive_rate": round(positive_rate, 4),
                }
            )

    return {
        "AUROC": auroc,
        "accuracy": accuracy,
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "balanced_accuracy": balanced_accuracy,
        "F1": f1,
        "brier_score": brier_score,
        "ece": round(float(ece), 6) if calibration_bins else None,
        "decision_threshold": float(threshold) if threshold is not None else None,
        "confusion_matrix": {
            "labels": ["bacterial", "fungal"],
            "matrix": confusion,
        },
        "roc_curve": roc,
        "calibration": {
            "n_bins": 10,
            "bins": calibration_bins,
        },
    }
