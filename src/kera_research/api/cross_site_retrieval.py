from __future__ import annotations

from typing import Any, Callable


def resolve_cross_site_status_profile(
    *,
    requested_profile_id: str | None,
    requested_profile_label: str | None = None,
    effective_profile_id: str | None = None,
    effective_profile_label: str | None = None,
    cross_site_status: str | None = None,
) -> dict[str, str]:
    requested_id = str(requested_profile_id or "").strip() or "dinov2_lesion_crop"
    requested_label_value = str(requested_profile_label or "").strip() or requested_id
    effective_id = str(effective_profile_id or "").strip()
    effective_label_value = str(effective_profile_label or "").strip() or effective_id
    normalized_status = str(cross_site_status or "").strip().lower()

    status_profile_id = requested_id
    status_profile_label = requested_label_value
    if effective_id and normalized_status != "disabled":
        status_profile_id = effective_id
        status_profile_label = effective_label_value or effective_id

    return {
        "requested_profile_id": requested_id,
        "requested_profile_label": requested_label_value,
        "effective_profile_id": effective_id,
        "effective_profile_label": effective_label_value,
        "status_profile_id": status_profile_id,
        "status_profile_label": status_profile_label or status_profile_id,
    }


def summarize_cross_site_corpus_status(
    corpus_status: dict[str, Any],
    *,
    profile_id: str,
    profile_label: str | None = None,
) -> dict[str, Any]:
    latest_sync = dict(corpus_status.get("latest_sync") or {})
    return {
        "profile_id": profile_id,
        "profile_label": str(profile_label or "").strip() or profile_id,
        "remote_node_sync_enabled": bool(corpus_status.get("remote_node_sync_enabled")),
        "eligible_case_count": int(corpus_status.get("eligible_case_count") or 0),
        "latest_sync": latest_sync or None,
        "active_job": corpus_status.get("active_job"),
    }


def should_queue_cross_site_corpus_sync(
    *,
    candidate_count: int,
    cross_site_status: str | None,
    corpus_status: dict[str, Any],
) -> bool:
    latest_sync = dict(corpus_status.get("latest_sync") or {})
    active_job = corpus_status.get("active_job")
    eligible_case_count = int(corpus_status.get("eligible_case_count") or 0)
    prepared_entry_count = int(latest_sync.get("prepared_entry_count") or 0)
    normalized_status = str(cross_site_status or "").strip().lower()
    needs_remote_recovery = (
        int(candidate_count or 0) == 0
        or normalized_status in {"unavailable", "cache_fallback", "no_query_embedding"}
    )
    return (
        bool(corpus_status.get("remote_node_sync_enabled"))
        and active_job is None
        and eligible_case_count > 0
        and needs_remote_recovery
        and (not latest_sync or prepared_entry_count < eligible_case_count)
    )


def enrich_cross_site_retrieval_details(
    *,
    cp: Any,
    site_store: Any,
    workflow: Any,
    requested_profile_id: str | None,
    requested_profile_label: str | None = None,
    effective_profile_id: str | None = None,
    effective_profile_label: str | None = None,
    cross_site_status: str | None = None,
    candidate_count: int = 0,
    queue_sync: Callable[..., Any] | None = None,
    sync_trigger: str | None = None,
    build_status: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profile_resolution = resolve_cross_site_status_profile(
        requested_profile_id=requested_profile_id,
        requested_profile_label=requested_profile_label,
        effective_profile_id=effective_profile_id,
        effective_profile_label=effective_profile_label,
        cross_site_status=cross_site_status,
    )
    details: dict[str, Any] = {
        "requested_profile_id": profile_resolution["requested_profile_id"],
        "requested_profile_label": profile_resolution["requested_profile_label"],
        "effective_profile_id": profile_resolution["effective_profile_id"],
        "effective_profile_label": profile_resolution["effective_profile_label"],
        "status_profile_id": profile_resolution["status_profile_id"],
        "status_profile_label": profile_resolution["status_profile_label"],
    }
    try:
        build_status_fn = build_status
        if build_status_fn is None:
            from kera_research.api.site_jobs import build_federated_retrieval_corpus_status

            build_status_fn = build_federated_retrieval_corpus_status

        corpus_status = build_status_fn(
            cp,
            site_store,
            retrieval_profile=profile_resolution["status_profile_id"],
            workflow_factory=lambda _cp: workflow,
        )
    except Exception:
        return details

    details["corpus_status"] = summarize_cross_site_corpus_status(
        corpus_status,
        profile_id=profile_resolution["status_profile_id"],
        profile_label=profile_resolution["status_profile_label"],
    )
    if (
        queue_sync is not None
        and sync_trigger
        and should_queue_cross_site_corpus_sync(
            candidate_count=candidate_count,
            cross_site_status=cross_site_status,
            corpus_status=corpus_status,
        )
    ):
        try:
            opportunistic_sync = queue_sync(
                cp,
                site_store,
                trigger=sync_trigger,
                retrieval_profile=profile_resolution["status_profile_id"],
            )
        except Exception:
            opportunistic_sync = None
        if opportunistic_sync is not None:
            details["opportunistic_sync"] = opportunistic_sync

    return details
