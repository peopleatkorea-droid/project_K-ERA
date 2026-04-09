from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class DesktopRouteSupport:
    get_control_plane: Any
    google_client_ids: Any
    desktop_self_check: Any
    load_node_credentials: Any
    node_credentials_status: Any
    save_node_credentials: Any
    clear_node_credentials: Any
    database_topology: Any
    remote_node_os_info: Any
    local_control_plane_dev_auth_enabled: Any
    case_reference_salt_fingerprint: Any
    make_id: Any
    get_app_version: Any
    queue_case_embedding_refresh: Any
    queue_ai_clinic_vector_index_rebuild: Any
    queue_federated_retrieval_corpus_sync: Any
    RemoteControlPlaneClient: Any
    LocalControlPlaneNodeRegisterRequest: Any
    LocalControlPlaneNodeCredentialsRequest: Any
    LocalControlPlaneSmokeRequest: Any


@dataclass
class AuthRouteSupport:
    get_control_plane: Any
    get_current_user: Any
    local_login_enabled: Any
    local_dev_auth_enabled: Any
    verify_google_id_token: Any
    build_auth_response: Any
    LoginRequest: Any
    GoogleLoginRequest: Any
    AccessRequestCreateRequest: Any


@dataclass
class AdminRouteSupport:
    get_control_plane: Any
    get_approved_user: Any
    get_workflow: Any
    require_admin_workspace_permission: Any
    require_platform_admin: Any
    require_site_access: Any
    assert_request_review_permission: Any
    visible_model_updates: Any
    is_pending_model_update: Any
    normalize_storage_root: Any
    normalize_default_storage_root: Any
    invalidate_site_storage_root_cache: Any
    embedded_review_artifact_response: Any
    load_approval_report: Any
    site_comparison_rows: Any
    hash_password: Any
    registry_orchestrator: Any
    make_id: Any
    queue_ai_clinic_embedding_backfill: Any
    queue_ai_clinic_vector_index_rebuild: Any
    queue_federated_retrieval_corpus_sync: Any
    case_reference_salt_fingerprint: Any
    AccessRequestReviewRequest: Any
    StorageSettingsUpdateRequest: Any
    ModelUpdateReviewRequest: Any
    ModelVersionPublishRequest: Any
    ModelVersionAutoPublishRequest: Any
    AggregationRunRequest: Any
    ReleaseRolloutRequest: Any
    ProjectCreateRequest: Any
    SiteCreateRequest: Any
    SiteUpdateRequest: Any
    UserUpsertRequest: Any
    SiteStorageRootUpdateRequest: Any
    SiteMetadataRecoveryRequest: Any


@dataclass
class SitesRouteSupport:
    get_control_plane: Any
    get_approved_user: Any
    require_admin_workspace_permission: Any
    require_validation_permission: Any
    require_site_access: Any
    user_can_access_site: Any
    control_plane_split_enabled: Any
    local_site_records_for_user: Any
    get_model_version: Any
    resolve_execution_device: Any
    project_id_for_site: Any
    queue_name_for_job_type: Any
    get_embedding_backfill_status: Any
    latest_embedding_backfill_job: Any
    queue_ai_clinic_embedding_backfill: Any
    queue_site_embedding_backfill: Any
    queue_federated_retrieval_corpus_sync: Any
    bool_from_value: Any
    coerce_text: Any
    site_level_validation_runs: Any
    validation_case_rows: Any
    build_site_activity: Any
    normalize_storage_root: Any
    get_workflow: Any
    import_template_rows: Any
    model_dir: Any
    make_id: Any
    training_architectures: Any
    load_cross_validation_reports: Any
    SiteValidationRunRequest: Any
    InitialTrainingRequest: Any
    InitialTrainingBenchmarkRequest: Any
    ResumeBenchmarkRequest: Any
    ImageLevelFederatedRoundRequest: Any
    VisitLevelFederatedRoundRequest: Any
    EmbeddingBackfillRequest: Any
    FederatedRetrievalSyncRequest: Any
    CrossValidationRunRequest: Any
    SSLPretrainingRunRequest: Any
    RetrievalBaselineRequest: Any


