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
_ALLOWED_DP_ACCOUNTANT_MODES = {
    "gaussian_rdp_poisson_subsampled",
    "gaussian_rdp_full_participation",
    "gaussian_basic_composition",
}
_PRODUCTION_LIKE_ENVIRONMENTS = {"prod", "production", "stage", "staging"}
_GAUSSIAN_RDP_ORDERS = (
    1.25,
    1.5,
    2.0,
    3.0,
    4.0,
    5.0,
    6.0,
    8.0,
    10.0,
    12.0,
    16.0,
    20.0,
    24.0,
    32.0,
    48.0,
    64.0,
    96.0,
    128.0,
    256.0,
)
_GAUSSIAN_RDP_INTEGER_ORDERS = tuple(int(order) for order in _GAUSSIAN_RDP_ORDERS if float(order).is_integer() and order > 1)

_FEDERATED_DP_ACCOUNTANT_SCOPE = "site_local_training"


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


def federated_dp_accountant_mode() -> str:
    raw = str(os.getenv("KERA_FEDERATED_DP_ACCOUNTANT_MODE") or "").strip().lower()
    if raw not in _ALLOWED_DP_ACCOUNTANT_MODES:
        return "gaussian_rdp_poisson_subsampled"
    return raw


def signing_secret_configured() -> bool:
    return bool(federated_update_signing_secret())


def signed_federated_updates_runtime_required() -> bool:
    return require_signed_federated_updates() or _runtime_environment_is_production_like()


def signed_federated_updates_runtime_ready() -> bool:
    if not signed_federated_updates_runtime_required():
        return True
    return require_signed_federated_updates() and signing_secret_configured()


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


def federated_dp_warn_epsilon() -> float | None:
    return _env_positive_float("KERA_FEDERATED_DP_WARN_EPSILON")


def federated_dp_max_epsilon() -> float | None:
    return _env_positive_float("KERA_FEDERATED_DP_MAX_EPSILON")


def _gaussian_rdp_composed_epsilon(*, noise_multiplier: float, delta: float, steps: int) -> tuple[float, float]:
    if noise_multiplier <= 0.0:
        raise ValueError("noise_multiplier must be positive")
    if not (0.0 < delta < 1.0):
        raise ValueError("delta must be between 0 and 1")
    normalized_steps = max(1, int(steps or 1))
    best_epsilon: float | None = None
    best_order: float | None = None
    for order in _GAUSSIAN_RDP_ORDERS:
        if order <= 1.0:
            continue
        rdp = normalized_steps * order / (2.0 * (noise_multiplier ** 2))
        epsilon = rdp + math.log(1.0 / delta) / (order - 1.0)
        if not math.isfinite(epsilon):
            continue
        if best_epsilon is None or epsilon < best_epsilon:
            best_epsilon = float(epsilon)
            best_order = float(order)
    if best_epsilon is None or best_order is None:
        raise ValueError("Unable to compute Gaussian RDP epsilon.")
    return best_epsilon, best_order


def _log_add_exp(left: float, right: float) -> float:
    if left == -math.inf:
        return right
    if right == -math.inf:
        return left
    if left < right:
        left, right = right, left
    return left + math.log1p(math.exp(right - left))


def _normalize_participation_rate(participation_rate: float | None) -> float | None:
    if participation_rate is None:
        return None
    try:
        normalized = float(participation_rate)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(normalized) or normalized <= 0.0:
        return None
    return max(0.0, min(1.0, normalized))


def _gaussian_poisson_subsampled_rdp(*, order: int, participation_rate: float, noise_multiplier: float) -> float:
    if order <= 1:
        raise ValueError("order must be greater than 1")
    if noise_multiplier <= 0.0:
        raise ValueError("noise_multiplier must be positive")
    q = _normalize_participation_rate(participation_rate)
    if q is None:
        raise ValueError("participation_rate must be positive")
    if q >= 1.0:
        return float(order) / (2.0 * (noise_multiplier ** 2))
    log_q = math.log(q)
    log_one_minus_q = math.log1p(-q)
    log_a = -math.inf
    for index in range(order + 1):
        log_binomial = math.log(math.comb(order, index))
        privacy_loss = ((index * index) - index) / (2.0 * (noise_multiplier ** 2))
        log_term = (
            log_binomial
            + (index * log_q)
            + ((order - index) * log_one_minus_q)
            + privacy_loss
        )
        log_a = _log_add_exp(log_a, log_term)
    return log_a / (order - 1.0)


