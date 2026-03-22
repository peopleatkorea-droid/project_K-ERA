from __future__ import annotations

from typing import Any

FIXED_PROJECT_ID = "project_default"
FIXED_PROJECT_NAME = "Default Workspace"
FIXED_RESEARCHER_ROLE = "researcher"


def resolve_fixed_project(cp: Any, owner_user_id: str | None = None) -> dict[str, Any]:
    projects = cp.list_projects()
    fixed_project = next((project for project in projects if project.get("project_id") == FIXED_PROJECT_ID), None)
    if fixed_project is not None:
        return fixed_project
    if projects:
        return projects[0]
    return cp.create_project(FIXED_PROJECT_NAME, "", str(owner_user_id or "").strip() or "system")
