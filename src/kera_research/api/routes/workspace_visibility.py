from __future__ import annotations

from typing import Any, Iterable


def workspace_visit_culture_status(visit: dict[str, Any]) -> str:
    normalized_status = str(visit.get("culture_status") or "").strip().lower()
    if normalized_status:
        return normalized_status
    if (
        bool(visit.get("culture_confirmed"))
        or str(visit.get("culture_category") or "").strip()
        or str(visit.get("culture_species") or "").strip()
    ):
        return "positive"
    return "unknown"


def workspace_visit_visible(visit: dict[str, Any]) -> bool:
    source = str(visit.get("research_registry_source") or "").strip().lower()
    return (
        source != "raw_inventory_sync"
        or workspace_visit_culture_status(visit) == "positive"
    )


def filter_visible_workspace_visits(
    visits: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [visit for visit in visits if workspace_visit_visible(visit)]
