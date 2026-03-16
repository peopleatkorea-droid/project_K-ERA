from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kera_research.services.data_plane import SiteStore

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchEmbeddingWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def rebuild_case_vector_index(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
    ) -> dict[str, Any]:
        service = self.service
        return service.vector_index.rebuild_index(
            site_store,
            model_version_id=str(model_version.get("version_id") or "unknown"),
            backend=backend,
        )

    def case_vector_index_exists(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str,
    ) -> bool:
        service = self.service
        return service.vector_index.index_exists(
            site_store,
            model_version_id=str(model_version.get("version_id") or "unknown"),
            backend=backend,
        )

    def list_cases_requiring_embedding(
        self,
        site_store: SiteStore,
        *,
        model_version: dict[str, Any],
        backend: str = "classifier",
    ) -> list[dict[str, Any]]:
        service = self.service
        records_by_case: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in site_store.dataset_records():
            patient_id = str(record.get("patient_id") or "")
            visit_date = str(record.get("visit_date") or "")
            if not patient_id or not visit_date:
                continue
            records_by_case.setdefault((patient_id, visit_date), []).append(record)

        missing_cases: list[dict[str, Any]] = []
        for summary in site_store.list_case_summaries():
            patient_id = str(summary.get("patient_id") or "")
            visit_date = str(summary.get("visit_date") or "")
            case_records = records_by_case.get((patient_id, visit_date), [])
            if not case_records:
                continue
            signature = service._case_embedding_signature(case_records, model_version, backend=backend)
            cached = service._load_cached_case_embedding(
                site_store,
                patient_id=patient_id,
                visit_date=visit_date,
                model_version=model_version,
                signature=signature,
                backend=backend,
            )
            if cached is None:
                missing_cases.append(summary)
        return missing_cases

    def index_case_embedding(
        self,
        site_store: SiteStore,
        *,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        force_refresh: bool = False,
        update_index: bool = True,
    ) -> dict[str, Any]:
        service = self.service
        case_records = [
            item
            for item in site_store.dataset_records()
            if str(item.get("patient_id") or "") == patient_id
            and str(item.get("visit_date") or "") == visit_date
        ]
        if not case_records:
            raise ValueError("Selected case is not available for embedding indexing.")
        classifier_embedding = service._prepare_case_embedding(
            site_store,
            case_records,
            model_version,
            execution_device,
            force_refresh=force_refresh,
        )
        available_backends = ["classifier"]
        embedding_dims = {"classifier": int(classifier_embedding.size)}
        dinov2_error: str | None = None
        try:
            dinov2_embedding = service._prepare_case_dinov2_embedding(
                site_store,
                case_records,
                model_version,
                execution_device,
                force_refresh=force_refresh,
            )
            available_backends.append("dinov2")
            embedding_dims["dinov2"] = int(dinov2_embedding.size)
        except Exception as exc:
            dinov2_error = str(exc)
        vector_index: dict[str, Any] | None = None
        vector_index_error: str | None = None
        if update_index:
            try:
                vector_index = {
                    "classifier": self.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="classifier",
                    )
                }
                if "dinov2" in available_backends:
                    vector_index["dinov2"] = self.rebuild_case_vector_index(
                        site_store,
                        model_version=model_version,
                        backend="dinov2",
                    )
            except Exception as exc:
                vector_index_error = str(exc)
        return {
            "case_id": f"{patient_id}::{visit_date}",
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_id": model_version.get("version_id"),
            "model_version_name": model_version.get("version_name"),
            "embedding_dim": int(classifier_embedding.size),
            "embedding_dims": embedding_dims,
            "available_backends": available_backends,
            "dinov2_error": dinov2_error,
            "vector_index": vector_index,
            "vector_index_error": vector_index_error,
            "execution_device": execution_device,
            "status": "refreshed" if force_refresh else "cached",
        }
