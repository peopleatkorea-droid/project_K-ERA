from typing import Any

FIXED_PROJECT_ID = "project_default"
FIXED_PROJECT_NAME = "Default Workspace"
FIXED_RESEARCHER_ROLE = "researcher"


def resolve_fixed_project(cp: Any, owner_user_id: str | None = None) -> dict[str, Any]:
    owner_id = str(owner_user_id or "").strip() or "system"
    projects = cp.list_projects()
    fixed_project = next((project for project in projects if project.get("project_id") == FIXED_PROJECT_ID), None)
    if fixed_project is not None:
        return cp.ensure_project(
            str(fixed_project.get("project_id") or FIXED_PROJECT_ID).strip() or FIXED_PROJECT_ID,
            name=str(fixed_project.get("name") or FIXED_PROJECT_NAME).strip() or FIXED_PROJECT_NAME,
            description=str(fixed_project.get("description") or "").strip(),
            owner_user_id=str(fixed_project.get("owner_user_id") or owner_id).strip() or owner_id,
            site_ids=list(fixed_project.get("site_ids") or []),
            created_at=str(fixed_project.get("created_at") or "").strip() or None,
            create_if_missing=True,
        )
    if projects:
        project = projects[0]
        return cp.ensure_project(
            str(project.get("project_id") or FIXED_PROJECT_ID).strip() or FIXED_PROJECT_ID,
            name=str(project.get("name") or FIXED_PROJECT_NAME).strip() or FIXED_PROJECT_NAME,
            description=str(project.get("description") or "").strip(),
            owner_user_id=str(project.get("owner_user_id") or owner_id).strip() or owner_id,
            site_ids=list(project.get("site_ids") or []),
            created_at=str(project.get("created_at") or "").strip() or None,
            create_if_missing=True,
        )
    return cp.ensure_project(
        FIXED_PROJECT_ID,
        name=FIXED_PROJECT_NAME,
        description="",
        owner_user_id=owner_id,
        create_if_missing=True,
    )
