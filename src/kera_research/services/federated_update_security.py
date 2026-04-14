from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
from collections import Counter
from typing import Any


_TRUE_VALUES = {"1", "true", "yes", "on"}
_ALLOWED_AGGREGATION_STRATEGIES = {"fedavg", "coordinate_median", "trimmed_mean"}
_PRODUCTION_LIKE_ENVIRONMENTS = {"prod", "production", "stage", "staging"}


class FederatedPrivacyRuntimePolicyError(ValueError):
    def __init__(self, message: str, *, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = int(status_code)


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


def _runtime_environment_is_production_like() -> bool:
    for env_name in ("KERA_ENVIRONMENT", "KERA_ENV", "ENVIRONMENT", "APP_ENV", "NODE_ENV"):
        value = str(os.getenv(env_name) or "").strip().lower()
        if value in _PRODUCTION_LIKE_ENVIRONMENTS:
            return True
    return False


def federated_update_signing_secret() -> str:
    return str(os.getenv("KERA_FEDERATED_UPDATE_SIGNING_SECRET") or "").strip()


def federated_update_signing_key_id() -> str | None:
    value = str(os.getenv("KERA_FEDERATED_UPDATE_SIGNING_KEY_ID") or "").strip()
    return value or None


def require_signed_federated_updates() -> bool:
    return _env_flag("KERA_REQUIRE_SIGNED_FEDERATED_UPDATES", default=False)


def require_formal_dp_accounting() -> bool:
    return _env_flag("KERA_REQUIRE_FORMAL_DP_ACCOUNTING", default=False)


def acknowledge_non_dp_federated_training() -> bool:
    return _env_flag("KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING", default=False)


def require_secure_aggregation() -> bool:
    return _env_flag("KERA_REQUIRE_SECURE_AGGREGATION", default=False)


def formal_dp_accounting_available() -> bool:
    controls = federated_delta_privacy_controls()
    return bool(
        controls.get("delta_clip_l2_norm")
        and controls.get("delta_noise_multiplier")
        and federated_dp_accountant_delta() is not None
    )


def secure_aggregation_available() -> bool:
    return False


def federated_dp_accountant_delta() -> float | None:
    raw = _env_nonnegative_float("KERA_FEDERATED_DP_ACCOUNTANT_DELTA")
    if raw is None:
        return 1e-6
    if raw <= 0.0 or raw >= 1.0:
        return None
    return float(raw)


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
        "formal_dp_accounting": bool(clip_norm is not None and noise_multiplier not in (None, 0.0) and federated_dp_accountant_delta() is not None),
    }
    if noise_multiplier not in (None, 0.0):
        controls["privacy_mode"] = "client_delta_noise"
    if quantization_bits:
        controls["transport_encoding"] = "symmetric_linear"
    return {key: value for key, value in controls.items() if value not in (None, "")}


def _gaussian_single_round_epsilon(*, noise_multiplier: float, delta: float) -> float:
    if noise_multiplier <= 0.0:
        raise ValueError("noise_multiplier must be positive")
    if not (0.0 < delta < 1.0):
        raise ValueError("delta must be between 0 and 1")
    return math.sqrt(2.0 * math.log(1.25 / delta)) / noise_multiplier


def build_federated_dp_accounting_entry(
    privacy_controls: dict[str, Any] | None,
    *,
    local_steps: int = 1,
    participant_count: int | None = None,
    patient_count: int | None = None,
) -> dict[str, Any]:
    controls = dict(privacy_controls or {})
    clip_norm = controls.get("delta_clip_l2_norm")
    noise_multiplier = controls.get("delta_noise_multiplier")
    delta = federated_dp_accountant_delta()
    steps = max(1, int(local_steps or 1))
    if (
        clip_norm in (None, 0, 0.0)
        or noise_multiplier in (None, 0, 0.0)
        or delta is None
    ):
        return {
            "formal_dp_accounting": False,
            "accountant": None,
            "epsilon": None,
            "delta": delta,
            "local_steps": steps,
        }
    single_round_epsilon = _gaussian_single_round_epsilon(
        noise_multiplier=float(noise_multiplier),
        delta=float(delta),
    )
    total_epsilon = float(single_round_epsilon) * steps
    entry: dict[str, Any] = {
        "formal_dp_accounting": True,
        "accountant": "gaussian_basic_composition",
        "epsilon": total_epsilon,
        "single_round_epsilon": single_round_epsilon,
        "delta": float(delta) * steps,
        "single_round_delta": float(delta),
        "local_steps": steps,
        "clipping_norm": float(clip_norm),
        "noise_multiplier": float(noise_multiplier),
        "assumptions": [
            "client_delta_noise",
            "gaussian_basic_composition",
            "no_secure_aggregation",
        ],
    }
    if participant_count is not None:
        entry["participant_count"] = max(0, int(participant_count))
    if patient_count is not None:
        entry["patient_count"] = max(0, int(patient_count))
    return entry


