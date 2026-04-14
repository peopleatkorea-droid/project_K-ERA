from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections import Counter
from typing import Any


_TRUE_VALUES = {"1", "true", "yes", "on"}
_ALLOWED_AGGREGATION_STRATEGIES = {"fedavg", "coordinate_median", "trimmed_mean"}


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in _TRUE_VALUES


def _env_positive_float(name: str) -> float | None:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value <= 0:
        return None
    return value


def _env_nonnegative_float(name: str) -> float | None:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value < 0:
        return None
    return value


def _env_quantization_bits(name: str) -> int | None:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    if value not in {8, 16}:
        return None
    return value


def federated_update_signing_secret() -> str:
    return str(os.getenv("KERA_FEDERATED_UPDATE_SIGNING_SECRET") or "").strip()


def federated_update_signing_key_id() -> str | None:
    value = str(os.getenv("KERA_FEDERATED_UPDATE_SIGNING_KEY_ID") or "").strip()
    return value or None


def require_signed_federated_updates() -> bool:
    return _env_flag("KERA_REQUIRE_SIGNED_FEDERATED_UPDATES", default=False)


def federated_aggregation_strategy() -> str:
    raw = str(os.getenv("KERA_FEDERATED_AGGREGATION_STRATEGY") or "fedavg").strip().lower() or "fedavg"
    if raw not in _ALLOWED_AGGREGATION_STRATEGIES:
        return "fedavg"
    return raw


def federated_aggregation_trim_ratio() -> float:
    raw = _env_nonnegative_float("KERA_FEDERATED_AGGREGATION_TRIM_RATIO")
    if raw is None:
        return 0.2
    return max(0.0, min(0.49, float(raw)))


def federated_delta_privacy_controls() -> dict[str, Any]:
    clip_norm = _env_positive_float("KERA_FEDERATED_DELTA_CLIP_NORM")
    noise_multiplier = _env_nonnegative_float("KERA_FEDERATED_DELTA_NOISE_MULTIPLIER")
    quantization_bits = _env_quantization_bits("KERA_FEDERATED_DELTA_QUANTIZATION_BITS")
    if clip_norm is None:
        noise_multiplier = None
    controls: dict[str, Any] = {
        "delta_clip_l2_norm": clip_norm,
        "delta_noise_multiplier": noise_multiplier,
        "delta_quantization_bits": quantization_bits,
        # This is a client-side delta hardening knob, not a full DP accountant.
        "formal_dp_accounting": False,
    }
    if noise_multiplier not in (None, 0.0):
        controls["privacy_mode"] = "client_delta_noise"
    if quantization_bits:
        controls["transport_encoding"] = "symmetric_linear"
    return {key: value for key, value in controls.items() if value not in (None, "")}


def summarize_federated_data_distribution(records: list[dict[str, Any]]) -> dict[str, Any]:
    label_counter: Counter[str] = Counter()
    culture_counter: Counter[str] = Counter()
    species_counter: Counter[str] = Counter()
    patient_ids: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        patient_id = str(record.get("patient_id") or "").strip()
        if patient_id:
            patient_ids.add(patient_id)
        label = str(record.get("label") or record.get("culture_category") or "").strip().lower()
        if label:
            label_counter[label] += 1
        culture_category = str(record.get("culture_category") or "").strip().lower()
        if culture_category:
            culture_counter[culture_category] += 1
        species = str(record.get("culture_species") or "").strip()
        if species:
            species_counter[species] += 1
    return {
        "n_records": len(records),
        "n_patients": len(patient_ids),
        "label_histogram": dict(sorted(label_counter.items())),
        "culture_category_histogram": dict(sorted(culture_counter.items())),
        "top_species": [
            {"label": label, "count": count}
            for label, count in species_counter.most_common(5)
        ],
    }


def _signable_update_payload(record: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "update_id": str(record.get("update_id") or "").strip(),
        "site_id": str(record.get("site_id") or "").strip(),
        "base_model_version_id": str(record.get("base_model_version_id") or "").strip(),
        "architecture": str(record.get("architecture") or "").strip(),
        "upload_type": str(record.get("upload_type") or "").strip(),
        "federated_round_type": str(record.get("federated_round_type") or "").strip(),
        "central_artifact_sha256": str(record.get("central_artifact_sha256") or "").strip().lower(),
        "preprocess_signature": str(record.get("preprocess_signature") or "").strip(),
        "aggregation_weight": record.get("aggregation_weight"),
        "aggregation_weight_unit": str(record.get("aggregation_weight_unit") or "").strip(),
        "privacy_controls": dict(record.get("privacy_controls") or {}),
        "data_distribution": dict(record.get("data_distribution") or {}),
    }
    return payload


def calculate_federated_update_signature(record: dict[str, Any], *, secret: str | None = None) -> str:
    normalized_secret = str(secret or federated_update_signing_secret()).strip()
    if not normalized_secret:
        raise ValueError("KERA_FEDERATED_UPDATE_SIGNING_SECRET is not configured.")
    payload = _signable_update_payload(record)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(normalized_secret.encode("utf-8"), encoded, hashlib.sha256).hexdigest()


def apply_federated_update_signature(record: dict[str, Any], *, secret: str | None = None) -> dict[str, Any]:
    normalized_secret = str(secret or federated_update_signing_secret()).strip()
    if not normalized_secret:
        return record
    signed = dict(record)
    signed["federated_update_signature_alg"] = "hmac-sha256"
    key_id = federated_update_signing_key_id()
    if key_id:
        signed["federated_update_signing_key_id"] = key_id
    signed["federated_update_signature"] = calculate_federated_update_signature(signed, secret=normalized_secret)
    return signed


def verify_federated_update_signature(
    record: dict[str, Any],
    *,
    secret: str | None = None,
    require_signature: bool | None = None,
) -> None:
    if str(record.get("upload_type") or "").strip().lower() != "weight delta":
        return
    expected_required = require_signed_federated_updates() if require_signature is None else bool(require_signature)
    actual_signature = str(record.get("federated_update_signature") or "").strip().lower()
    if not actual_signature:
        if expected_required:
            raise ValueError("Signed federated updates are required before approval or aggregation.")
        return
    normalized_secret = str(secret or federated_update_signing_secret()).strip()
    if not normalized_secret:
        raise ValueError("A signed federated update was received but KERA_FEDERATED_UPDATE_SIGNING_SECRET is not configured.")
    expected_signature = calculate_federated_update_signature(record, secret=normalized_secret).lower()
    if not hmac.compare_digest(actual_signature, expected_signature):
        raise ValueError("Federated update signature verification failed.")
