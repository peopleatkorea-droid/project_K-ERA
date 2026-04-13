from __future__ import annotations

import ast
from typing import Any

import pandas as pd

from kera_research.domain import LABEL_TO_INDEX


def _normalize_organism_entry(entry: dict[str, Any] | None) -> dict[str, str] | None:
    if not isinstance(entry, dict):
        return None
    category = str(entry.get("culture_category", "")).strip().lower()
    species = str(entry.get("culture_species", "")).strip()
    if not category or not species:
        return None
    return {
        "culture_category": category,
        "culture_species": species,
    }


def _normalize_additional_organisms(
    primary_category: str,
    primary_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    primary_key = f"{primary_category.strip().lower()}::{primary_species.strip().lower()}"
    normalized: list[dict[str, str]] = []
    seen = {primary_key}
    for raw_entry in additional_organisms or []:
        entry = _normalize_organism_entry(raw_entry)
        if entry is None:
            continue
        entry_key = f"{entry['culture_category']}::{entry['culture_species'].lower()}"
        if entry_key in seen:
            continue
        seen.add(entry_key)
        normalized.append(entry)
    return normalized


def _normalize_culture_status(
    value: Any,
    culture_status_options: set[str],
    default: str = "unknown",
) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in culture_status_options:
        return normalized
    return default


def _coerce_optional_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    return str(value).strip()


def _coerce_optional_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, float) and pd.isna(value):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _coerce_optional_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and pd.isna(value):
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return default


def _derive_culture_status(
    culture_status: Any,
    culture_confirmed: Any,
    culture_category: Any,
    culture_species: Any,
    culture_status_options: set[str],
) -> str:
    normalized_status = _normalize_culture_status(
        culture_status,
        culture_status_options,
        default="",
    )
    if normalized_status:
        return normalized_status
    if _coerce_optional_bool(culture_confirmed, False):
        return "positive"
    if str(culture_category or "").strip() or str(culture_species or "").strip():
        return "positive"
    return "unknown"


def _normalize_visit_culture_fields(
    *,
    culture_status: Any,
    culture_confirmed: Any,
    culture_category: Any,
    culture_species: Any,
    additional_organisms: list[dict[str, Any]] | None,
    polymicrobial: Any,
    culture_status_options: set[str],
) -> dict[str, Any]:
    normalized_status = _derive_culture_status(
        culture_status,
        culture_confirmed,
        culture_category,
        culture_species,
        culture_status_options,
    )
    if normalized_status == "positive":
        normalized_category = str(culture_category or "").strip().lower()
        normalized_species = str(culture_species or "").strip()
        if LABEL_TO_INDEX.get(normalized_category, -1) == -1:
            raise ValueError("Positive culture cases require a bacterial or fungal category.")
        if not normalized_species:
            raise ValueError("Positive culture cases require a primary organism.")
        normalized_additional_organisms = _normalize_additional_organisms(
            normalized_category,
            normalized_species,
            additional_organisms,
        )
        normalized_polymicrobial = bool(polymicrobial or normalized_additional_organisms)
    else:
        normalized_category = ""
        normalized_species = ""
        normalized_additional_organisms = []
        normalized_polymicrobial = False
    return {
        "culture_status": normalized_status,
        "culture_confirmed": normalized_status == "positive",
        "culture_category": normalized_category,
        "culture_species": normalized_species,
        "additional_organisms": normalized_additional_organisms,
        "polymicrobial": normalized_polymicrobial,
    }


def _hydrate_visit_culture_fields(
    record: dict[str, Any],
    culture_status_options: set[str],
) -> dict[str, Any]:
    normalized = dict(record)
    culture_fields = _normalize_visit_culture_fields(
        culture_status=normalized.get("culture_status"),
        culture_confirmed=normalized.get("culture_confirmed"),
        culture_category=normalized.get("culture_category"),
        culture_species=normalized.get("culture_species"),
        additional_organisms=list(normalized.get("additional_organisms") or []),
        polymicrobial=normalized.get("polymicrobial"),
        culture_status_options=culture_status_options,
    )
    normalized.update(culture_fields)
    scopes = normalized.get("fl_retention_scopes")
    if not isinstance(scopes, list):
        scopes = []
    normalized["fl_retention_scopes"] = [str(item or "").strip() for item in scopes if str(item or "").strip()]
    normalized["fl_retained"] = bool(normalized.get("fl_retained"))
    return normalized


def _list_organisms(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    primary_species = str(culture_species or "").strip()
    normalized_additional = _normalize_additional_organisms(
        culture_category,
        culture_species,
        additional_organisms,
    )
    if not primary_species:
        return normalized_additional
    return [
        {
            "culture_category": str(culture_category or "").strip().lower(),
            "culture_species": primary_species,
        },
        *normalized_additional,
    ]


def _organism_summary_label(
    culture_category: str,
    culture_species: str,
    additional_organisms: list[dict[str, Any]] | None,
    *,
    max_visible_species: int = 2,
) -> str:
    organisms = _list_organisms(culture_category, culture_species, additional_organisms)
    if not organisms:
        return ""
    visible_count = max(1, int(max_visible_species or 1))
    if len(organisms) <= visible_count:
        return " / ".join(item["culture_species"] for item in organisms)
    visible = " / ".join(item["culture_species"] for item in organisms[:visible_count])
    return f"{visible} + {len(organisms) - visible_count}"


def _parse_manifest_pipe_list(value: Any) -> list[str]:
    raw = _coerce_optional_text(value)
    return [item.strip() for item in raw.split("|") if item.strip()]


def _parse_manifest_box(value: Any) -> dict[str, float] | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, dict):
        candidate = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        try:
            candidate = ast.literal_eval(raw)
        except (SyntaxError, ValueError):
            return None
    if not isinstance(candidate, dict):
        return None
    try:
        x0 = float(candidate.get("x0"))
        y0 = float(candidate.get("y0"))
        x1 = float(candidate.get("x1"))
        y1 = float(candidate.get("y1"))
    except (TypeError, ValueError):
        return None
    if x1 <= x0 or y1 <= y0:
        return None
    return {
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
    }