def summarize_federated_dp_accounting(records: list[dict[str, Any]]) -> dict[str, Any]:
    by_site: dict[str, dict[str, Any]] = {}
    total_epsilon = 0.0
    total_delta = 0.0
    accounted_updates = 0
    for record in records:
        if not isinstance(record, dict):
            continue
        accounting = dict(record.get("dp_accounting") or {})
        if not accounting.get("formal_dp_accounting"):
            continue
        epsilon = float(accounting.get("epsilon") or 0.0)
        delta = float(accounting.get("delta") or 0.0)
        site_id = str(record.get("site_id") or "unknown").strip() or "unknown"
        site_entry = by_site.setdefault(
            site_id,
            {
                "site_id": site_id,
                "accounted_updates": 0,
                "epsilon": 0.0,
                "delta": 0.0,
            },
        )
        site_entry["accounted_updates"] = int(site_entry["accounted_updates"]) + 1
        site_entry["epsilon"] = float(site_entry["epsilon"]) + epsilon
        site_entry["delta"] = float(site_entry["delta"]) + delta
        total_epsilon += epsilon
        total_delta += delta
        accounted_updates += 1
    return {
        "formal_dp_accounting": accounted_updates > 0,
        "accounted_updates": accounted_updates,
        "epsilon": total_epsilon if accounted_updates > 0 else None,
        "delta": total_delta if accounted_updates > 0 else None,
        "sites": [by_site[key] for key in sorted(by_site)],
    }


def federated_privacy_runtime_report() -> dict[str, Any]:
    formal_dp_enabled = formal_dp_accounting_available()
    production_like_runtime = _runtime_environment_is_production_like()
    formal_dp_required = require_formal_dp_accounting()
    non_dp_acknowledged = acknowledge_non_dp_federated_training()
    secure_aggregation_required = require_secure_aggregation()
    secure_aggregation_enabled = secure_aggregation_available()
    acknowledgement_required = (
        not formal_dp_enabled and not formal_dp_required and production_like_runtime
    )
    warning_required = acknowledgement_required and not non_dp_acknowledged
    return {
        "formal_dp_accounting": formal_dp_enabled,
        "secure_aggregation": secure_aggregation_enabled,
        "production_like_runtime": production_like_runtime,
        "require_formal_dp_accounting": formal_dp_required,
        "non_dp_acknowledged": non_dp_acknowledged,
        "require_secure_aggregation": secure_aggregation_required,
        "warning_required": warning_required,
        "dp_accountant_delta": federated_dp_accountant_delta(),
        "privacy_controls": federated_delta_privacy_controls(),
    }


def assert_federated_privacy_runtime_ready(*, operation: str) -> None:
    report = federated_privacy_runtime_report()
    if report["require_formal_dp_accounting"] and not report["formal_dp_accounting"]:
        raise FederatedPrivacyRuntimePolicyError(
            f"{operation} is blocked because KERA_REQUIRE_FORMAL_DP_ACCOUNTING=true "
            "but formal DP accounting is not implemented in this build.",
            status_code=503,
        )
    if report["require_secure_aggregation"] and not report["secure_aggregation"]:
        raise FederatedPrivacyRuntimePolicyError(
            f"{operation} is blocked because KERA_REQUIRE_SECURE_AGGREGATION=true "
            "but secure aggregation is not implemented in this build.",
            status_code=503,
        )
    if report["warning_required"]:
        raise FederatedPrivacyRuntimePolicyError(
            f"{operation} is blocked in production-like runtimes until the operator explicitly acknowledges "
            "that formal DP accounting is not implemented. Set "
            "KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING=true only for trusted consortium or pilot deployments.",
            status_code=409,
        )


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
        "dp_accounting": dict(record.get("dp_accounting") or {}),
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
