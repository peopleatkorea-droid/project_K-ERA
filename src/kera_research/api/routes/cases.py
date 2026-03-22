from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from kera_research.api.routes.case_analysis import build_case_analysis_router
from kera_research.api.routes.case_images import build_case_images_router
from kera_research.api.routes.case_records import build_case_records_router


def build_cases_router(support: Any) -> APIRouter:
    router = APIRouter()
    router.include_router(build_case_records_router(support))
    router.include_router(build_case_images_router(support))
    router.include_router(build_case_analysis_router(support))
    return router
