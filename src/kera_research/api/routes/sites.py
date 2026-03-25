from typing import Any

from fastapi import APIRouter

from kera_research.api.routes.site_imports import build_site_imports_router
from kera_research.api.routes.site_overview import build_site_overview_router
from kera_research.api.routes.site_training import build_site_training_router


def build_sites_router(support: Any) -> APIRouter:
    router = APIRouter()
    router.include_router(build_site_overview_router(support))
    router.include_router(build_site_imports_router(support))
    router.include_router(build_site_training_router(support))
    return router