def _gaussian_poisson_subsampled_rdp_composed_epsilon(
    *,
    participation_rate: float,
    noise_multiplier: float,
    delta: float,
    steps: int,
) -> tuple[float, float]:
    if noise_multiplier <= 0.0:
        raise ValueError("noise_multiplier must be positive")
    if not (0.0 < delta < 1.0):
        raise ValueError("delta must be between 0 and 1")
    q = _normalize_participation_rate(participation_rate)
    if q is None:
        raise ValueError("participation_rate must be between 0 and 1")
    if q >= 1.0:
        return _gaussian_rdp_composed_epsilon(
            noise_multiplier=noise_multiplier,
            delta=delta,
            steps=steps,
        )
    normalized_steps = max(1, int(steps or 1))
    best_epsilon: float | None = None
    best_order: float | None = None
    for order in _GAUSSIAN_RDP_INTEGER_ORDERS:
        rdp = normalized_steps * _gaussian_poisson_subsampled_rdp(
            order=order,
            participation_rate=q,
            noise_multiplier=noise_multiplier,
        )
        epsilon = rdp + math.log(1.0 / delta) / (order - 1.0)
        if not math.isfinite(epsilon):
            continue
        if best_epsilon is None or epsilon < best_epsilon:
            best_epsilon = float(epsilon)
            best_order = float(order)
    if best_epsilon is None or best_order is None:
        raise ValueError("Unable to compute subsampled Gaussian RDP epsilon.")
    return best_epsilon, best_order


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


