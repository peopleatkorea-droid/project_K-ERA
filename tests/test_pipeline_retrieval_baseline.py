from __future__ import annotations

from kera_research.services.pipeline import ResearchWorkflowService


class _FakeTrainingWorkflow:
    def __init__(self) -> None:
        self.calls: list[tuple[object, str, str, int, object]] = []

    def run_retrieval_baseline(
        self,
        site_store: object,
        execution_device: str,
        *,
        crop_mode: str = "automated",
        top_k: int = 10,
        progress_callback: object = None,
    ) -> dict[str, object]:
        self.calls.append((site_store, execution_device, crop_mode, top_k, progress_callback))
        return {
            "ok": True,
            "execution_device": execution_device,
            "crop_mode": crop_mode,
            "top_k": top_k,
        }


def test_research_workflow_service_exposes_retrieval_baseline_runner() -> None:
    workflow = object.__new__(ResearchWorkflowService)
    training_workflow = _FakeTrainingWorkflow()
    workflow.training_workflow = training_workflow

    site_store = object()
    progress_callback = object()

    result = workflow.run_retrieval_baseline(
        site_store,
        "cpu",
        crop_mode="manual",
        top_k=7,
        progress_callback=progress_callback,
    )

    assert result == {
        "ok": True,
        "execution_device": "cpu",
        "crop_mode": "manual",
        "top_k": 7,
    }
    assert training_workflow.calls == [
        (site_store, "cpu", "manual", 7, progress_callback),
    ]