@dataclass
class CasesRouteSupport:
    get_control_plane: Any
    get_approved_user: Any
    require_site_access: Any
    user_can_access_site: Any
    control_plane_split_enabled: Any
    require_validation_permission: Any
    require_visit_write_access: Any
    require_visit_image_write_access: Any
    require_record_owner: Any
    image_owner_user_id: Any
    get_workflow: Any
    get_semantic_prompt_scorer: Any
    serialize_lesion_preview_job: Any
    get_model_version: Any
    resolve_execution_device: Any
    project_id_for_site: Any
    queue_case_embedding_refresh: Any
    queue_ai_clinic_vector_index_rebuild: Any
    queue_federated_retrieval_corpus_sync: Any
    attach_image_quality_scores: Any
    build_case_history: Any
    build_patient_trajectory: Any
    make_id: Any
    lesion_preview_jobs: Any
    lesion_preview_jobs_lock: Any
    max_image_bytes: Any
    score_slit_lamp_image: Any
    InvalidImageUploadError: Any
    PatientCreateRequest: Any
    PatientUpdateRequest: Any
    VisitCreateRequest: Any
    RepresentativeImageRequest: Any
    LesionBoxRequest: Any
    CaseValidationRequest: Any
    CaseAiClinicRequest: Any
    CaseContributionRequest: Any
    CaseValidationCompareRequest: Any


@dataclass
class RouteSupports:
    desktop: DesktopRouteSupport
    auth: AuthRouteSupport
    admin: AdminRouteSupport
    sites: SitesRouteSupport
    cases: CasesRouteSupport


