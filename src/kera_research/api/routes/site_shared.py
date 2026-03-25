from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel

from kera_research.services.data_plane import SiteStore


class ResearchRegistrySettingsRequest(BaseModel):
    research_registry_enabled: bool


class ResearchRegistryConsentRequest(BaseModel):
    version: str = "v1"


def assert_site_access_only(
    user: dict[str, Any],
    site_id: str,
    *,
    user_can_access_site: Any,
) -> None:
    if not user_can_access_site(user, site_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this site.")


def build_site_summary_counts(site_store: SiteStore, site_id: str) -> dict[str, int | str]:
    stats = site_store.site_summary_stats()
    return {
        "site_id": site_id,
        "n_patients": stats["n_patients"],
        "n_visits": stats["n_visits"],
        "n_images": stats["n_images"],
        "n_active_visits": stats["n_active_visits"],
    }


def build_local_summary(site_store: SiteStore, site_id: str) -> dict[str, Any]:
    stats = site_store.site_summary_stats()
    summary = {
        "site_id": site_id,
        "n_patients": stats["n_patients"],
        "n_visits": stats["n_visits"],
        "n_images": stats["n_images"],
        "n_active_visits": stats["n_active_visits"],
    }
    return {
        **summary,
        "n_validation_runs": 0,
        "latest_validation": None,
        "research_registry": {
            "site_enabled": False,
            "user_enrolled": False,
            "user_enrolled_at": None,
            "included_cases": stats["n_included_visits"],
            "excluded_cases": stats["n_excluded_visits"],
        },
    }
