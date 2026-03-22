from typing import Any

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, status
from kera_research.api.control_plane_proxy import (
    call_remote_control_plane_method,
    call_remote_public_control_plane_method,
    prefer_local_control_plane,
    remote_control_plane_is_primary,
)

AUTO_APPROVAL_REVIEWER_ID = "system_auto_approve"
AUTO_APPROVAL_REVIEWER_NOTE = "Automatically approved researcher access request."


def build_auth_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_current_user = support.get_current_user
    local_login_enabled = support.local_login_enabled
    local_dev_auth_enabled = support.local_dev_auth_enabled
    verify_google_id_token = support.verify_google_id_token
    build_auth_response = support.build_auth_response
    LoginRequest = support.LoginRequest
    GoogleLoginRequest = support.GoogleLoginRequest
    AccessRequestCreateRequest = support.AccessRequestCreateRequest

    def remote_control_plane_error(exc: Exception, *, fallback_detail: str) -> HTTPException:
        if isinstance(exc, requests.HTTPError) and exc.response is not None:
            detail = fallback_detail
            try:
                payload = exc.response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict):
                remote_detail = payload.get("detail")
                if isinstance(remote_detail, str) and remote_detail.strip():
                    detail = remote_detail.strip()
                elif remote_detail is not None:
                    detail = str(remote_detail)
            if detail == fallback_detail:
                response_text = exc.response.text.strip()
                if response_text:
                    detail = response_text
            return HTTPException(status_code=exc.response.status_code, detail=detail)
        message = str(exc).strip()
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=message or fallback_detail,
        )

    def call_required_remote_public_method(
        *,
        cp: Any,
        control_plane_owner: str | None,
        fallback_detail: str,
        method_name: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        if prefer_local_control_plane(control_plane_owner) or not cp.remote_control_plane_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=fallback_detail,
            )
        try:
            payload = getattr(cp.remote_control_plane, method_name)(**kwargs)
        except Exception as exc:
            raise remote_control_plane_error(exc, fallback_detail=fallback_detail) from exc
        if isinstance(payload, dict):
            return payload
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=fallback_detail,
        )

    @router.get("/api/public/sites")
    def public_sites(
        cp=Depends(get_control_plane),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_sites = call_remote_public_control_plane_method(
            cp,
            control_plane_owner=control_plane_owner,
            method_name="public_sites",
        )
        if remote_sites is not None:
            return remote_sites
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane public sites are unavailable.",
            )
        return cp.list_sites()

    @router.get("/api/public/institutions/search")
    def public_institution_search(
        q: str = "",
        sido_code: str | None = None,
        sggu_code: str | None = None,
        limit: int = 12,
        cp=Depends(get_control_plane),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_results = call_remote_public_control_plane_method(
            cp,
            control_plane_owner=control_plane_owner,
            method_name="public_institutions",
            query=q,
            sido_code=sido_code,
            sggu_code=sggu_code,
            limit=limit,
        )
        if remote_results is not None:
            return remote_results
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane institution search is unavailable.",
            )
        return cp.list_institutions(
            search=q,
            sido_code=sido_code,
            sggu_code=sggu_code,
            limit=limit,
        )

    @router.get("/api/public/statistics")
    def public_statistics(
        cp=Depends(get_control_plane),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        remote_stats = call_remote_public_control_plane_method(
            cp,
            control_plane_owner=control_plane_owner,
            method_name="public_statistics",
        )
        if remote_stats is not None:
            return remote_stats
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane public statistics are unavailable.",
            )
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
        if user.get("role") not in {"admin", "site_admin"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Local username/password login is restricted to admin and site admin accounts. Researchers use Google sign-in.",
            )
        return build_auth_response(cp, user)

    @router.post("/api/auth/dev-login")
    def dev_login(cp=Depends(get_control_plane)) -> dict[str, Any]:
        if not local_dev_auth_enabled():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Local development admin login is disabled.",
            )
        user = cp.get_user_by_username("admin")
        if user is None:
            user = cp.upsert_user(
                {
                    "user_id": "user_admin",
                    "username": "admin",
                    "password": "__google__",
                    "role": "admin",
                    "full_name": "Platform Administrator",
                    "site_ids": [],
                    "registry_consents": {},
                }
            )
        elif user.get("role") != "admin":
            user = cp.upsert_user({**user, "role": "admin"})
        return build_auth_response(cp, user)

    @router.post("/api/auth/google")
    def google_login(payload: GoogleLoginRequest, cp=Depends(get_control_plane)) -> dict[str, Any]:
        identity = verify_google_id_token(payload.id_token)
        try:
            user = cp.ensure_google_user(identity["google_sub"], identity["email"], identity["name"])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        if user.get("role") in {"admin", "site_admin"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin and site admin accounts must use local password sign-in.",
            )
        return build_auth_response(cp, user)

    @router.post("/api/auth/desktop/start")
    def desktop_google_start(
        payload: dict[str, Any],
        cp=Depends(get_control_plane),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        return call_required_remote_public_method(
            cp=cp,
            control_plane_owner=control_plane_owner,
            fallback_detail="Central control plane desktop Google sign-in is unavailable.",
            method_name="main_desktop_auth_start",
            payload_json={
                "redirect_uri": str(payload.get("redirect_uri") or "").strip(),
            },
        )

    @router.post("/api/auth/desktop/exchange")
    def desktop_google_exchange(
        payload: dict[str, Any],
        cp=Depends(get_control_plane),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        return call_required_remote_public_method(
            cp=cp,
            control_plane_owner=control_plane_owner,
            fallback_detail="Central control plane desktop Google authentication is unavailable.",
            method_name="main_desktop_auth_exchange",
            payload_json={
                "code": str(payload.get("code") or "").strip(),
                "flow_token": str(payload.get("flow_token") or "").strip(),
                "redirect_uri": str(payload.get("redirect_uri") or "").strip(),
                "state": str(payload.get("state") or "").strip(),
            },
        )

    @router.get("/api/auth/me")
    def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        return user

    @router.get("/api/auth/access-requests")
    def my_access_requests(
        user: dict[str, Any] = Depends(get_current_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> list[dict[str, Any]]:
        remote_requests = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_access_requests",
        )
        if remote_requests is not None:
            return remote_requests
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane access requests are unavailable.",
            )
        return cp.list_access_requests(user_id=user["user_id"])

    @router.post("/api/auth/request-access")
    def request_access(
        payload: AccessRequestCreateRequest,
        user: dict[str, Any] = Depends(get_current_user),
        cp=Depends(get_control_plane),
        authorization: str | None = Header(default=None),
        control_plane_owner: str | None = Header(default=None, alias="x-kera-control-plane-owner"),
    ) -> dict[str, Any]:
        remote_response = call_remote_control_plane_method(
            cp,
            authorization=authorization,
            control_plane_owner=control_plane_owner,
            method_name="main_request_access",
            payload_json={
                "requested_site_id": payload.requested_site_id,
                "requested_site_label": payload.requested_site_label,
                "requested_role": "researcher",
                "message": payload.message,
            },
        )
        if remote_response is not None:
            return remote_response
        if remote_control_plane_is_primary(cp, control_plane_owner=control_plane_owner):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Central control plane access request submission is unavailable.",
            )
        requested_role = "researcher"
        requested_site_id = payload.requested_site_id.strip()
        if not requested_site_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested institution is required.")

        requested_site = next((item for item in cp.list_sites() if item["site_id"] == requested_site_id), None)
        requested_institution = cp.get_institution(requested_site_id)
        if requested_site is None and requested_institution is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown site.")
        requested_site_label = (
            payload.requested_site_label.strip()
            or (
                cp.site_display_label(requested_site, requested_site_id)
                if requested_site is not None
                else str(requested_institution.get("name") or requested_site_id)
            )
        )
        requested_site_source = "site" if requested_site is not None else "institution_directory"
        request_record = cp.submit_access_request(
            user_id=user["user_id"],
            requested_site_id=requested_site_id,
            requested_role=requested_role,
            message=payload.message,
            requested_site_label=requested_site_label,
            requested_site_source=requested_site_source,
        )
        resolved_site = requested_site or cp.get_site_by_source_institution_id(requested_site_id)
        if resolved_site is not None:
            request_record = cp.review_access_request(
                request_id=request_record["request_id"],
                reviewer_user_id=AUTO_APPROVAL_REVIEWER_ID,
                decision="approved",
                assigned_role=requested_role,
                assigned_site_id=str(resolved_site.get("site_id") or requested_site_id),
                reviewer_notes=AUTO_APPROVAL_REVIEWER_NOTE,
            )
        refreshed_user = cp.get_user_by_id(user["user_id"]) or user
        return {
            "request": request_record,
            "auth_state": refreshed_user.get("approval_status", "application_required"),
            "user": refreshed_user,
        }

    return router
