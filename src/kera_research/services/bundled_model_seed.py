from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def bundled_model_reference() -> dict[str, Any] | None:
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
    bundled_reference = bundled_model_reference()
    if bundled_reference is None:
        return None
    version_id = str(model_reference.get("version_id") or "").strip()
    bundled_version_id = str(bundled_reference.get("version_id") or "").strip()
    if not version_id or version_id != bundled_version_id:
        return None
    return {
        **dict(model_reference),
        "model_path": bundled_reference["model_path"],
        "local_path": bundled_reference["local_path"],
        "filename": bundled_reference.get("filename") or model_reference.get("filename"),
        "source_provider": bundled_reference.get("source_provider") or model_reference.get("source_provider"),
    }


def ensure_bundled_current_model(store: Any) -> dict[str, Any] | None:
    local_current = store.registry.current_global_model()
    if isinstance(local_current, dict) and local_current:
        bundled_reference = bundled_model_reference()
        merged = reference_matches_bundled_seed(local_current)
        if merged is not None:
            return store.registry.ensure_model_version(merged)
        return local_current

    bundled_reference = bundled_model_reference()
    if bundled_reference is None:
        return None

    return store.registry.ensure_model_version(bundled_reference)