def build_federated_participation_summary(
    *,
    aggregated_site_ids: list[str] | set[str] | tuple[str, ...],
    available_site_ids: list[str] | set[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    normalized_aggregated_site_ids = sorted(
        {
            str(site_id or "").strip()
            for site_id in aggregated_site_ids
            if str(site_id or "").strip()
        }
    )
    normalized_available_site_ids = sorted(
        {
            str(site_id or "").strip()
            for site_id in list(available_site_ids or [])
            if str(site_id or "").strip()
        }
    )
    missing_site_ids = sorted(
        set(normalized_available_site_ids).difference(normalized_aggregated_site_ids)
    )
    available_site_count = len(normalized_available_site_ids)
    aggregated_site_count = len(normalized_aggregated_site_ids)
    participation_rate = (
        round(aggregated_site_count / available_site_count, 4)
        if available_site_count > 0
        else None
    )
    return {
        "aggregated_site_ids": normalized_aggregated_site_ids,
        "aggregated_site_count": aggregated_site_count,
        "available_site_ids": normalized_available_site_ids,
        "available_site_count": available_site_count,
        "missing_site_ids": missing_site_ids,
        "missing_site_count": len(missing_site_ids),
        "participation_rate": participation_rate,
    }


def build_federated_dp_accounting_entry(
    privacy_controls: dict[str, Any] | None,
    *,
    local_steps: int = 1,
    participant_count: int | None = None,
    patient_count: int | None = None,
    participation_rate: float | None = None,
    aggregated_participant_count: int | None = None,
    available_participant_count: int | None = None,
    accountant_delta: float | None = None,
) -> dict[str, Any]:
    controls = dict(privacy_controls or {})
    clip_norm = controls.get("delta_clip_l2_norm")
    noise_multiplier = controls.get("delta_noise_multiplier")
    delta = accountant_delta if accountant_delta is not None else federated_dp_accountant_delta()
    if delta is not None:
        try:
            delta = float(delta)
        except (TypeError, ValueError):
            delta = None
    if delta is not None and not (0.0 < float(delta) < 1.0):
        delta = None
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
    accountant_mode = federated_dp_accountant_mode()
    entry: dict[str, Any]
    if accountant_mode == "gaussian_basic_composition":
        single_round_epsilon = _gaussian_single_round_epsilon(
            noise_multiplier=float(noise_multiplier),
            delta=float(delta),
        )
        total_epsilon = float(single_round_epsilon) * steps
        entry = {
            "formal_dp_accounting": True,
            "accountant": "gaussian_basic_composition",
            "accountant_scope": _FEDERATED_DP_ACCOUNTANT_SCOPE,
            "subsampling_applied": False,
            "epsilon": total_epsilon,
            "single_round_epsilon": single_round_epsilon,
            "delta": float(delta) * steps,
            "single_round_delta": float(delta),
            "local_steps": steps,
            "clipping_norm": float(clip_norm),
            "noise_multiplier": float(noise_multiplier),
            "target_delta": float(delta),
            "assumptions": [
                "client_delta_noise",
                "gaussian_basic_composition",
                "no_secure_aggregation",
            ],
        }
    else:
        normalized_participation_rate = _normalize_participation_rate(participation_rate)
        if accountant_mode == "gaussian_rdp_poisson_subsampled" and normalized_participation_rate not in (None, 1.0):
            epsilon, optimal_order = _gaussian_poisson_subsampled_rdp_composed_epsilon(
                participation_rate=float(normalized_participation_rate),
                noise_multiplier=float(noise_multiplier),
                delta=float(delta),
                steps=steps,
            )
            entry = {
                "formal_dp_accounting": True,
                "accountant": "gaussian_rdp_poisson_subsampled",
                "accountant_scope": _FEDERATED_DP_ACCOUNTANT_SCOPE,
                "subsampling_applied": True,
                "epsilon": float(epsilon),
                "delta": float(delta),
                "local_steps": steps,
                "clipping_norm": float(clip_norm),
                "noise_multiplier": float(noise_multiplier),
                "optimal_order": float(optimal_order),
                "target_delta": float(delta),
                "participation_rate": float(normalized_participation_rate),
                "assumptions": [
                    "client_delta_noise",
                    "gaussian_rdp",
                    "poisson_subsampling",
                    "no_secure_aggregation",
                ],
            }
            if aggregated_participant_count is not None:
                entry["aggregated_participant_count"] = max(0, int(aggregated_participant_count))
            if available_participant_count is not None:
                entry["available_participant_count"] = max(0, int(available_participant_count))
        else:
            epsilon, optimal_order = _gaussian_rdp_composed_epsilon(
                noise_multiplier=float(noise_multiplier),
                delta=float(delta),
                steps=steps,
            )
            entry = {
                "formal_dp_accounting": True,
                "accountant": "gaussian_rdp_full_participation",
                "accountant_scope": _FEDERATED_DP_ACCOUNTANT_SCOPE,
                "subsampling_applied": False,
                "epsilon": float(epsilon),
                "delta": float(delta),
                "local_steps": steps,
                "clipping_norm": float(clip_norm),
                "noise_multiplier": float(noise_multiplier),
                "optimal_order": float(optimal_order),
                "target_delta": float(delta),
                "assumptions": [
                    "client_delta_noise",
                    "gaussian_rdp",
                    "full_participation",
                    "no_subsampling",
                    "no_secure_aggregation",
                ],
            }
    if participant_count is not None:
        entry["participant_count"] = max(0, int(participant_count))
    if patient_count is not None:
        entry["patient_count"] = max(0, int(patient_count))
    return entry


def _apply_participation_adjusted_accounting(
    accounting: dict[str, Any],
    *,
    participation_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(accounting, dict) or not accounting.get("formal_dp_accounting"):
        return dict(accounting or {})
    if federated_dp_accountant_mode() != "gaussian_rdp_poisson_subsampled":
        return dict(accounting)
    if bool(accounting.get("subsampling_applied")):
        return dict(accounting)
    normalized_summary = (
        build_federated_participation_summary(
            aggregated_site_ids=list((participation_summary or {}).get("aggregated_site_ids") or []),
            available_site_ids=list((participation_summary or {}).get("available_site_ids") or []),
        )
        if isinstance(participation_summary, dict)
        else None
    )
    normalized_participation_rate = _normalize_participation_rate(
        (normalized_summary or {}).get("participation_rate")
        if isinstance(normalized_summary, dict)
        else None
    )
    if normalized_participation_rate in (None, 1.0):
        return dict(accounting)
    clip_norm = accounting.get("clipping_norm")
    noise_multiplier = accounting.get("noise_multiplier")
    local_steps = accounting.get("local_steps")
    target_delta = (
        accounting.get("target_delta")
        if accounting.get("target_delta") is not None
        else accounting.get("single_round_delta")
        if accounting.get("single_round_delta") is not None
        else accounting.get("delta")
    )
    if clip_norm in (None, 0, 0.0) or noise_multiplier in (None, 0, 0.0):
        return dict(accounting)
    return build_federated_dp_accounting_entry(
        {
            "delta_clip_l2_norm": clip_norm,
            "delta_noise_multiplier": noise_multiplier,
        },
        local_steps=max(1, int(local_steps or 1)),
        participant_count=(
            int(accounting.get("participant_count") or 0)
            if accounting.get("participant_count") is not None
            else None
        ),
        patient_count=(
            int(accounting.get("patient_count") or 0)
            if accounting.get("patient_count") is not None
            else None
        ),
        participation_rate=float(normalized_participation_rate),
        aggregated_participant_count=int((normalized_summary or {}).get("aggregated_site_count") or 0),
        available_participant_count=int((normalized_summary or {}).get("available_site_count") or 0),
        accountant_delta=(
            float(target_delta)
            if target_delta not in (None, "", 0, 0.0)
            else federated_dp_accountant_delta()
        ),
    )


def summarize_federated_dp_accounting(
    records: list[dict[str, Any]],
    *,
    participation_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    by_site: dict[str, dict[str, Any]] = {}
    total_epsilon = 0.0
    total_delta = 0.0
    accounted_updates = 0
    accountant: str | None = None
    accountant_scope: str | None = None
    subsampling_applied = False
    assumptions: set[str] = set()
    sampling_rate: float | None = None
    target_delta: float | None = None
    aggregated_participant_count: int | None = None
    available_participant_count: int | None = None
    for record in records:
        if not isinstance(record, dict):
            continue
        accounting = _apply_participation_adjusted_accounting(
            dict(record.get("dp_accounting") or {}),
            participation_summary=participation_summary,
        )
        if not accounting.get("formal_dp_accounting"):
            continue
        if accountant is None:
            normalized_accountant = str(accounting.get("accountant") or "").strip()
            accountant = normalized_accountant or None
        if accountant_scope is None:
            normalized_accountant_scope = str(accounting.get("accountant_scope") or "").strip()
            accountant_scope = normalized_accountant_scope or None
        subsampling_applied = subsampling_applied or bool(accounting.get("subsampling_applied"))
        if sampling_rate is None and accounting.get("participation_rate") is not None:
            try:
                sampling_rate = float(accounting.get("participation_rate") or 0.0)
            except (TypeError, ValueError):
                sampling_rate = None
        if target_delta is None and accounting.get("target_delta") is not None:
            try:
                target_delta = float(accounting.get("target_delta") or 0.0)
            except (TypeError, ValueError):
                target_delta = None
        if aggregated_participant_count is None and accounting.get("aggregated_participant_count") is not None:
            aggregated_participant_count = max(0, int(accounting.get("aggregated_participant_count") or 0))
        if available_participant_count is None and accounting.get("available_participant_count") is not None:
            available_participant_count = max(0, int(accounting.get("available_participant_count") or 0))
        assumptions.update(
            str(item or "").strip()
            for item in list(accounting.get("assumptions") or [])
            if str(item or "").strip()
        )
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
        "accountant": accountant if accounted_updates > 0 else None,
        "accountant_scope": accountant_scope if accounted_updates > 0 else None,
        "subsampling_applied": subsampling_applied if accounted_updates > 0 else False,
        "assumptions": sorted(assumptions) if accounted_updates > 0 else [],
        "accounted_updates": accounted_updates,
        "epsilon": total_epsilon if accounted_updates > 0 else None,
        "delta": total_delta if accounted_updates > 0 else None,
        "sampling_rate": sampling_rate if accounted_updates > 0 else None,
        "target_delta": target_delta if accounted_updates > 0 else None,
        "aggregated_participant_count": aggregated_participant_count if accounted_updates > 0 else None,
        "available_participant_count": available_participant_count if accounted_updates > 0 else None,
        "accounted_sites": len(by_site) if accounted_updates > 0 else 0,
        "sites": [by_site[key] for key in sorted(by_site)],
    }


def _federated_dp_budget_template() -> dict[str, Any]:
    return {
        "formal_dp_accounting": False,
        "accountant": None,
        "accountant_scope": None,
        "subsampling_applied": False,
        "assumptions": [],
        "accounted_updates": 0,
        "accounted_aggregations": 0,
        "accounted_sites": 0,
        "epsilon": None,
        "delta": None,
        "sampling_rate": None,
        "target_delta": None,
        "warn_epsilon": None,
        "max_epsilon": None,
        "guardrail_status": "unavailable",
        "guardrail_warnings": [],
        "aggregated_participant_count": None,
        "available_participant_count": None,
        "sites": [],
        "last_accounted_aggregation_id": None,
        "last_accounted_at": None,
        "last_accounted_new_version_name": None,
        "last_accounted_base_model_version_id": None,
        "last_participation_summary": None,
    }


def evaluate_federated_dp_budget_guardrail(
    privacy_budget: dict[str, Any] | None,
) -> dict[str, Any]:
    warn_epsilon = federated_dp_warn_epsilon()
    max_epsilon = federated_dp_max_epsilon()
    if not isinstance(privacy_budget, dict) or not bool(privacy_budget.get("formal_dp_accounting")):
        return {
            "warn_epsilon": warn_epsilon,
            "max_epsilon": max_epsilon,
            "guardrail_status": "unavailable",
            "guardrail_warnings": [],
        }

    epsilon = privacy_budget.get("epsilon")
    try:
        normalized_epsilon = float(epsilon) if epsilon is not None else None
    except (TypeError, ValueError):
        normalized_epsilon = None
    if normalized_epsilon is None or not math.isfinite(normalized_epsilon):
        return {
            "warn_epsilon": warn_epsilon,
            "max_epsilon": max_epsilon,
            "guardrail_status": "unavailable",
            "guardrail_warnings": [],
        }

    warnings: list[str] = []
    status = "not_configured"
    if warn_epsilon is not None and normalized_epsilon >= warn_epsilon:
        status = "warning"
        warnings.append("epsilon_warn_threshold_reached")
    elif warn_epsilon is not None:
        status = "ok"
    if max_epsilon is not None and normalized_epsilon >= max_epsilon:
        status = "blocked"
        warnings.append("epsilon_max_threshold_exceeded")
    elif status == "not_configured" and max_epsilon is not None:
        status = "ok"

    return {
        "warn_epsilon": warn_epsilon,
        "max_epsilon": max_epsilon,
        "guardrail_status": status,
        "guardrail_warnings": warnings,
    }


def _normalize_federated_dp_site_budget(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "site_id": str(record.get("site_id") or "unknown").strip() or "unknown",
        "accounted_updates": max(0, int(record.get("accounted_updates") or 0)),
        "accounted_aggregations": max(0, int(record.get("accounted_aggregations") or 0)),
        "epsilon": float(record.get("epsilon") or 0.0),
        "delta": float(record.get("delta") or 0.0),
    }


def _normalize_federated_dp_budget_snapshot(record: dict[str, Any] | None) -> dict[str, Any]:
    normalized = _federated_dp_budget_template()
    if not isinstance(record, dict):
        return normalized
    normalized["formal_dp_accounting"] = bool(record.get("formal_dp_accounting"))
    normalized["accountant"] = str(record.get("accountant") or "").strip() or None
    normalized["accountant_scope"] = str(record.get("accountant_scope") or "").strip() or None
    normalized["subsampling_applied"] = bool(record.get("subsampling_applied"))
    normalized["assumptions"] = sorted(
        {
            str(item or "").strip()
            for item in list(record.get("assumptions") or [])
            if str(item or "").strip()
        }
    )
    normalized["accounted_updates"] = max(0, int(record.get("accounted_updates") or 0))
    normalized["accounted_aggregations"] = max(0, int(record.get("accounted_aggregations") or 0))
    normalized["epsilon"] = (
        float(record.get("epsilon") or 0.0)
        if normalized["formal_dp_accounting"]
        else None
    )
    normalized["delta"] = (
        float(record.get("delta") or 0.0)
        if normalized["formal_dp_accounting"]
        else None
    )
    normalized["sampling_rate"] = (
        float(record.get("sampling_rate") or 0.0)
        if normalized["formal_dp_accounting"] and record.get("sampling_rate") is not None
        else None
    )
    normalized["target_delta"] = (
        float(record.get("target_delta") or 0.0)
        if normalized["formal_dp_accounting"] and record.get("target_delta") is not None
        else float(record.get("delta") or 0.0)
        if normalized["formal_dp_accounting"] and record.get("delta") is not None
        else None
    )
    normalized["aggregated_participant_count"] = (
        max(0, int(record.get("aggregated_participant_count") or 0))
        if normalized["formal_dp_accounting"] and record.get("aggregated_participant_count") is not None
        else None
    )
    normalized["available_participant_count"] = (
        max(0, int(record.get("available_participant_count") or 0))
        if normalized["formal_dp_accounting"] and record.get("available_participant_count") is not None
        else None
    )
    normalized["sites"] = sorted(
        [
            _normalize_federated_dp_site_budget(item)
            for item in list(record.get("sites") or [])
            if isinstance(item, dict)
        ],
        key=lambda item: item["site_id"],
    )
    normalized["accounted_sites"] = len(normalized["sites"])
    for key in (
        "last_accounted_aggregation_id",
        "last_accounted_at",
        "last_accounted_new_version_name",
        "last_accounted_base_model_version_id",
    ):
        normalized[key] = str(record.get(key) or "").strip() or None
    participation_summary = record.get("last_participation_summary")
    normalized["last_participation_summary"] = (
        build_federated_participation_summary(
            aggregated_site_ids=list((participation_summary or {}).get("aggregated_site_ids") or []),
            available_site_ids=list((participation_summary or {}).get("available_site_ids") or []),
        )
        if isinstance(participation_summary, dict)
        else None
    )
    if isinstance(normalized["last_participation_summary"], dict):
        participation_summary_record = dict(normalized["last_participation_summary"] or {})
        if normalized["sampling_rate"] is None and participation_summary_record.get("participation_rate") is not None:
            normalized["sampling_rate"] = float(participation_summary_record.get("participation_rate") or 0.0)
        if (
            normalized["aggregated_participant_count"] is None
            and participation_summary_record.get("aggregated_site_count") is not None
        ):
            normalized["aggregated_participant_count"] = max(
                0,
                int(participation_summary_record.get("aggregated_site_count") or 0),
            )
        if (
            normalized["available_participant_count"] is None
            and participation_summary_record.get("available_site_count") is not None
        ):
            normalized["available_participant_count"] = max(
                0,
                int(participation_summary_record.get("available_site_count") or 0),
            )
    if not normalized["formal_dp_accounting"]:
        normalized["accountant"] = None
        normalized["accountant_scope"] = None
        normalized["subsampling_applied"] = False
        normalized["assumptions"] = []
        normalized["accounted_updates"] = 0
        normalized["accounted_aggregations"] = 0
        normalized["accounted_sites"] = 0
        normalized["epsilon"] = None
        normalized["delta"] = None
        normalized["sampling_rate"] = None
        normalized["target_delta"] = None
        normalized["aggregated_participant_count"] = None
        normalized["available_participant_count"] = None
        normalized["sites"] = []
        normalized["last_participation_summary"] = None
    normalized.update(evaluate_federated_dp_budget_guardrail(normalized))
    return normalized


def accumulate_federated_dp_budget(
    prior_budget: dict[str, Any] | None,
    current_summary: dict[str, Any] | None,
    *,
    aggregation_id: str | None = None,
    created_at: str | None = None,
    new_version_name: str | None = None,
    base_model_version_id: str | None = None,
    participation_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    previous = _normalize_federated_dp_budget_snapshot(prior_budget)
    current = dict(current_summary or {})
    if not current.get("formal_dp_accounting"):
        return previous

    merged_sites: dict[str, dict[str, Any]] = {
        item["site_id"]: dict(item)
        for item in previous["sites"]
        if isinstance(item, dict)
    }
    current_sites = [
        _normalize_federated_dp_site_budget(item)
        for item in list(current.get("sites") or [])
        if isinstance(item, dict)
    ]
    for site_entry in current_sites:
        existing = merged_sites.get(site_entry["site_id"]) or {
            "site_id": site_entry["site_id"],
            "accounted_updates": 0,
            "accounted_aggregations": 0,
            "epsilon": 0.0,
            "delta": 0.0,
        }
        existing["accounted_updates"] = int(existing.get("accounted_updates") or 0) + int(site_entry["accounted_updates"] or 0)
        existing["accounted_aggregations"] = int(existing.get("accounted_aggregations") or 0) + 1
        existing["epsilon"] = float(existing.get("epsilon") or 0.0) + float(site_entry["epsilon"] or 0.0)
        existing["delta"] = float(existing.get("delta") or 0.0) + float(site_entry["delta"] or 0.0)
        merged_sites[site_entry["site_id"]] = existing

    normalized_accountant = str(current.get("accountant") or "").strip() or previous.get("accountant")
    return {
        "formal_dp_accounting": True,
        "accountant": normalized_accountant or None,
        "accountant_scope": str(current.get("accountant_scope") or "").strip()
        or previous.get("accountant_scope"),
        "subsampling_applied": bool(current.get("subsampling_applied") or previous.get("subsampling_applied")),
        "assumptions": sorted(
            {
                str(item or "").strip()
                for item in (
                    list(previous.get("assumptions") or [])
                    + list(current.get("assumptions") or [])
                )
                if str(item or "").strip()
            }
        ),
        "accounted_updates": int(previous.get("accounted_updates") or 0) + max(0, int(current.get("accounted_updates") or 0)),
        "accounted_aggregations": int(previous.get("accounted_aggregations") or 0) + 1,
        "accounted_sites": len(merged_sites),
        "epsilon": float(previous.get("epsilon") or 0.0) + float(current.get("epsilon") or 0.0),
        "delta": float(previous.get("delta") or 0.0) + float(current.get("delta") or 0.0),
        "sampling_rate": (
            float(current.get("sampling_rate") or 0.0)
            if current.get("sampling_rate") is not None
            else previous.get("sampling_rate")
        ),
        "target_delta": (
            float(current.get("target_delta") or 0.0)
            if current.get("target_delta") is not None
            else previous.get("target_delta")
        ),
        "aggregated_participant_count": (
            max(0, int(current.get("aggregated_participant_count") or 0))
            if current.get("aggregated_participant_count") is not None
            else previous.get("aggregated_participant_count")
        ),
        "available_participant_count": (
            max(0, int(current.get("available_participant_count") or 0))
            if current.get("available_participant_count") is not None
            else previous.get("available_participant_count")
        ),
        "sites": [merged_sites[key] for key in sorted(merged_sites)],
        "last_accounted_aggregation_id": str(aggregation_id or "").strip() or previous.get("last_accounted_aggregation_id"),
        "last_accounted_at": str(created_at or "").strip() or previous.get("last_accounted_at"),
        "last_accounted_new_version_name": str(new_version_name or "").strip() or previous.get("last_accounted_new_version_name"),
        "last_accounted_base_model_version_id": str(base_model_version_id or "").strip()
        or previous.get("last_accounted_base_model_version_id"),
        "last_participation_summary": (
            build_federated_participation_summary(
                aggregated_site_ids=list((participation_summary or {}).get("aggregated_site_ids") or []),
                available_site_ids=list((participation_summary or {}).get("available_site_ids") or []),
            )
            if isinstance(participation_summary, dict)
            else previous.get("last_participation_summary")
        ),
        **evaluate_federated_dp_budget_guardrail(
            {
                "formal_dp_accounting": True,
                "epsilon": float(previous.get("epsilon") or 0.0) + float(current.get("epsilon") or 0.0),
            }
        ),
    }


def latest_federated_dp_budget_snapshot(records: list[dict[str, Any]]) -> dict[str, Any]:
    snapshots: list[dict[str, Any]] = [dict(item) for item in records if isinstance(item, dict)]
    direct_budget = next(
        (
            _normalize_federated_dp_budget_snapshot(dict(item.get("dp_budget") or {}))
            for item in snapshots
            if isinstance(item.get("dp_budget"), dict)
        ),
        None,
    )
    if direct_budget is not None and (
        direct_budget.get("formal_dp_accounting")
        or direct_budget.get("accounted_aggregations")
    ):
        return direct_budget

    budget = _federated_dp_budget_template()
    ordered = sorted(
        snapshots,
        key=lambda item: (
            str(item.get("created_at") or "").strip(),
            str(item.get("aggregation_id") or "").strip(),
        ),
    )
    for item in ordered:
        budget = accumulate_federated_dp_budget(
            budget,
            dict(item.get("dp_accounting") or {}),
            aggregation_id=str(item.get("aggregation_id") or "").strip() or None,
            created_at=str(item.get("created_at") or "").strip() or None,
            new_version_name=str(item.get("new_version_name") or "").strip() or None,
            base_model_version_id=str(item.get("base_model_version_id") or "").strip() or None,
            participation_summary=dict(item.get("participation_summary") or {}),
        )
    return budget


def federated_privacy_runtime_report() -> dict[str, Any]:
    formal_dp_enabled = formal_dp_accounting_available()
    production_like_runtime = _runtime_environment_is_production_like()
    formal_dp_required = require_formal_dp_accounting()
    non_dp_acknowledged = acknowledge_non_dp_federated_training()
    secure_aggregation_required = require_secure_aggregation()
    secure_aggregation_enabled = secure_aggregation_available()
    signed_updates_required = signed_federated_updates_runtime_required()
    signed_updates_ready = signed_federated_updates_runtime_ready()
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
        "require_signed_federated_updates": require_signed_federated_updates(),
        "signed_updates_required": signed_updates_required,
        "signed_updates_ready": signed_updates_ready,
        "signing_secret_configured": signing_secret_configured(),
        "warning_required": warning_required,
        "dp_accountant_delta": federated_dp_accountant_delta(),
        "dp_accountant_mode": federated_dp_accountant_mode(),
        "dp_warn_epsilon": federated_dp_warn_epsilon(),
        "dp_max_epsilon": federated_dp_max_epsilon(),
        "privacy_controls": federated_delta_privacy_controls(),
    }


def build_federated_privacy_report_limitations(privacy_budget: dict[str, Any] | None) -> list[str]:
    if not isinstance(privacy_budget, dict):
        return ["privacy_budget_unavailable"]

    limitations: list[str] = []
    if not bool(privacy_budget.get("formal_dp_accounting")):
        limitations.append("formal_dp_accounting_unavailable")
        return limitations

    if not bool(privacy_budget.get("subsampling_applied")):
        limitations.append("full_participation_bound_used")
    if not secure_aggregation_available():
        limitations.append("no_secure_aggregation")
    if str(privacy_budget.get("accountant") or "").strip() != "gaussian_prv_subsampled":
        limitations.append("prv_accountant_not_enabled")
    return limitations


def assert_federated_privacy_runtime_ready(*, operation: str) -> None:
    report = federated_privacy_runtime_report()
    if report["signed_updates_required"] and not report["signed_updates_ready"]:
        raise FederatedPrivacyRuntimePolicyError(
            f"{operation} is blocked until signed federated updates are enforced in this runtime. "
            "Set KERA_REQUIRE_SIGNED_FEDERATED_UPDATES=true and configure "
            "KERA_FEDERATED_UPDATE_SIGNING_SECRET before running federated learning or aggregation.",
            status_code=409,
        )
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
