from typing import Any

from fastapi import APIRouter

from kera_research.api.routes.admin_access import build_admin_access_router
from kera_research.api.routes.admin_management import build_admin_management_router
from kera_research.api.routes.admin_registry import build_admin_registry_router


def build_admin_router(support: Any) -> APIRouter:
    router = APIRouter()
    router.include_router(build_admin_access_router(support))
    router.include_router(build_admin_registry_router(support))
    router.include_router(build_admin_management_router(support))
    return router
