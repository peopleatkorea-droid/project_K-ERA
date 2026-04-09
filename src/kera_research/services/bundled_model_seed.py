from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from kera_research.config import DEFAULT_GLOBAL_MODELS


def _baseline_fallback_version_ids() -> set[str]:
    return {
        str(item.get("version_id") or "").strip()
        for item in DEFAULT_GLOBAL_MODELS
        if str(item.get("version_id") or "").strip()
    }


def bundled_model_suite() -> list[dict[str, Any]]:
    resource_dir_raw = str(os.getenv("KERA_DESKTOP_RESOURCE_DIR") or "").strip()
    if not resource_dir_raw:
        return []

    resource_dir = Path(resource_dir_raw).expanduser().resolve()
    suite_path = resource_dir / "seed-model" / "model-suite-reference.json"
    if not suite_path.exists():
        return []

    try:
        payload = json.loads(suite_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw_models = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(raw_models, list):
        return []

    models: list[dict[str, Any]] = []
    for raw_model in raw_models:
        if not isinstance(raw_model, dict):
            continue
        entry = dict(raw_model)
        filename = str(entry.get("filename") or "").strip()
        local_path = None
        if filename:
            candidate_path = (suite_path.parent / filename).resolve()
            if not candidate_path.exists():
                continue
            local_path = str(candidate_path)
            entry["filename"] = filename
            entry["model_path"] = local_path
            entry["local_path"] = local_path
        elif str(entry.get("ensemble_mode") or "").strip() == "weighted_average":
            entry.setdefault("model_path", "")
            entry.setdefault("local_path", "")
        else:
            continue
        entry.setdefault("model_name", "keratitis_cls")
        entry.setdefault("stage", "global")
        entry.setdefault("ready", True)
        entry.setdefault("is_current", False)
        entry.setdefault("source_provider", "bundled")
        models.append(entry)
    return models


def bundled_model_reference() -> dict[str, Any] | None:
    suite = bundled_model_suite()
    if suite:
        current = next((item for item in suite if item.get("is_current")), None)
        if current is not None:
            return current
        return suite[0]

    resource_dir_raw = str(os.getenv("KERA_DESKTOP_RESOURCE_DIR") or "").strip()
    if not resource_dir_raw:
        return None

    resource_dir = Path(resource_dir_raw).expanduser().resolve()
    reference_path = resource_dir / "seed-model" / "model-reference.json"
    if not reference_path.exists():
        return None

    try:
        payload = json.loads(reference_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not payload:
        return None

    filename = str(payload.get("filename") or "").strip()
    if not filename:
        return None

    model_path = (reference_path.parent / filename).resolve()
    if not model_path.exists():
        return None

    reference = dict(payload)
    resolved_model_path = str(model_path)
    reference["filename"] = filename
    reference["model_path"] = resolved_model_path
    reference["local_path"] = resolved_model_path
    reference.setdefault("model_name", "keratitis_cls")
    reference.setdefault("stage", "global")
    reference.setdefault("ready", True)
    reference.setdefault("is_current", True)
    reference.setdefault("source_provider", "bundled")
    return reference


def reference_matches_bundled_seed(model_reference: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(model_reference, dict):
        return None
    version_id = str(model_reference.get("version_id") or "").strip()
    if not version_id:
        return None
    bundled_reference = next(
        (
            item
            for item in bundled_model_suite()
            if str(item.get("version_id") or "").strip() == version_id
        ),
        None,
    )
    if bundled_reference is None:
        bundled_reference = bundled_model_reference()
        bundled_version_id = str(bundled_reference.get("version_id") or "").strip() if bundled_reference else ""
        if bundled_reference is None or version_id != bundled_version_id:
            return None
    return {
        **dict(model_reference),
        "model_path": bundled_reference["model_path"],
        "local_path": bundled_reference["local_path"],
        "filename": bundled_reference.get("filename") or model_reference.get("filename"),
        "source_provider": bundled_reference.get("source_provider") or model_reference.get("source_provider"),
    }


def ensure_bundled_current_model(store: Any) -> dict[str, Any] | None:
    suite = bundled_model_suite()
    baseline_fallback_ids = _baseline_fallback_version_ids()
    if suite:
        local_current = store.registry.current_global_model()
        local_current_id = str(local_current.get("version_id") or "").strip() if isinstance(local_current, dict) else ""
        preserve_existing_current = bool(local_current_id) and local_current_id not in baseline_fallback_ids
        ensured_current: dict[str, Any] | None = None
        for bundled_entry in suite:
            merged = dict(bundled_entry)
            if (
                preserve_existing_current
                and merged.get("is_current")
                and str(merged.get("version_id") or "").strip() != local_current_id
            ):
                merged["is_current"] = False
            ensured = store.registry.ensure_model_version(merged)
            if merged.get("is_current"):
                ensured_current = ensured
        if preserve_existing_current and local_current_id and local_current_id != str((ensured_current or {}).get("version_id") or "").strip():
            return local_current
        return ensured_current or next((item for item in suite if item.get("is_current")), suite[0])

    local_current = store.registry.current_global_model()
    if isinstance(local_current, dict) and local_current:
        bundled_reference = bundled_model_reference()
        merged = reference_matches_bundled_seed(local_current)
        if merged is not None:
            return store.registry.ensure_model_version(merged)
        if str(local_current.get("version_id") or "").strip() not in baseline_fallback_ids:
            return local_current

    bundled_reference = bundled_model_reference()
    if bundled_reference is None:
        return None

    return store.registry.ensure_model_version(bundled_reference)
