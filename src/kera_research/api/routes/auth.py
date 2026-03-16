from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status


def build_auth_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_current_user = support.get_current_user
    local_login_enabled = support.local_login_enabled
    verify_google_id_token = support.verify_google_id_token
    build_auth_response = support.build_auth_response
    LoginRequest = support.LoginRequest
    GoogleLoginRequest = support.GoogleLoginRequest
    AccessRequestCreateRequest = support.AccessRequestCreateRequest

    @router.get("/api/public/sites")
    def public_sites(cp=Depends(get_control_plane)) -> list[dict[str, Any]]:
        return cp.list_sites()

    @router.get("/api/public/institutions/search")
    def public_institution_search(
        q: str = "",
        sido_code: str | None = None,
        sggu_code: str | None = None,
        limit: int = 12,
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        return cp.list_institutions(
            search=q,
            sido_code=sido_code,
            sggu_code=sggu_code,
            limit=limit,
        )

    @router.get("/api/public/statistics")
    def public_statistics(cp=Depends(get_control_plane)) -> dict[str, Any]:
        return cp.get_public_statistics()

    @router.post("/api/auth/login")
    def login(payload: LoginRequest, cp=Depends(get_control_plane)) -> dict[str, Any]:
        if not local_login_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Local username/password login is disabled. Use Google sign-in.",
            )
        user = cp.authenticate(payload.username.strip().lower(), payload.password)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
        if user.get("role") != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Local username/password login is restricted to platform admins. Use Google sign-in.",
            )
        return build_auth_response(cp, user)

    @router.post("/api/auth/google")
    def google_login(payload: GoogleLoginRequest, cp=Depends(get_control_plane)) -> dict[str, Any]:
        identity = verify_google_id_token(payload.id_token)
        try:
            user = cp.ensure_google_user(identity["google_sub"], identity["email"], identity["name"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        return build_auth_response(cp, user)

    @router.get("/api/auth/me")
    def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        return user

    @router.get("/api/auth/access-requests")
    def my_access_requests(
        user: dict[str, Any] = Depends(get_current_user),
        cp=Depends(get_control_plane),
    ) -> list[dict[str, Any]]:
        return cp.list_access_requests(user_id=user["user_id"])

    @router.post("/api/auth/request-access")
    def request_access(
        payload: AccessRequestCreateRequest,
        user: dict[str, Any] = Depends(get_current_user),
        cp=Depends(get_control_plane),
    ) -> dict[str, Any]:
        if payload.requested_role not in {"site_admin", "researcher", "viewer"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid requested role.")
        requested_site_id = payload.requested_site_id.strip()
        if not requested_site_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested institution is required.")

        requested_site = next((item for item in cp.list_sites() if item["site_id"] == requested_site_id), None)
        requested_institution = cp.get_institution(requested_site_id)
        if requested_site is None and requested_institution is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        requested_site_label = (
            payload.requested_site_label.strip()
            or str(requested_site.get("display_name") if requested_site is not None else requested_institution.get("name"))
        )
        requested_site_source = "site" if requested_site is not None else "institution_directory"
        request_record = cp.submit_access_request(
            user_id=user["user_id"],
            requested_site_id=requested_site_id,
            requested_role=payload.requested_role,
            message=payload.message,
            requested_site_label=requested_site_label,
            requested_site_source=requested_site_source,
        )
        refreshed_user = cp.get_user_by_id(user["user_id"]) or user
        return {
            "request": request_record,
            "auth_state": refreshed_user.get("approval_status", "application_required"),
            "user": refreshed_user,
        }

    return router
