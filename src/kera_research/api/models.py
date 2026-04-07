from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class AccessRequestCreateRequest(BaseModel):
    requested_site_id: str
    requested_site_label: str = ""
    requested_role: str
    message: str = ""


class AccessRequestReviewRequest(BaseModel):
    decision: str
    assigned_role: str | None = None
    assigned_site_id: str | None = None
    create_site_if_missing: bool = False
    project_id: str | None = None
    site_code: str | None = None
    display_name: str | None = None
    hospital_name: str | None = None
    research_registry_enabled: bool = True
    reviewer_notes: str = ""


class PatientCreateRequest(BaseModel):
    patient_id: str
    sex: str
    age: int
    chart_alias: str = ""
    local_case_code: str = ""


class PatientUpdateRequest(BaseModel):
    sex: str
    age: int
    chart_alias: str = ""
    local_case_code: str = ""


class OrganismSelection(BaseModel):
    culture_category: str
    culture_species: str


class VisitCreateRequest(BaseModel):
    patient_id: str
    visit_date: str
    actual_visit_date: str | None = None
    culture_status: str | None = None
    culture_confirmed: bool | None = None
    culture_category: str | None = None
    culture_species: str | None = None
    additional_organisms: list[OrganismSelection] = Field(default_factory=list)
    contact_lens_use: str
    predisposing_factor: list[str] = Field(default_factory=list)
    other_history: str = ""
    visit_status: str = "active"
    is_initial_visit: bool = False
    smear_result: str = ""
    polymicrobial: bool = False


class RepresentativeImageRequest(BaseModel):
    patient_id: str
    visit_date: str
    representative_image_id: str


class LesionBoxRequest(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class CaseValidationRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)
    generate_gradcam: bool = True
    generate_medsam: bool = True


class CaseAiClinicRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)
    top_k: int = 3
    retrieval_backend: str = "standard"
    retrieval_profile: str = "dinov2_lesion_crop"


class CaseContributionRequest(BaseModel):
    patient_id: str
    visit_date: str
    execution_mode: str = "auto"
    model_version_id: str | None = None
    model_version_ids: list[str] = Field(default_factory=list)


class SiteValidationRunRequest(BaseModel):
    execution_mode: str = "auto"
    generate_gradcam: bool = True
    generate_medsam: bool = True
    model_version_id: str | None = None


class InitialTrainingRequest(BaseModel):
    architecture: str = "convnext_tiny"
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    test_split: float = 0.2
    use_pretrained: bool = True
    pretraining_source: Literal["imagenet", "scratch", "ssl"] | None = None
    ssl_checkpoint_path: str | None = None
    regenerate_split: bool = False


class InitialTrainingBenchmarkRequest(BaseModel):
    architectures: list[str] = Field(
        default_factory=lambda: [
            "densenet121",
            "convnext_tiny",
            "vit",
            "swin",
            "efficientnet_v2_s",
            "dinov2",
            "swin_mil",
            "lesion_guided_fusion__swin",
        ]
    )
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    epochs: int = 30
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    test_split: float = 0.2
    use_pretrained: bool = True
    pretraining_source: Literal["imagenet", "scratch", "ssl"] | None = None
    ssl_checkpoint_path: str | None = None
    benchmark_suite_key: str | None = None
    regenerate_split: bool = False


class ResumeBenchmarkRequest(BaseModel):
    job_id: str
    execution_mode: str | None = None


class RetrievalBaselineRequest(BaseModel):
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    top_k: int = 10


class CrossValidationRunRequest(BaseModel):
    architecture: str = "convnext_tiny"
    execution_mode: str = "auto"
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    num_folds: int = 5
    epochs: int = 10
    learning_rate: float = 1e-4
    batch_size: int = 16
    val_split: float = 0.2
    use_pretrained: bool = True


class SSLPretrainingRunRequest(BaseModel):
    archive_base_dir: str
    architecture: str = "convnext_tiny"
    init_mode: Literal["imagenet", "random"] = "imagenet"
    method: Literal["byol"] = "byol"
    execution_mode: str = "auto"
    image_size: int = 224
    batch_size: int = 24
    epochs: int = 10
    learning_rate: float = 1e-4
    weight_decay: float = 1e-4
    num_workers: int = 8
    min_patient_quality: Literal["low", "medium", "high"] = "medium"
    include_review_rows: bool = False
    use_amp: bool = True


class CaseValidationCompareRequest(BaseModel):
    patient_id: str
    visit_date: str
    model_version_ids: list[str] = Field(default_factory=list)
    execution_mode: str = "auto"
    generate_gradcam: bool = False
    generate_medsam: bool = False


class EmbeddingBackfillRequest(BaseModel):
    execution_mode: str = "auto"
    model_version_id: str | None = None
    force_refresh: bool = False


class AggregationRunRequest(BaseModel):
    update_ids: list[str] = Field(default_factory=list)
    new_version_name: str | None = None


class ModelUpdateReviewRequest(BaseModel):
    decision: str
    reviewer_notes: str = ""


class ModelVersionPublishRequest(BaseModel):
    download_url: str
    set_current: bool = False


class ModelVersionAutoPublishRequest(BaseModel):
    set_current: bool = False


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


class SiteCreateRequest(BaseModel):
    project_id: str
    site_code: str | None = None
    display_name: str | None = None
    hospital_name: str = ""
    source_institution_id: str | None = None
    research_registry_enabled: bool = True


class SiteUpdateRequest(BaseModel):
    display_name: str | None = None
    hospital_name: str = ""
    source_institution_id: str | None = None
    research_registry_enabled: bool = True


class StorageSettingsUpdateRequest(BaseModel):
    storage_root: str


class SiteStorageRootUpdateRequest(BaseModel):
    storage_root: str


class SiteMetadataRecoveryRequest(BaseModel):
    source: Literal["auto", "backup", "manifest"] = "auto"
    force_replace: bool = True
    backup_path: str | None = None


class UserUpsertRequest(BaseModel):
    user_id: str | None = None
    username: str
    full_name: str = ""
    password: str = ""
    role: str = "viewer"
    site_ids: list[str] = Field(default_factory=list)


class LocalControlPlaneNodeRegisterRequest(BaseModel):
    control_plane_base_url: str | None = None
    control_plane_user_token: str
    registration_source: Literal["control_plane_user", "main_admin"] = "control_plane_user"
    device_name: str = "local-node"
    os_info: str = ""
    app_version: str = ""
    site_id: str | None = None
    display_name: str | None = None
    hospital_name: str | None = None
    source_institution_id: str | None = None
    overwrite: bool = False


class LocalControlPlaneNodeCredentialsRequest(BaseModel):
    control_plane_base_url: str
    node_id: str
    node_token: str
    site_id: str | None = None
    overwrite: bool = False


class LocalControlPlaneSmokeRequest(BaseModel):
    update_suffix: str = ""