def build_route_supports(**deps: Any) -> RouteSupports:
    return RouteSupports(
        desktop=DesktopRouteSupport(
            get_control_plane=deps["get_control_plane"],
            google_client_ids=deps["google_client_ids"],
            desktop_self_check=deps["desktop_self_check"],
            load_node_credentials=deps["load_node_credentials"],
            node_credentials_status=deps["node_credentials_status"],
            save_node_credentials=deps["save_node_credentials"],
            clear_node_credentials=deps["clear_node_credentials"],
            database_topology=deps["database_topology"],
            remote_node_os_info=deps["remote_node_os_info"],
            local_control_plane_dev_auth_enabled=deps["local_control_plane_dev_auth_enabled"],
            case_reference_salt_fingerprint=deps["case_reference_salt_fingerprint"],
            make_id=deps["make_id"],
            get_app_version=deps["get_app_version"],
            queue_case_embedding_refresh=deps["queue_case_embedding_refresh"],
            queue_ai_clinic_vector_index_rebuild=deps["queue_ai_clinic_vector_index_rebuild"],
            queue_federated_retrieval_corpus_sync=deps["queue_federated_retrieval_corpus_sync"],
            RemoteControlPlaneClient=deps["RemoteControlPlaneClient"],
            LocalControlPlaneNodeRegisterRequest=deps["LocalControlPlaneNodeRegisterRequest"],
            LocalControlPlaneNodeCredentialsRequest=deps["LocalControlPlaneNodeCredentialsRequest"],
            LocalControlPlaneSmokeRequest=deps["LocalControlPlaneSmokeRequest"],
        ),
        auth=AuthRouteSupport(
            get_control_plane=deps["get_control_plane"],
            get_current_user=deps["get_current_user"],
            local_login_enabled=deps["local_login_enabled"],
            local_dev_auth_enabled=deps["local_dev_auth_enabled"],
            verify_google_id_token=deps["verify_google_id_token"],
            build_auth_response=deps["build_auth_response"],
            LoginRequest=deps["LoginRequest"],
            GoogleLoginRequest=deps["GoogleLoginRequest"],
            AccessRequestCreateRequest=deps["AccessRequestCreateRequest"],
        ),
        admin=AdminRouteSupport(
            get_control_plane=deps["get_control_plane"],
            get_approved_user=deps["get_approved_user"],
            get_workflow=deps["get_workflow"],
            require_admin_workspace_permission=deps["require_admin_workspace_permission"],
            require_platform_admin=deps["require_platform_admin"],
            require_site_access=deps["require_site_access"],
            assert_request_review_permission=deps["assert_request_review_permission"],
            visible_model_updates=deps["visible_model_updates"],
            is_pending_model_update=deps["is_pending_model_update"],
            normalize_storage_root=deps["normalize_storage_root"],
            normalize_default_storage_root=deps["normalize_default_storage_root"],
            invalidate_site_storage_root_cache=deps["invalidate_site_storage_root_cache"],
            embedded_review_artifact_response=deps["embedded_review_artifact_response"],
            load_approval_report=deps["load_approval_report"],
            site_comparison_rows=deps["site_comparison_rows"],
            hash_password=deps["hash_password"],
            registry_orchestrator=deps["registry_orchestrator"],
            make_id=deps["make_id"],
            queue_ai_clinic_embedding_backfill=deps["queue_ai_clinic_embedding_backfill"],
            queue_ai_clinic_vector_index_rebuild=deps["queue_ai_clinic_vector_index_rebuild"],
            queue_federated_retrieval_corpus_sync=deps["queue_federated_retrieval_corpus_sync"],
            case_reference_salt_fingerprint=deps["case_reference_salt_fingerprint"],
            AccessRequestReviewRequest=deps["AccessRequestReviewRequest"],
            StorageSettingsUpdateRequest=deps["StorageSettingsUpdateRequest"],
            ModelUpdateReviewRequest=deps["ModelUpdateReviewRequest"],
            ModelVersionPublishRequest=deps["ModelVersionPublishRequest"],
            ModelVersionAutoPublishRequest=deps["ModelVersionAutoPublishRequest"],
            AggregationRunRequest=deps["AggregationRunRequest"],
            ReleaseRolloutRequest=deps["ReleaseRolloutRequest"],
            ProjectCreateRequest=deps["ProjectCreateRequest"],
            SiteCreateRequest=deps["SiteCreateRequest"],
            SiteUpdateRequest=deps["SiteUpdateRequest"],
            UserUpsertRequest=deps["UserUpsertRequest"],
            SiteStorageRootUpdateRequest=deps["SiteStorageRootUpdateRequest"],
            SiteMetadataRecoveryRequest=deps["SiteMetadataRecoveryRequest"],
        ),
        sites=SitesRouteSupport(
            get_control_plane=deps["get_control_plane"],
            get_approved_user=deps["get_approved_user"],
            require_admin_workspace_permission=deps["require_admin_workspace_permission"],
            require_validation_permission=deps["require_validation_permission"],
            require_site_access=deps["require_site_access"],
            user_can_access_site=deps["user_can_access_site"],
            control_plane_split_enabled=deps["control_plane_split_enabled"],
            local_site_records_for_user=deps["local_site_records_for_user"],
            get_model_version=deps["get_model_version"],
            resolve_execution_device=deps["resolve_execution_device"],
            project_id_for_site=deps["project_id_for_site"],
            queue_name_for_job_type=deps["queue_name_for_job_type"],
            get_embedding_backfill_status=deps["get_embedding_backfill_status"],
            latest_embedding_backfill_job=deps["latest_embedding_backfill_job"],
            queue_ai_clinic_embedding_backfill=deps["queue_ai_clinic_embedding_backfill"],
            queue_site_embedding_backfill=deps["queue_site_embedding_backfill"],
            queue_federated_retrieval_corpus_sync=deps["queue_federated_retrieval_corpus_sync"],
            bool_from_value=deps["bool_from_value"],
            coerce_text=deps["coerce_text"],
            site_level_validation_runs=deps["site_level_validation_runs"],
            validation_case_rows=deps["validation_case_rows"],
            build_site_activity=deps["build_site_activity"],
            normalize_storage_root=deps["normalize_storage_root"],
            get_workflow=deps["get_workflow"],
            import_template_rows=deps["import_template_rows"],
            model_dir=deps["model_dir"],
            make_id=deps["make_id"],
            training_architectures=deps["training_architectures"],
            load_cross_validation_reports=deps["load_cross_validation_reports"],
            SiteValidationRunRequest=deps["SiteValidationRunRequest"],
            InitialTrainingRequest=deps["InitialTrainingRequest"],
            InitialTrainingBenchmarkRequest=deps["InitialTrainingBenchmarkRequest"],
            ResumeBenchmarkRequest=deps["ResumeBenchmarkRequest"],
            ImageLevelFederatedRoundRequest=deps["ImageLevelFederatedRoundRequest"],
            VisitLevelFederatedRoundRequest=deps["VisitLevelFederatedRoundRequest"],
            EmbeddingBackfillRequest=deps["EmbeddingBackfillRequest"],
            FederatedRetrievalSyncRequest=deps["FederatedRetrievalSyncRequest"],
            CrossValidationRunRequest=deps["CrossValidationRunRequest"],
            SSLPretrainingRunRequest=deps["SSLPretrainingRunRequest"],
            RetrievalBaselineRequest=deps["RetrievalBaselineRequest"],
        ),
        cases=CasesRouteSupport(
            get_control_plane=deps["get_control_plane"],
            get_approved_user=deps["get_approved_user"],
            require_site_access=deps["require_site_access"],
            user_can_access_site=deps["user_can_access_site"],
            control_plane_split_enabled=deps["control_plane_split_enabled"],
            require_validation_permission=deps["require_validation_permission"],
            require_visit_write_access=deps["require_visit_write_access"],
            require_visit_image_write_access=deps["require_visit_image_write_access"],
            require_record_owner=deps["require_record_owner"],
            image_owner_user_id=deps["image_owner_user_id"],
            get_workflow=deps["get_workflow"],
            get_semantic_prompt_scorer=deps["get_semantic_prompt_scorer"],
            serialize_lesion_preview_job=deps["serialize_lesion_preview_job"],
            get_model_version=deps["get_model_version"],
            resolve_execution_device=deps["resolve_execution_device"],
            project_id_for_site=deps["project_id_for_site"],
            queue_case_embedding_refresh=deps["queue_case_embedding_refresh"],
            queue_ai_clinic_vector_index_rebuild=deps["queue_ai_clinic_vector_index_rebuild"],
            queue_federated_retrieval_corpus_sync=deps["queue_federated_retrieval_corpus_sync"],
            attach_image_quality_scores=deps["attach_image_quality_scores"],
            build_case_history=deps["build_case_history"],
            build_patient_trajectory=deps["build_patient_trajectory"],
            make_id=deps["make_id"],
            lesion_preview_jobs=deps["lesion_preview_jobs"],
            lesion_preview_jobs_lock=deps["lesion_preview_jobs_lock"],
            max_image_bytes=deps["max_image_bytes"],
            score_slit_lamp_image=deps["score_slit_lamp_image"],
            InvalidImageUploadError=deps["InvalidImageUploadError"],
            PatientCreateRequest=deps["PatientCreateRequest"],
            PatientUpdateRequest=deps["PatientUpdateRequest"],
            VisitCreateRequest=deps["VisitCreateRequest"],
            RepresentativeImageRequest=deps["RepresentativeImageRequest"],
            LesionBoxRequest=deps["LesionBoxRequest"],
            CaseValidationRequest=deps["CaseValidationRequest"],
            CaseAiClinicRequest=deps["CaseAiClinicRequest"],
            CaseContributionRequest=deps["CaseContributionRequest"],
            CaseValidationCompareRequest=deps["CaseValidationCompareRequest"],
        ),
    )
