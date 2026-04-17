from kera_research.api.case_model_versions import (
    resolve_requested_compare_model_versions,
    resolve_requested_model_version,
)


class _DummyControlPlane:
    def __init__(self, versions):
        self._versions = list(versions)

    def list_model_versions(self):
        return list(self._versions)

    def ensure_model_version(self, record):
        return record


def _get_model_version(cp, version_id):
    return next(
        (
            item
            for item in cp.list_model_versions()
            if str(item.get("version_id") or "").strip() == str(version_id or "").strip()
        ),
        None,
    )


def test_single_case_review_profile_prefers_convnext_tiny_over_operating_mil():
    cp = _DummyControlPlane(
        [
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_p101_fold01",
                "version_name": "global-efficientnet-v2-s-mil-full-p101-fold01",
                "architecture": "efficientnet_v2_s_mil",
                "bag_level": True,
                "is_current": True,
                "ready": True,
                "created_at": "2026-04-17T00:00:00Z",
            },
            {
                "version_id": "model_global_convnext_tiny_full_p101_fold01",
                "version_name": "global-convnext-tiny-full-p101-fold01",
                "architecture": "convnext_tiny",
                "bag_level": False,
                "ready": True,
                "created_at": "2026-04-16T00:00:00Z",
            },
            {
                "version_id": "model_global_dinov2_baseline",
                "version_name": "global-dinov2-baseline-v0.1",
                "architecture": "dinov2",
                "bag_level": False,
                "ready": True,
                "created_at": "2026-04-15T00:00:00Z",
            },
        ]
    )

    resolved = resolve_requested_model_version(
        cp,
        get_model_version=_get_model_version,
        model_version_id=None,
        model_version_ids=[],
        selection_profile="single_case_review",
    )

    assert resolved is not None
    assert resolved["version_id"] == "model_global_convnext_tiny_full_p101_fold01"


def test_visit_level_review_profile_prefers_efficient_mil_when_compare_ids_are_empty():
    cp = _DummyControlPlane(
        [
            {
                "version_id": "model_global_convnext_tiny_full_p101_fold01",
                "version_name": "global-convnext-tiny-full-p101-fold01",
                "architecture": "convnext_tiny",
                "bag_level": False,
                "ready": True,
                "created_at": "2026-04-16T00:00:00Z",
            },
            {
                "version_id": "model_global_efficientnet_v2_s_mil_full_p101_fold01",
                "version_name": "global-efficientnet-v2-s-mil-full-p101-fold01",
                "architecture": "efficientnet_v2_s_mil",
                "bag_level": True,
                "ready": True,
                "created_at": "2026-04-17T00:00:00Z",
            },
        ]
    )

    resolved = resolve_requested_compare_model_versions(
        cp,
        model_version_ids=[],
        selection_profile="visit_level_review",
    )

    assert [item["version_id"] for item in resolved] == [
        "model_global_efficientnet_v2_s_mil_full_p101_fold01"
    ]
