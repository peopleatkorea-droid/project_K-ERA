import React from "react";

import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { CaseWorkspace } from "./case-workspace";

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const apiMocks = vi.hoisted(() => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  createVisit: vi.fn(),
  updateVisit: vi.fn(),
  deleteVisitImages: vi.fn(),
  setRepresentativeImage: vi.fn(),
  uploadImage: vi.fn(),
  fetchSiteSummaryCounts: vi.fn(),
  updateImageLesionBox: vi.fn(),
  startLiveLesionPreview: vi.fn(),
  fetchLiveLesionPreviewJob: vi.fn(),
  fetchCases: vi.fn(),
  fetchPatientIdLookup: vi.fn(),
  fetchPatientListPage: vi.fn(),
  fetchMedsamArtifactStatus: vi.fn(),
  fetchMedsamArtifactItems: vi.fn(),
  backfillMedsamArtifacts: vi.fn(),
  fetchSiteActivity: vi.fn(),
  fetchSiteValidations: vi.fn(),
  fetchSiteModelVersions: vi.fn(),
  fetchVisits: vi.fn(),
  fetchImages: vi.fn(),
  fetchVisitImagesWithPreviews: vi.fn(),
  fetchImageBlob: vi.fn(),
  fetchImagePreviewUrl: vi.fn(),
  fetchCaseRoiPreview: vi.fn(),
  fetchCaseLesionPreview: vi.fn(),
  fetchImageSemanticPromptScores: vi.fn(),
  fetchValidationArtifactUrl: vi.fn(),
  fetchCaseRoiPreviewArtifactUrl: vi.fn(),
  fetchCaseLesionPreviewArtifactUrl: vi.fn(),
  prewarmPatientListPage: vi.fn(),
  fetchCaseHistory: vi.fn(),
  fetchStoredCaseLesionPreview: vi.fn(),
  enrollResearchRegistry: vi.fn(),
  runCaseAiClinic: vi.fn(),
  runCaseAiClinicSimilarCases: vi.fn(),
  runCaseValidation: vi.fn(),
  runCaseValidationCompare: vi.fn(),
  runCaseContribution: vi.fn(),
}));
const desktopTransportMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
  prefetchDesktopVisitImages: vi.fn(),
  ensureDesktopImagePreviews: vi.fn(async () => new Map()),
}));

vi.mock("../lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    createPatient: apiMocks.createPatient,
    updatePatient: apiMocks.updatePatient,
    createVisit: apiMocks.createVisit,
    updateVisit: apiMocks.updateVisit,
    deleteVisitImages: apiMocks.deleteVisitImages,
    setRepresentativeImage: apiMocks.setRepresentativeImage,
    uploadImage: apiMocks.uploadImage,
    fetchSiteSummaryCounts: apiMocks.fetchSiteSummaryCounts,
    updateImageLesionBox: apiMocks.updateImageLesionBox,
    startLiveLesionPreview: apiMocks.startLiveLesionPreview,
    fetchLiveLesionPreviewJob: apiMocks.fetchLiveLesionPreviewJob,
    fetchCases: apiMocks.fetchCases,
    fetchPatientIdLookup: apiMocks.fetchPatientIdLookup,
    fetchPatientListPage: apiMocks.fetchPatientListPage,
    fetchMedsamArtifactStatus: apiMocks.fetchMedsamArtifactStatus,
    fetchMedsamArtifactItems: apiMocks.fetchMedsamArtifactItems,
    backfillMedsamArtifacts: apiMocks.backfillMedsamArtifacts,
    fetchSiteActivity: apiMocks.fetchSiteActivity,
    fetchSiteValidations: apiMocks.fetchSiteValidations,
    fetchSiteModelVersions: apiMocks.fetchSiteModelVersions,
    fetchVisits: apiMocks.fetchVisits,
    fetchImages: apiMocks.fetchImages,
    fetchVisitImagesWithPreviews: apiMocks.fetchVisitImagesWithPreviews,
    fetchImageBlob: apiMocks.fetchImageBlob,
    fetchImagePreviewUrl: apiMocks.fetchImagePreviewUrl,
    fetchCaseRoiPreview: apiMocks.fetchCaseRoiPreview,
    fetchCaseLesionPreview: apiMocks.fetchCaseLesionPreview,
    fetchImageSemanticPromptScores: apiMocks.fetchImageSemanticPromptScores,
    fetchValidationArtifactUrl: apiMocks.fetchValidationArtifactUrl,
    fetchCaseRoiPreviewArtifactUrl: apiMocks.fetchCaseRoiPreviewArtifactUrl,
    fetchCaseLesionPreviewArtifactUrl:
      apiMocks.fetchCaseLesionPreviewArtifactUrl,
    prewarmPatientListPage: apiMocks.prewarmPatientListPage,
    fetchCaseHistory: apiMocks.fetchCaseHistory,
    fetchStoredCaseLesionPreview: apiMocks.fetchStoredCaseLesionPreview,
    enrollResearchRegistry: apiMocks.enrollResearchRegistry,
    runCaseAiClinic: apiMocks.runCaseAiClinic,
    runCaseAiClinicSimilarCases: apiMocks.runCaseAiClinicSimilarCases,
    runCaseValidation: apiMocks.runCaseValidation,
    runCaseValidationCompare: apiMocks.runCaseValidationCompare,
    runCaseContribution: apiMocks.runCaseContribution,
  };
});
vi.mock("../lib/desktop-transport", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/desktop-transport")
  >("../lib/desktop-transport");
  return {
    ...actual,
    canUseDesktopTransport: desktopTransportMocks.canUseDesktopTransport,
    prefetchDesktopVisitImages:
      desktopTransportMocks.prefetchDesktopVisitImages,
    ensureDesktopImagePreviews:
      desktopTransportMocks.ensureDesktopImagePreviews,
  };
});

describe("CaseWorkspace integration", () => {
  let draftImageCounter = 0;

  beforeEach(() => {
    draftImageCounter = 0;
    vi.resetAllMocks();
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(false);
    desktopTransportMocks.prefetchDesktopVisitImages.mockImplementation(
      () => undefined,
    );
    desktopTransportMocks.ensureDesktopImagePreviews.mockResolvedValue(
      new Map(),
    );
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    URL.createObjectURL = vi.fn(() => "blob:preview-url");
    URL.revokeObjectURL = vi.fn();

    apiMocks.createPatient.mockResolvedValue({
      patient_id: "KERA-2026-001",
    });
    apiMocks.updatePatient.mockResolvedValue({
      patient_id: "KERA-2026-001",
      sex: "female",
      age: 65,
      chart_alias: "",
      local_case_code: "",
    });
    apiMocks.createVisit.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
    });
    apiMocks.updateVisit.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
    });
    apiMocks.deleteVisitImages.mockResolvedValue(undefined);
    apiMocks.setRepresentativeImage.mockResolvedValue(undefined);
    apiMocks.uploadImage.mockResolvedValue({
      image_id: "image_1",
      patient_id: "KERA-2026-001",
      visit_date: "initial",
      view: "white",
      is_representative: true,
    });
    apiMocks.fetchSiteSummaryCounts.mockResolvedValue({
      site_id: "SITE_A",
      n_patients: 1,
      n_visits: 1,
      n_images: 1,
      n_active_visits: 1,
      n_fungal_visits: 0,
      n_bacterial_visits: 1,
    });
    apiMocks.updateImageLesionBox.mockResolvedValue({});
    apiMocks.startLiveLesionPreview.mockImplementation(
      async (_siteId, imageId: string) => ({
        job_id: `lesionjob_${imageId}`,
        site_id: "SITE_A",
        image_id: imageId,
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        status: "done",
        prompt_signature: `prompt_${imageId}`,
        backend: "medsam",
        has_lesion_crop: true,
        has_lesion_mask: true,
      }),
    );
    apiMocks.fetchLiveLesionPreviewJob.mockImplementation(
      async (_siteId, imageId: string) => ({
        job_id: `lesionjob_${imageId}`,
        site_id: "SITE_A",
        image_id: imageId,
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        status: "done",
        prompt_signature: `prompt_${imageId}`,
        backend: "medsam",
        has_lesion_crop: true,
        has_lesion_mask: true,
      }),
    );
    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        age: 0,
        sex: "female",
        visit_status: "active",
      },
    ]);
    apiMocks.fetchPatientIdLookup.mockImplementation(
      async (_siteId, _token, patientId: string) => ({
        requested_patient_id: patientId,
        normalized_patient_id: patientId.trim(),
        exists: false,
        patient: null,
        visit_count: 0,
        image_count: 0,
        latest_visit_date: null,
      }),
    );
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            additional_organisms: [],
            visit_date: "Initial",
            actual_visit_date: null,
            created_by_user_id: "user_researcher",
            created_at: "2026-03-15T00:00:00Z",
            latest_image_uploaded_at: "2026-03-15T00:00:00Z",
            image_count: 1,
            representative_image_id: "image_1",
            representative_view: "white",
            age: 0,
            sex: "female",
            visit_status: "active",
            is_initial_visit: true,
            smear_result: "not done",
            polymicrobial: false,
          },
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnails: [
            {
              case_id: "case_1",
              image_id: "image_1",
              view: "white",
              preview_url: "/preview/image_1",
              fallback_url: "/content/image_1",
            },
          ],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });
    apiMocks.fetchMedsamArtifactStatus.mockResolvedValue({
      site_id: "SITE_A",
      total: { patients: 1, visits: 1, images: 1 },
      statuses: {
        missing_lesion_box: { patients: 0, visits: 0, images: 0 },
        missing_roi: { patients: 0, visits: 0, images: 0 },
        missing_lesion_crop: { patients: 0, visits: 0, images: 0 },
        medsam_backfill_ready: { patients: 0, visits: 0, images: 0 },
      },
      active_job: null,
      last_synced_at: "2026-03-15T00:00:00Z",
    });
    apiMocks.fetchMedsamArtifactItems.mockResolvedValue({
      scope: "visit",
      status: "medsam_backfill_ready",
      items: [],
      page: 1,
      page_size: 25,
      total_count: 0,
      total_pages: 1,
    });
    apiMocks.backfillMedsamArtifacts.mockResolvedValue({
      site_id: "SITE_A",
      job: {
        job_id: "job_1",
        status: "running",
        result: { progress: { percent: 0 } },
      },
    });
    apiMocks.fetchSiteActivity.mockResolvedValue({
      totals: {
        patients: 1,
        visits: 1,
        images: 1,
      },
      pending_updates: 0,
      recent_cases: [],
      recent_validations: [],
      recent_contributions: [],
    });
    apiMocks.fetchSiteValidations.mockResolvedValue([]);
    apiMocks.fetchSiteModelVersions.mockResolvedValue([]);
    apiMocks.fetchVisits.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: true,
        polymicrobial: false,
      },
    ]);
    apiMocks.fetchImages.mockResolvedValue([
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/preview/image_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);
    apiMocks.fetchVisitImagesWithPreviews.mockResolvedValue([
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/preview/image_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);
    apiMocks.fetchImageBlob.mockResolvedValue(
      new Blob(["image"], { type: "image/png" }),
    );
    apiMocks.fetchImagePreviewUrl.mockImplementation(
      async (_siteId, imageId: string) => `/preview/${imageId}`,
    );
    apiMocks.fetchCaseRoiPreview.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_id: "image_1",
        view: "white",
        is_representative: true,
        source_image_path: "C:\\KERA\\image_1.png",
        has_roi_crop: true,
        has_medsam_mask: true,
        backend: "medsam",
      },
    ]);
    apiMocks.fetchCaseLesionPreview.mockResolvedValue([]);
    apiMocks.fetchCaseRoiPreviewArtifactUrl.mockResolvedValue("/roi/image_1");
    apiMocks.fetchCaseLesionPreviewArtifactUrl.mockResolvedValue(
      "/lesion/image_1",
    );
    apiMocks.fetchImageSemanticPromptScores.mockResolvedValue({
      image_id: "image_1",
      image_path: "C:\\KERA\\image_1.png",
      view: "white",
      input_mode: "source",
      dictionary_name: "dict",
      model_name: "biomedclip",
      model_id: "model_1",
      top_k: 3,
      overall_top_matches: [],
      layers: [],
    });
    apiMocks.prewarmPatientListPage.mockImplementation(() => undefined);
    apiMocks.fetchCaseHistory.mockResolvedValue({
      validations: [],
      contributions: [],
    });
    apiMocks.fetchStoredCaseLesionPreview.mockResolvedValue([]);
    apiMocks.enrollResearchRegistry.mockResolvedValue({
      site_enabled: true,
      user_enrolled: true,
      user_enrolled_at: "2026-03-15T00:00:00Z",
      included_cases: 0,
      excluded_cases: 0,
    });
    apiMocks.runCaseAiClinicSimilarCases.mockResolvedValue({
      analysis_stage: "similar_cases",
      query_case: {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        case_id: "case_1",
        sex: "female",
        age: 65,
        representative_view: "white",
        visit_status: "active",
        predisposing_factor: [],
        quality_score: 78.6,
      },
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        crop_mode: "automated",
      },
      ai_clinic_profile: {
        profile_id: "classifier",
        label: "AI Clinic lite",
        description: "Similar-case retrieval first.",
        effective_retrieval_backend: "classifier",
      },
      technical_details: {
        similar_case_engine: {
          mode: "classifier_penultimate_feature",
          vector_index_mode: "faiss_local",
          backends_used: ["classifier"],
          metadata_reranking: "enabled",
        },
      },
      execution_device: "cpu",
      retrieval_mode: "classifier_penultimate_feature",
      vector_index_mode: "faiss_local",
      metadata_reranking: "enabled",
      retrieval_backends_used: ["classifier"],
      top_k: 3,
      eligible_candidate_count: 2,
      similar_cases: [
        {
          patient_id: "SIM-001",
          visit_date: "FU #1",
          case_id: "similar_case_1",
          representative_image_id: "similar_image_1",
          representative_view: "white",
          culture_category: "fungal",
          culture_species: "Candida",
          image_count: 2,
          quality_score: 74.2,
          similarity: 0.832,
          metadata_reranking: {
            adjustment: 0.03,
            alignment: {
              matched_fields: ["visit_status"],
              conflicted_fields: [],
            },
          },
        },
      ],
      text_retrieval_mode: null,
      text_embedding_model: null,
      eligible_text_count: 0,
      text_evidence: [],
      text_retrieval_error: null,
      classification_context: null,
      differential: null,
      workflow_recommendation: null,
    });
    apiMocks.runCaseAiClinic.mockResolvedValue({
      analysis_stage: "expanded",
      query_case: {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        case_id: "case_1",
        sex: "female",
        age: 65,
        representative_view: "white",
        visit_status: "active",
        predisposing_factor: [],
        quality_score: 78.6,
      },
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        crop_mode: "automated",
      },
      ai_clinic_profile: {
        profile_id: "classifier",
        label: "AI Clinic lite",
        description: "Similar-case retrieval first.",
        effective_retrieval_backend: "classifier",
      },
      technical_details: {
        similar_case_engine: {
          mode: "classifier_penultimate_feature",
          vector_index_mode: "faiss_local",
          backends_used: ["classifier"],
          metadata_reranking: "enabled",
        },
        narrative_evidence_engine: {
          mode: "biomedclip_image_to_text",
          model: "biomedclip",
        },
        workflow_guidance_engine: {
          mode: "local_fallback",
          provider_label: "Rules-based local guidance",
        },
      },
      execution_device: "cpu",
      retrieval_mode: "classifier_penultimate_feature",
      vector_index_mode: "faiss_local",
      metadata_reranking: "enabled",
      retrieval_backends_used: ["classifier"],
      top_k: 3,
      eligible_candidate_count: 2,
      similar_cases: [
        {
          patient_id: "SIM-001",
          visit_date: "FU #1",
          case_id: "similar_case_1",
          representative_image_id: "similar_image_1",
          representative_view: "white",
          culture_category: "fungal",
          culture_species: "Candida",
          image_count: 2,
          quality_score: 74.2,
          similarity: 0.832,
        },
      ],
      text_retrieval_mode: "biomedclip_image_to_text",
      text_embedding_model: "biomedclip",
      eligible_text_count: 1,
      text_evidence: [
        {
          case_id: "similar_case_1",
          patient_id: "SIM-001",
          visit_date: "FU #1",
          culture_category: "fungal",
          culture_species: "Candida",
          text: "Dense stromal infiltrate with satellite lesions.",
          similarity: 0.79,
        },
      ],
      text_retrieval_error: null,
      classification_context: {
        validation_id: "validation_1",
        model_version_id: "model_vit",
        model_version: "vit-v1",
        predicted_label: "fungal",
        true_label: "bacterial",
        prediction_probability: 0.82,
        is_correct: false,
      },
      differential: {
        engine: "ai_clinic_differential",
        overall_uncertainty: "moderate",
        top_label: "fungal",
        differential: [
          {
            label: "fungal",
            score: 0.78,
            confidence_band: "high",
            component_scores: {
              classifier: 0.81,
              retrieval: 0.77,
              text: 0.73,
              metadata: 0.12,
              quality_penalty: 0.03,
            },
            supporting_evidence: ["Similar cases cluster on fungal labels."],
            conflicting_evidence: ["Culture still points bacterial."],
          },
        ],
      },
      workflow_recommendation: {
        mode: "local_fallback",
        summary:
          "Review fungal-supporting evidence before final interpretation.",
        recommended_steps: [
          "Review similar case thumbnails",
          "Read narrative evidence",
        ],
        flags_to_review: ["Culture mismatch"],
        rationale:
          "The retrieval evidence leans fungal while culture disagrees.",
        uncertainty: "Moderate",
        disclaimer: "Research support only.",
      },
    });
    apiMocks.runCaseValidation.mockResolvedValue({
      summary: {
        validation_id: "validation_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        predicted_label: "fungal",
        true_label: "bacterial",
        prediction_probability: 0.82,
        is_correct: false,
      },
      case_prediction: null,
      model_version: {
        version_id: "model_convnext",
        version_name: "global-convnext",
        architecture: "convnext_tiny",
        requires_medsam_crop: true,
        crop_mode: "automated",
        ensemble_mode: null,
      },
      execution_device: "cpu",
      artifact_availability: {
        gradcam: false,
        gradcam_cornea: false,
        gradcam_lesion: false,
        roi_crop: false,
        medsam_mask: false,
        lesion_crop: false,
        lesion_mask: false,
      },
      post_mortem: {
        mode: "local_fallback",
        model: null,
        generated_at: "2026-03-15T00:01:00Z",
        outcome: "incorrect",
        summary:
          "The model favored fungal, but the available evidence suggests the case should be reviewed as a boundary miss.",
        likely_causes: [
          "The classifier margin was limited and the case looks visually ambiguous.",
        ],
        supporting_evidence: [
          "The saved validation record preserved the predicted fungal signal.",
        ],
        contradictory_evidence: ["Culture confirmed a bacterial label."],
        follow_up_actions: [
          "Review the saved crop artifacts before adding this case to training.",
        ],
        learning_signal: "boundary_case_review",
        uncertainty: "Moderate",
        disclaimer: "Research support only.",
        structured_analysis: {
          outcome: "incorrect",
          prediction_confidence: 0.82,
          learning_signal: "boundary_case_review",
          root_cause_tags: ["natural_boundary", "data_sparse"],
          action_tags: ["human_review", "collect_more_cases"],
          scores: {
            cam_overlap_score: 0.31,
            dino_true_label_purity: 0.33,
            dino_mean_distance: 0.42,
            multi_model_disagreement: 0.44,
            image_quality_score: 71,
            site_error_concentration: 0.38,
            similar_case_count: 3,
            text_evidence_count: 2,
          },
          peer_model_consensus: {
            models_evaluated: 5,
            models_requested: 5,
            leading_label: "fungal",
            agreement_rate: 0.56,
            disagreement_score: 0.44,
            vote_entropy: 0.62,
            peer_predictions: [],
          },
          prediction_snapshot: {
            prediction_probability: 0.82,
            predicted_confidence: 0.82,
            crop_mode: "automated",
            representative_quality_score: 71,
            classifier_embedding: {
              embedding_id: "classifier:model_convnext:abc123",
            },
            dinov2_embedding: { embedding_id: "dinov2:model_convnext:def456" },
            peer_model_consensus: {
              models_evaluated: 5,
              models_requested: 5,
              leading_label: "fungal",
              agreement_rate: 0.56,
              disagreement_score: 0.44,
              vote_entropy: 0.62,
              peer_predictions: [],
            },
          },
        },
        llm_error: null,
      },
    });
    apiMocks.runCaseValidationCompare.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      execution_device: "cpu",
      comparisons: [],
    });
    apiMocks.runCaseContribution.mockResolvedValue({
      update: {
        update_id: "update_1",
        site_id: "SITE_A",
        base_model_version_id: "model_vit",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cpu",
        artifact_path: "C:\\KERA\\delta_1.pth",
        n_cases: 1,
        contributed_by: "user_researcher",
        case_reference_id: "case_ref_1",
        created_at: "2026-03-15T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "pending_review",
      },
      updates: [
        {
          update_id: "update_1",
          site_id: "SITE_A",
          base_model_version_id: "model_vit",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cpu",
          artifact_path: "C:\\KERA\\delta_1.pth",
          n_cases: 1,
          contributed_by: "user_researcher",
          case_reference_id: "case_ref_1",
          created_at: "2026-03-15T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "pending_review",
          crop_mode: "automated",
        },
      ],
      update_count: 1,
      visit_status: "active",
      execution_device: "cpu",
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
      },
      model_versions: [
        {
          version_id: "model_vit",
          version_name: "vit-v1",
          architecture: "vit",
          crop_mode: "automated",
          ensemble_mode: null,
        },
      ],
      failures: [],
      stats: {
        total_contributions: 1,
        user_contributions: 1,
        user_contribution_pct: 100,
        current_model_version: "global-http-seed",
      },
    });
  });

  function seedDraft() {
    window.localStorage.setItem(
      "kera_workspace_draft:user_researcher:SITE_A",
      JSON.stringify({
        draft: {
          patient_id: "KERA-2026-001",
          chart_alias: "",
          local_case_code: "",
          sex: "female",
          age: "",
          actual_visit_date: "",
          follow_up_number: "1",
          culture_category: "bacterial",
          culture_species: "Staphylococcus aureus",
          additional_organisms: [],
          contact_lens_use: "none",
          visit_status: "active",
          is_initial_visit: true,
          predisposing_factor: [],
          other_history: "",
          intake_completed: false,
        },
        updated_at: "2026-03-15T00:00:00Z",
      }),
    );
  }

  function renderWorkspace(
    onSiteDataChanged = vi.fn(async () => undefined),
    summaryOverrides: Partial<{
      site_id: string;
      n_patients: number;
      n_visits: number;
      n_images: number;
      n_active_visits: number;
      n_fungal_visits: number;
      n_bacterial_visits: number;
      n_validation_runs: number;
      latest_validation: Record<string, unknown> | null;
      research_registry: {
        site_enabled: boolean;
        user_enrolled: boolean;
        user_enrolled_at?: string | null;
        included_cases: number;
        excluded_cases: number;
      };
    }> = {},
    sitesOverride?: Array<{
      site_id: string;
      display_name: string;
      hospital_name: string;
      source_institution_name?: string;
    }>,
    options: { strictMode?: boolean } = {},
  ) {
    const resolvedSites = sitesOverride ?? [
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
    ];
    const selectedSiteId = resolvedSites[0]?.site_id ?? "SITE_A";
    const workspace = (
      <LocaleProvider>
        <CaseWorkspace
          token="test-token"
          user={{
            user_id: "user_researcher",
            username: "researcher",
            full_name: "Researcher",
            role: "researcher",
            site_ids: resolvedSites.map((site) => site.site_id),
            approval_status: "approved",
          }}
          sites={resolvedSites}
          selectedSiteId={selectedSiteId}
          summary={{
            site_id: selectedSiteId,
            n_patients: 0,
            n_visits: 0,
            n_images: 0,
            n_active_visits: 0,
            n_validation_runs: 0,
            latest_validation: null,
            ...summaryOverrides,
          }}
          canOpenOperations
          theme="light"
          onSelectSite={vi.fn()}
          onExportManifest={vi.fn()}
          onLogout={vi.fn()}
          onOpenOperations={vi.fn()}
          onSiteDataChanged={onSiteDataChanged}
          onToggleTheme={vi.fn()}
        />
      </LocaleProvider>
    );
    return render(
      options.strictMode ? (
        <React.StrictMode>{workspace}</React.StrictMode>
      ) : (
        workspace
      ),
    );
  }

  function setMockElementRect(element: Element, width = 240, height = 180) {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      }),
    });
  }

  async function drawDraftLesionBox(fileName: string) {
    const lesionCanvas = await screen.findByLabelText(
      `Lesion box canvas for ${fileName}`,
    );
    const imageCard = lesionCanvas.closest("article");
    if (!imageCard) {
      throw new Error(`Unable to find the draft image card for ${fileName}.`);
    }
    setMockElementRect(lesionCanvas);
    const pointerDown = createEvent.pointerDown(lesionCanvas, {
      clientX: 24,
      clientY: 24,
      pointerType: "mouse",
      buttons: 1,
    });
    Object.assign(pointerDown, {
      pointerId: 1,
      clientX: 24,
      clientY: 24,
      pointerType: "mouse",
      buttons: 1,
    });
    fireEvent(lesionCanvas, pointerDown);

    const pointerMove = createEvent.pointerMove(lesionCanvas, {
      clientX: 196,
      clientY: 132,
      pointerType: "mouse",
      buttons: 1,
    });
    Object.assign(pointerMove, {
      pointerId: 1,
      clientX: 196,
      clientY: 132,
      pointerType: "mouse",
      buttons: 1,
    });
    fireEvent(lesionCanvas, pointerMove);

    const pointerUp = createEvent.pointerUp(lesionCanvas, {
      clientX: 196,
      clientY: 132,
      pointerType: "mouse",
      buttons: 0,
    });
    Object.assign(pointerUp, {
      pointerId: 1,
      clientX: 196,
      clientY: 132,
      pointerType: "mouse",
      buttons: 0,
    });
    fireEvent(lesionCanvas, pointerUp);
    await waitFor(() => {
      expect(
        within(imageCard).getByText("Lesion box ready"),
      ).toBeInTheDocument();
    });
  }

  async function addDraftImage(
    container: HTMLElement,
    options: { drawLesionBox?: boolean; fileName?: string } = {},
  ) {
    draftImageCounter += 1;
    const file = new File(
      ["white-image"],
      options.fileName ?? `slit-${draftImageCounter}.png`,
      { type: "image/png" },
    );
    await waitFor(() => {
      expect(container.querySelector('input[type="file"]')).not.toBeNull();
    });
    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Unable to find the draft image file input.");
    }
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    if (options.drawLesionBox !== false) {
      await drawDraftLesionBox(file.name);
    }
    return file;
  }

  async function waitForSaveReady() {
    const saveButton = screen.getByRole("button", { name: "Save to hospital" });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    return saveButton;
  }

  async function openNewCaseCanvas() {
    fireEvent.click(await screen.findByRole("button", { name: /New case/i }));
    await screen.findByRole("button", { name: "Lock intake" });
  }

  function completeRequiredIntakeFields(patientId = "KERA-2026-001") {
    fireEvent.change(screen.getByLabelText("Patient ID"), {
      target: { value: patientId },
    });
    fireEvent.change(screen.getByLabelText("Age"), {
      target: { value: "65" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "bacterial" },
    });
    fireEvent.change(screen.getByLabelText("Species"), {
      target: { value: "Staphylococcus aureus" },
    });
  }

  async function openSavedCase(patientId = "KERA-2026-001") {
    await screen.findByText("Patient list");
    await waitFor(() => {
      const matchingButton = screen
        .getAllByRole("button")
        .find(
          (button) =>
            button.textContent?.includes(patientId) &&
            button.textContent?.includes("Staphylococcus aureus"),
        );
      expect(matchingButton).toBeDefined();
    });
    const caseButton = screen
      .getAllByRole("button")
      .find(
        (button) =>
          button.textContent?.includes(patientId) &&
          button.textContent?.includes("Staphylococcus aureus"),
      );

    if (!caseButton) {
      throw new Error(`Unable to find a saved case button for ${patientId}.`);
    }

    fireEvent.click(caseButton);
    await screen.findByText("Case summary");
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    return { promise, resolve, reject };
  }

  it("marks the active workspace mode in the top rail", async () => {
    renderWorkspace();

    let newCaseButton = await screen.findByRole("button", {
      name: /New case/i,
    });
    let listViewButton = screen.getByRole("button", { name: /List view/i });

    expect(newCaseButton).toHaveAttribute("aria-pressed", "false");
    expect(listViewButton).toHaveAttribute("aria-pressed", "true");
    expect(newCaseButton).toHaveAttribute("data-variant", "ghost");
    expect(listViewButton).toHaveAttribute("data-variant", "primary");
    expect(screen.queryByText("Now")).not.toBeInTheDocument();

    fireEvent.click(newCaseButton);
    await screen.findByRole("button", { name: "Lock intake" });

    newCaseButton = screen.getByRole("button", { name: /New case/i });
    listViewButton = screen.getByRole("button", { name: /List view/i });

    expect(newCaseButton).toHaveAttribute("aria-pressed", "true");
    expect(listViewButton).toHaveAttribute("aria-pressed", "false");
    expect(newCaseButton).toHaveAttribute("data-variant", "primary");
    expect(listViewButton).toHaveAttribute("data-variant", "ghost");
    expect(screen.queryByText("Now")).not.toBeInTheDocument();

    fireEvent.click(listViewButton);
    await screen.findByText("Patient list");

    expect(screen.getByRole("button", { name: /New case/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /List view/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /New case/i })).toHaveAttribute(
      "data-variant",
      "ghost",
    );
    expect(screen.getByRole("button", { name: /List view/i })).toHaveAttribute(
      "data-variant",
      "primary",
    );
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
  });

  it("hides the image board until intake is locked", async () => {
    renderWorkspace();

    await openNewCaseCanvas();

    expect(screen.queryByText("Build the image")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save to hospital" }),
    ).not.toBeInTheDocument();

    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    expect(await screen.findByText("Build the image")).toBeInTheDocument();
    expect(screen.getByText("🖼️")).toBeInTheDocument();
    expect(screen.getByText("board before submission")).toBeInTheDocument();
    expect(screen.getByLabelText("Image board")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save to hospital" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Lesion boxes")).not.toBeInTheDocument();
  });

  it("keeps save disabled until every draft image has a lesion box", async () => {
    const { container } = renderWorkspace();

    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    await addDraftImage(container, {
      drawLesionBox: false,
      fileName: "needs-box.png",
    });

    const saveButton = screen.getByRole("button", { name: "Save to hospital" });
    expect(saveButton).toBeDisabled();
    expect(
      screen.getByText(
        "Draw and save a lesion box on every uploaded image before saving this case.",
      ),
    ).toBeInTheDocument();

    await drawDraftLesionBox("needs-box.png");

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it("shows hospital summary metrics in the rail and removes duplicate list-view panels", async () => {
    renderWorkspace(undefined, {
      n_patients: 22,
      n_visits: 43,
      n_images: 112,
      n_fungal_visits: 19,
      n_bacterial_visits: 24,
      n_validation_runs: 0,
    });

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    expect(within(hospitalSection).getByText("Hospital A")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("22")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("43")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("112")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("19 / 24")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("patients")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("visits")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("images")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("fungal / bacterial")).toBeInTheDocument();
    expect(
      within(hospitalSection).queryByText("validations"),
    ).not.toBeInTheDocument();
    expect(
      within(hospitalSection).queryByText("linked"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Selected hospital")).not.toBeInTheDocument();
    expect(screen.queryByText("Momentum")).not.toBeInTheDocument();
  });

  it("hydrates hospital fungal and bacterial counts from loaded cases when the incoming summary omits them", async () => {
    renderWorkspace();

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    await waitFor(() => {
      expect(within(hospitalSection).getByText("0 / 1")).toBeInTheDocument();
    });
    expect(within(hospitalSection).getByText("fungal / bacterial")).toBeInTheDocument();
  });

  it("shows the real hospital name in the rail when raw HIRA codes are stored", async () => {
    renderWorkspace(undefined, {}, [
      {
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
        source_institution_name: "제주대학교병원",
      },
    ]);

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    expect(
      within(hospitalSection).getByText("제주대학교병원"),
    ).toBeInTheDocument();
    expect(
      within(hospitalSection).queryByText("39100103"),
    ).not.toBeInTheDocument();
  });

  it("shows the multi-hospital count on one line in the rail header", async () => {
    renderWorkspace(undefined, {}, [
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
      {
        site_id: "SITE_B",
        display_name: "Site B",
        hospital_name: "Hospital B",
      },
    ]);

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    expect(within(hospitalSection).getByText("2 linked")).toBeInTheDocument();
  });

  it("shows the latest autosaved draft in the hospital rail and opens it from list view", async () => {
    seedDraft();
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));
    await screen.findByText("Patient list");

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    expect(
      await within(hospitalSection).findByText("Latest autosave"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(hospitalSection).getByRole("button", { name: /KERA-2026-001/i }),
    );

    await screen.findByRole("button", { name: "Lock intake" });
    expect(screen.getByLabelText("Patient ID")).toHaveValue("KERA-2026-001");
  });

  it("hides the latest autosaved draft from the hospital rail once intake is locked", async () => {
    seedDraft();
    renderWorkspace();

    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }

    expect(
      await within(hospitalSection).findByText("Latest autosave"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(hospitalSection).getByRole("button", { name: /KERA-2026-001/i }),
    );
    await screen.findByRole("button", { name: "Lock intake" });

    fireEvent.change(screen.getByLabelText("Age"), {
      target: { value: "65" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    await waitFor(() => {
      expect(
        within(hospitalSection).queryByText("Latest autosave"),
      ).not.toBeInTheDocument();
      expect(
        within(hospitalSection).queryByText("KERA-2026-001"),
      ).not.toBeInTheDocument();
    });
  });

  it("requires both registry confirmations before joining", async () => {
    const onSiteDataChanged = vi.fn(async () => undefined);
    renderWorkspace(onSiteDataChanged, {
      research_registry: {
        site_enabled: true,
        user_enrolled: false,
        included_cases: 0,
        excluded_cases: 0,
      },
    });

    await openSavedCase();

    fireEvent.click(
      screen.getByRole("button", { name: "Join research registry" }),
    );

    const dialog = await screen.findByRole("dialog");
    const joinButton = within(dialog).getByRole("button", {
      name: "Join research registry",
    });
    const explanationCheckbox = within(dialog).getByRole("checkbox", {
      name: /Acknowledge the registry explanation/i,
    });
    const usageConsentCheckbox = within(dialog).getByRole("checkbox", {
      name: /Consent to registry use/i,
    });

    expect(joinButton).toBeDisabled();

    fireEvent.click(explanationCheckbox);
    expect(joinButton).toBeDisabled();

    fireEvent.click(usageConsentCheckbox);
    expect(joinButton).toBeEnabled();

    fireEvent.click(joinButton);

    await waitFor(() => {
      expect(apiMocks.enrollResearchRegistry).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
      );
      expect(onSiteDataChanged).toHaveBeenCalledWith("SITE_A");
    });
  });

  it("opens recent alerts from the header button and clears them inside the panel", async () => {
    seedDraft();
    renderWorkspace();

    const alertsButton = await screen.findByRole("button", {
      name: "Recent alerts",
    });
    expect(
      (
        await screen.findAllByText(
          "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(alertsButton).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear alerts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Transient toasts stay here for this session."),
    ).not.toBeInTheDocument();

    fireEvent.click(alertsButton);

    const alertsDialog = await screen.findByRole("dialog", {
      name: "Recent alerts",
    });
    expect(
      within(alertsDialog).getByText(
        "Transient toasts stay here for this session.",
      ),
    ).toBeInTheDocument();
    expect(
      within(alertsDialog).getByText(
        "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(alertsDialog).getByRole("button", { name: "Clear alerts" }),
    );

    await waitFor(() => {
      expect(
        within(alertsDialog).getByText("No alerts yet in this session."),
      ).toBeInTheDocument();
    });
  });

  it("restores draft images after the workspace is reopened until a fresh new case is requested", async () => {
    const { container, unmount } = renderWorkspace();

    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    const file = await addDraftImage(container);

    await waitFor(() => {
      expect(screen.getAllByText(/Draft autosaved/i).length).toBeGreaterThan(0);
      expect(
        window.localStorage.getItem(
          "kera_workspace_draft:user_researcher:SITE_A",
        ),
      ).toContain('"patient_id":"KERA-2026-001"');
    });

    unmount();

    renderWorkspace();

    expect(
      (
        await screen.findAllByText(
          "Recovered the last saved draft for this hospital, including local images.",
        )
      ).length,
    ).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole("button", { name: /New case/i }));
    await screen.findByRole("button", { name: "Lock intake" });

    await waitFor(() => {
      expect(screen.getByLabelText("Patient ID")).toHaveValue("");
      expect(screen.queryByAltText(file.name)).not.toBeInTheDocument();
      expect(screen.queryByText("Build the image")).not.toBeInTheDocument();
      expect(
        window.localStorage.getItem(
          "kera_workspace_draft:user_researcher:SITE_A",
        ),
      ).toBeNull();
    });
  });

  it("highlights selected predisposing factors without showing a duplicate sidebar card", async () => {
    seedDraft();
    renderWorkspace();
    await openNewCaseCanvas();

    expect(
      screen.queryByText("No predisposing factor selected yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Selected visit factors stay visible here while you finish the draft.",
      ),
    ).not.toBeInTheDocument();

    const traumaButton = screen.getByRole("button", { name: "trauma" });
    expect(traumaButton.className).not.toContain("!bg-blue-600");

    fireEvent.click(traumaButton);

    await waitFor(() => {
      expect(traumaButton.className).toContain("!border-blue-700");
      expect(traumaButton.className).toContain("!bg-blue-600");
      expect(traumaButton.className).toContain("!text-white");
      expect(traumaButton.className).toContain("ring-2");
      expect(traumaButton.className).not.toContain(
        "bg-[linear-gradient(180deg,rgba(255,233,133,1),rgba(251,191,36,0.98))]",
      );
      expect(traumaButton.className).not.toContain("ring-2 ring-amber-200/85");
    });
    expect(screen.getAllByText("trauma")).toHaveLength(1);
  });

  it("completes intake, uploads an image, and saves a new case", async () => {
    const onSiteDataChanged = vi.fn(async () => undefined);
    seedDraft();
    const { container } = renderWorkspace(onSiteDataChanged);

    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    const file = await addDraftImage(container);

    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.createPatient).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          sex: "female",
          age: 65,
          chart_alias: "",
          local_case_code: "",
        },
      );
      expect(apiMocks.createVisit).toHaveBeenCalled();
      expect(apiMocks.uploadImage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          view: "white",
          is_representative: true,
          refresh_embeddings: false,
          file,
        },
      );
      expect(apiMocks.setRepresentativeImage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          representative_image_id: "image_1",
        },
      );
    });
    await waitFor(() => {
      expect(onSiteDataChanged).toHaveBeenCalledWith("SITE_A");
    });
    await waitFor(() => {
      expect(apiMocks.fetchCaseRoiPreview).toHaveBeenCalledWith(
        "SITE_A",
        "KERA-2026-001",
        "Initial",
        "test-token",
      );
    });
    await waitFor(() => {
      expect(apiMocks.updateImageLesionBox).toHaveBeenCalledWith(
        "SITE_A",
        "image_1",
        "test-token",
        expect.objectContaining({
          x0: expect.any(Number),
          y0: expect.any(Number),
          x1: expect.any(Number),
          y1: expect.any(Number),
        }),
      );
      expect(apiMocks.startLiveLesionPreview).toHaveBeenCalledWith(
        "SITE_A",
        "image_1",
        "test-token",
      );
    });
    expect(
      (
        await screen.findAllByText(
          "Case KERA-2026-001 / Initial saved to Hospital A.",
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it("opens the saved-case view before the background refresh settles", async () => {
    const deferredRefresh = createDeferred<void>();
    const onSiteDataChanged = vi.fn(() => deferredRefresh.promise);
    seedDraft();
    const { container } = renderWorkspace(onSiteDataChanged);

    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    apiMocks.fetchCases.mockClear();
    apiMocks.fetchPatientListPage.mockClear();

    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(onSiteDataChanged).toHaveBeenCalledWith("SITE_A");
    });
    expect(await screen.findByText("Case summary")).toBeInTheDocument();
    expect(
      apiMocks.fetchCases.mock.calls.some(
        ([, , options]) => !options || !("patientId" in (options ?? {})) || !options?.patientId,
      ),
    ).toBe(false);
    expect(apiMocks.fetchPatientListPage).not.toHaveBeenCalled();

    deferredRefresh.resolve();

    await waitFor(() => {
      expect(apiMocks.fetchCases).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ mine: false }),
      );
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          mine: false,
          page: 1,
          page_size: 25,
          search: "",
        }),
      );
    });
  });

  it("shows a newly saved case in list view without a full page refresh", async () => {
    const nextCase = {
      case_id: "case_new",
      patient_id: "KERA-2026-009",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "Initial",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-15T00:00:00Z",
      latest_image_uploaded_at: "2026-03-15T00:00:00Z",
      image_count: 1,
      representative_image_id: "image_new",
      representative_view: "white",
      age: 65,
      sex: "female",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
    };
    const nextPatientRow = {
      patient_id: "KERA-2026-009",
      latest_case: nextCase,
      case_count: 1,
      organism_summary: "Staphylococcus aureus",
      representative_thumbnails: [
        {
          case_id: "case_new",
          image_id: "image_new",
          view: "white",
          preview_url: "/preview/image_new",
          fallback_url: "/content/image_new",
        },
      ],
    };
    let currentCases = [
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        local_case_code: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        latest_image_uploaded_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        representative_view: "white",
        age: 0,
        sex: "female",
        visit_status: "active",
        is_initial_visit: true,
        smear_result: "not done",
        polymicrobial: false,
      },
    ];
    let currentPatientList = {
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: currentCases[0],
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnails: [
            {
              case_id: "case_1",
              image_id: "image_1",
              view: "white",
              preview_url: "/preview/image_1",
              fallback_url: "/content/image_1",
            },
          ],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    };

    apiMocks.fetchCases.mockImplementation(async () => currentCases);
    apiMocks.fetchPatientListPage.mockImplementation(
      async () => currentPatientList,
    );
    apiMocks.createVisit.mockImplementation(async () => {
      currentCases = [nextCase, ...currentCases];
      currentPatientList = {
        items: [nextPatientRow, ...currentPatientList.items],
        page: 1,
        page_size: 25,
        total_count: 2,
        total_pages: 1,
      };
      return {
        patient_id: "KERA-2026-009",
        visit_date: "Initial",
      };
    });

    const { container } = renderWorkspace();

    await openNewCaseCanvas();
    completeRequiredIntakeFields("KERA-2026-009");
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          mine: false,
          page: 1,
          page_size: 25,
          search: "",
        }),
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));

    const newCaseButton = (await screen.findAllByRole("button")).find(
      (button) =>
        button.textContent?.includes("KERA-2026-009") &&
        button.textContent?.includes("Staphylococcus aureus"),
    );
    expect(newCaseButton).toBeTruthy();
  });

  it("hides the case review sidebar when returning to list view", async () => {
    renderWorkspace();

    await openSavedCase();
    expect(
      await screen.findByText("Control automatic dataset inclusion"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /List view/i }));

    expect(await screen.findByText("Patient list")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText("Control automatic dataset inclusion"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Artifact backlog")).toBeInTheDocument();
  });

  it("warns when the patient ID already exists and saves without recreating the patient", async () => {
    apiMocks.fetchPatientIdLookup.mockImplementation(
      async (_siteId, _token, patientId: string) => ({
        requested_patient_id: patientId,
        normalized_patient_id: patientId.trim(),
        exists: patientId.trim() === "KERA-2026-001",
        patient:
          patientId.trim() === "KERA-2026-001"
            ? {
                patient_id: "KERA-2026-001",
                created_by_user_id: "user_researcher",
                sex: "female",
                age: 65,
                chart_alias: "",
                local_case_code: "",
                created_at: "2026-03-15T00:00:00Z",
              }
            : null,
        visit_count: patientId.trim() === "KERA-2026-001" ? 2 : 0,
        image_count: patientId.trim() === "KERA-2026-001" ? 5 : 0,
        latest_visit_date:
          patientId.trim() === "KERA-2026-001" ? "FU #1" : null,
      }),
    );

    const { container } = renderWorkspace();

    await openNewCaseCanvas();
    completeRequiredIntakeFields("KERA-2026-001");

    expect(
      await screen.findByText(/Existing patient record found\./),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.createPatient).not.toHaveBeenCalled();
      expect(apiMocks.createVisit).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          patient_id: "KERA-2026-001",
          visit_date: "FU #1",
          is_initial_visit: false,
        }),
      );
    });
  });

  it("removes the duplicate header summary after the intake is locked", async () => {
    seedDraft();
    renderWorkspace();

    await openNewCaseCanvas();
    completeRequiredIntakeFields("17461463");
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));

    await screen.findByText("Case intake locked and ready for image work");
    expect(screen.getAllByText("17461463")).toHaveLength(1);
  });

  it("keeps BiomedCLIP analysis on the source image even when the saved image mode changes", async () => {
    renderWorkspace();
    await openSavedCase();

    fireEvent.change(await screen.findByLabelText("Saved image mode"), {
      target: { value: "lesion_crop" },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Run BiomedCLIP analysis" }),
    );

    await waitFor(() => {
      expect(apiMocks.fetchImageSemanticPromptScores).toHaveBeenCalledWith(
        "SITE_A",
        "image_1",
        "test-token",
        {
          top_k: 3,
          input_mode: "source",
        },
      );
    });
  });

  it("generates ROI previews when the saved image mode switches to cornea crop", async () => {
    renderWorkspace();
    await openSavedCase();

    fireEvent.change(await screen.findByLabelText("Saved image mode"), {
      target: { value: "roi_crop" },
    });

    await waitFor(() => {
      expect(apiMocks.fetchCaseRoiPreview).toHaveBeenCalledWith(
        "SITE_A",
        "KERA-2026-001",
        "Initial",
        "test-token",
      );
    });
    await waitFor(() => {
      expect(apiMocks.fetchCaseRoiPreviewArtifactUrl).toHaveBeenCalledWith(
        "SITE_A",
        "KERA-2026-001",
        "Initial",
        "image_1",
        "roi_crop",
        "test-token",
      );
    });
  });

  it("generates lesion previews when the saved image mode switches to lesion crop and a lesion box exists", async () => {
    apiMocks.fetchVisitImagesWithPreviews.mockResolvedValue([
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/preview/image_1",
        lesion_prompt_box: { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 },
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);
    apiMocks.fetchCaseLesionPreview.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_id: "image_1",
        view: "white",
        is_representative: true,
        source_image_path: "C:\\KERA\\image_1.png",
        has_lesion_crop: true,
        has_lesion_mask: true,
        backend: "medsam",
        lesion_prompt_box: { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 },
      },
    ]);

    renderWorkspace();
    await openSavedCase();

    fireEvent.change(await screen.findByLabelText("Saved image mode"), {
      target: { value: "lesion_crop" },
    });

    await waitFor(() => {
      expect(apiMocks.fetchCaseLesionPreview).toHaveBeenCalledWith(
        "SITE_A",
        "KERA-2026-001",
        "Initial",
        "test-token",
      );
    });
    await waitFor(() => {
      expect(apiMocks.fetchCaseLesionPreviewArtifactUrl).toHaveBeenCalledWith(
        "SITE_A",
        "KERA-2026-001",
        "Initial",
        "image_1",
        "lesion_crop",
        "test-token",
      );
    });
  });

  it("overwrites an existing visit when the user confirms overwrite", async () => {
    seedDraft();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    apiMocks.createVisit.mockRejectedValueOnce(
      new Error("Visit KERA-2026-001 / Initial already exists."),
    );

    const { container } = renderWorkspace();
    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(apiMocks.updateVisit).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "KERA-2026-001",
        "Initial",
        expect.objectContaining({ visit_date: "Initial" }),
      );
      expect(apiMocks.deleteVisitImages).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "KERA-2026-001",
        "Initial",
      );
    });
  });

  it("creates an alternate follow-up visit when overwrite is declined", async () => {
    seedDraft();
    const confirmMock = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirmMock);
    apiMocks.createVisit
      .mockRejectedValueOnce(
        new Error("Visit KERA-2026-001 / Initial already exists."),
      )
      .mockResolvedValueOnce({
        patient_id: "KERA-2026-001",
        visit_date: "FU #3",
      });
    apiMocks.fetchVisits.mockResolvedValue([
      {
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: true,
        polymicrobial: false,
      },
      {
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        polymicrobial: false,
      },
      {
        patient_id: "KERA-2026-001",
        visit_date: "FU #2",
        actual_visit_date: null,
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        contact_lens_use: "none",
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        polymicrobial: false,
      },
    ]);

    const { container } = renderWorkspace();
    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(2);
      expect(apiMocks.createVisit).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "FU #3" }),
      );
      expect(apiMocks.uploadImage).toHaveBeenLastCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ visit_date: "FU #3" }),
      );
    });
  });

  it("limits desktop image upload concurrency during save so later files wait for an open slot", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    apiMocks.uploadImage.mockReset();

    let resolveFirstUpload: ((value: unknown) => void) | null = null;
    let resolveSecondUpload: ((value: unknown) => void) | null = null;
    let resolveThirdUpload: ((value: unknown) => void) | null = null;
    const firstUpload = new Promise((resolve) => {
      resolveFirstUpload = resolve;
    });
    const secondUpload = new Promise((resolve) => {
      resolveSecondUpload = resolve;
    });
    const thirdUpload = new Promise((resolve) => {
      resolveThirdUpload = resolve;
    });

    apiMocks.uploadImage
      .mockImplementationOnce(() => firstUpload)
      .mockImplementationOnce(() => secondUpload)
      .mockImplementationOnce(() => thirdUpload);

    const { container } = renderWorkspace();
    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    await addDraftImage(container);
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.uploadImage).toHaveBeenCalledTimes(2);
    });
    expect(apiMocks.uploadImage).toHaveBeenNthCalledWith(
      1,
      "SITE_A",
      "test-token",
      expect.objectContaining({
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        refresh_embeddings: false,
      }),
    );
    expect(apiMocks.uploadImage).toHaveBeenNthCalledWith(
      2,
      "SITE_A",
      "test-token",
      expect.objectContaining({
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        refresh_embeddings: false,
      }),
    );
    expect(apiMocks.uploadImage).not.toHaveBeenCalledTimes(3);
    expect(apiMocks.setRepresentativeImage).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirstUpload?.({
        image_id: "image_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(apiMocks.uploadImage).toHaveBeenCalledTimes(3);
    });
    expect(apiMocks.uploadImage).toHaveBeenNthCalledWith(
      3,
      "SITE_A",
      "test-token",
      expect.objectContaining({
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        refresh_embeddings: false,
      }),
    );

    await act(async () => {
      resolveSecondUpload?.({
        image_id: "image_2",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: false,
      });
      resolveThirdUpload?.({
        image_id: "image_3",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: false,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(apiMocks.setRepresentativeImage).not.toHaveBeenCalled();
    });
  });

  it("queues post-save embedding refresh only after all uploads complete", async () => {
    apiMocks.uploadImage.mockReset();
    apiMocks.uploadImage
      .mockResolvedValueOnce({
        image_id: "image_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: true,
      })
      .mockResolvedValueOnce({
        image_id: "image_2",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        view: "white",
        is_representative: false,
      });

    const { container } = renderWorkspace();
    await openNewCaseCanvas();
    completeRequiredIntakeFields();
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await addDraftImage(container);
    await addDraftImage(container);
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.uploadImage).toHaveBeenCalledTimes(2);
    });
    expect(apiMocks.uploadImage).toHaveBeenNthCalledWith(
      1,
      "SITE_A",
      "test-token",
      expect.objectContaining({ refresh_embeddings: false }),
    );
    expect(apiMocks.uploadImage).toHaveBeenNthCalledWith(
      2,
      "SITE_A",
      "test-token",
      expect.objectContaining({ refresh_embeddings: false }),
    );
    await waitFor(() => {
      expect(apiMocks.setRepresentativeImage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          representative_image_id: "image_1",
        },
      );
    });
    await waitFor(() => {
      expect(apiMocks.updateImageLesionBox.mock.calls).toEqual(
        expect.arrayContaining([
          [
            "SITE_A",
            "image_1",
            "test-token",
            expect.objectContaining({
              x0: expect.any(Number),
              y0: expect.any(Number),
              x1: expect.any(Number),
              y1: expect.any(Number),
            }),
          ],
          [
            "SITE_A",
            "image_2",
            "test-token",
            expect.objectContaining({
              x0: expect.any(Number),
              y0: expect.any(Number),
              x1: expect.any(Number),
              y1: expect.any(Number),
            }),
          ],
        ]),
      );
      expect(apiMocks.startLiveLesionPreview.mock.calls).toEqual(
        expect.arrayContaining([
          ["SITE_A", "image_1", "test-token"],
          ["SITE_A", "image_2", "test-token"],
        ]),
      );
    });
  });

  it("moves an edited case to the updated patient id when saving", async () => {
    renderWorkspace();

    await openSavedCase();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByRole("button", { name: "Lock intake" });
    fireEvent.change(screen.getByLabelText("Patient ID"), {
      target: { value: "17452298" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lock intake" }));
    await drawDraftLesionBox("image_1.png");
    fireEvent.click(await waitForSaveReady());

    await waitFor(() => {
      expect(apiMocks.createPatient).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          patient_id: "17452298",
        }),
      );
      expect(apiMocks.updateVisit).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "KERA-2026-001",
        "Initial",
        expect.objectContaining({
          patient_id: "17452298",
          visit_date: "Initial",
        }),
      );
      expect(apiMocks.deleteVisitImages).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "17452298",
        "Initial",
      );
      expect(apiMocks.uploadImage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          patient_id: "17452298",
          visit_date: "Initial",
        }),
      );
    });
  });

  it("returns to the patient list when browser back is used from case review", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        age: 0,
        sex: "female",
        visit_status: "active",
      },
    ]);

    renderWorkspace();
    await openSavedCase();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(await screen.findByText("Patient list")).toBeInTheDocument();
    expect(
      screen.getByText("Browse saved patients and open the latest case."),
    ).toBeInTheDocument();
  });

  it("loads patient list pages with numbered pagination", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => {
        const caseNumber = index + 1;
        const padded = String(caseNumber).padStart(3, "0");
        return {
          case_id: `case_${caseNumber}`,
          patient_id: `KERA-2026-${padded}`,
          chart_alias: "",
          local_case_code: "",
          culture_category: "bacterial",
          culture_species:
            caseNumber === 26
              ? "Pseudomonas aeruginosa"
              : "Staphylococcus aureus",
          additional_organisms: [],
          visit_date: "Initial",
          actual_visit_date: null,
          created_by_user_id: "user_researcher",
          created_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
          latest_image_uploaded_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
          image_count: 1,
          representative_image_id: `image_${caseNumber}`,
          representative_view: "white",
          age: 60,
          sex: caseNumber % 2 === 0 ? "male" : "female",
          visit_status: "active",
          is_initial_visit: true,
          smear_result: "not done",
          polymicrobial: false,
        };
      }),
    );
    apiMocks.fetchPatientListPage.mockImplementation(
      async (_siteId, _token, options = {}) => {
        const page = Number(options.page ?? 1);
        const start = (page - 1) * 25;
        const items = Array.from(
          { length: page === 1 ? 25 : 5 },
          (_, index) => {
            const caseNumber = start + index + 1;
            const padded = String(caseNumber).padStart(3, "0");
            return {
              patient_id: `KERA-2026-${padded}`,
              latest_case: {
                case_id: `case_${caseNumber}`,
                patient_id: `KERA-2026-${padded}`,
                chart_alias: "",
                local_case_code: "",
                culture_category: "bacterial",
                culture_species:
                  caseNumber === 26
                    ? "Pseudomonas aeruginosa"
                    : "Staphylococcus aureus",
                additional_organisms: [],
                visit_date: "Initial",
                actual_visit_date: null,
                created_by_user_id: "user_researcher",
                created_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
                latest_image_uploaded_at: `2026-03-${String(Math.min(caseNumber, 28)).padStart(2, "0")}T00:00:00Z`,
                image_count: 1,
                representative_image_id: `image_${caseNumber}`,
                representative_view: "white",
                age: 60,
                sex: caseNumber % 2 === 0 ? "male" : "female",
                visit_status: "active",
                is_initial_visit: true,
                smear_result: "not done",
                polymicrobial: false,
              },
              case_count: 1,
              organism_summary:
                caseNumber === 26
                  ? "Pseudomonas aeruginosa"
                  : "Staphylococcus aureus",
              representative_thumbnails: [
                {
                  case_id: `case_${caseNumber}`,
                  image_id: `image_${caseNumber}`,
                  view: "white",
                  preview_url: `/preview/image_${caseNumber}`,
                  fallback_url: `/content/image_${caseNumber}`,
                },
              ],
            };
          },
        );
        return {
          items,
          page,
          page_size: 25,
          total_count: 30,
          total_pages: 2,
        };
      },
    );

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          page: 1,
          page_size: 25,
          search: "",
          mine: false,
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "2" }));

    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          page: 2,
          page_size: 25,
          search: "",
          mine: false,
        }),
      );
    });
  });

  it("prewarms the next patient list page and renders representative thumbnails from the current response", async () => {
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            additional_organisms: [],
            visit_date: "Initial",
            actual_visit_date: null,
            created_by_user_id: "user_researcher",
            created_at: "2026-03-15T00:00:00Z",
            latest_image_uploaded_at: "2026-03-15T00:00:00Z",
            image_count: 1,
            representative_image_id: "image_1",
            representative_view: "white",
            age: 0,
            sex: "female",
            visit_status: "active",
            is_initial_visit: true,
            smear_result: "not done",
            polymicrobial: false,
          },
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnails: [
            {
              case_id: "case_1",
              image_id: "image_1",
              view: "white",
              preview_url: "/preview/image_1",
              fallback_url: "/content/image_1",
            },
          ],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 30,
      total_pages: 2,
    });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));

    expect(await screen.findByText("Patient list")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.prewarmPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          mine: false,
          page: 2,
          page_size: 25,
          search: "",
        }),
      );
    });
    expect(await screen.findByAltText("KERA-2026-001-case_1")).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/image_1"),
    );
  });

  it("shows up to three representative thumbnails before collapsing the remainder into a +N badge", async () => {
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: {
            case_id: "case_4",
            patient_id: "KERA-2026-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "fungal",
            culture_species: "Candida",
            additional_organisms: [],
            visit_date: "FU #2",
            actual_visit_date: null,
            created_by_user_id: "user_researcher",
            created_at: "2026-03-21T00:00:00Z",
            latest_image_uploaded_at: "2026-03-21T00:00:00Z",
            image_count: 4,
            representative_image_id: "image_4",
            representative_view: "white",
            age: 77,
            sex: "female",
            visit_status: "active",
            is_initial_visit: false,
            smear_result: "not done",
            polymicrobial: false,
          },
          case_count: 4,
          representative_thumbnail_count: 4,
          organism_summary: "Candida",
          representative_thumbnails: [
            {
              case_id: "case_1",
              image_id: "image_1",
              view: "white",
              preview_url: "/preview/image_1",
              fallback_url: "/content/image_1",
            },
            {
              case_id: "case_2",
              image_id: "image_2",
              view: "white",
              preview_url: "/preview/image_2",
              fallback_url: "/content/image_2",
            },
            {
              case_id: "case_3",
              image_id: "image_3",
              view: "white",
              preview_url: "/preview/image_3",
              fallback_url: "/content/image_3",
            },
          ],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));

    expect(
      await screen.findByAltText("KERA-2026-001-case_1"),
    ).toBeInTheDocument();
    expect(screen.getByAltText("KERA-2026-001-case_2")).toBeInTheDocument();
    expect(screen.getByAltText("KERA-2026-001-case_3")).toBeInTheDocument();
    expect(
      screen.queryByAltText("KERA-2026-001-case_4"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("clears the patient search and reloads the full list when list view is clicked", async () => {
    apiMocks.fetchPatientListPage.mockImplementation(
      async (_siteId, _token, options = {}) => {
        const search = String(options.search ?? "")
          .trim()
          .toLowerCase();
        const baseRow = {
          patient_id: "KERA-2026-001",
          latest_case: {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            additional_organisms: [],
            visit_date: "Initial",
            actual_visit_date: null,
            created_by_user_id: "user_researcher",
            created_at: "2026-03-15T00:00:00Z",
            latest_image_uploaded_at: "2026-03-15T00:00:00Z",
            image_count: 1,
            representative_image_id: "image_1",
            representative_view: "white",
            age: 0,
            sex: "female",
            visit_status: "active",
            is_initial_visit: true,
            smear_result: "not done",
            polymicrobial: false,
          },
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnails: [],
        };
        const items = search === "candida" ? [] : [baseRow];
        return {
          items,
          page: 1,
          page_size: 25,
          total_count: items.length,
          total_pages: 1,
        };
      },
    );

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /List view/i }));

    const searchInput = screen.getByPlaceholderText(
      "Search patient or organism",
    );
    fireEvent.change(searchInput, { target: { value: "Candida" } });

    await waitFor(() => {
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ search: "Candida" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /List view/i }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Search patient or organism"),
      ).toHaveValue("");
      expect(apiMocks.fetchPatientListPage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ search: "" }),
      );
    });
  });

  it("shows patient timeline images even when image records only match by visit date", async () => {
    renderWorkspace();
    await openSavedCase();

    await waitFor(() => {
      expect(
        apiMocks.fetchVisitImagesWithPreviews.mock.calls.some(
          ([siteId, authToken, patientId, visitDate]) =>
            siteId === "SITE_A" &&
            authToken === "test-token" &&
            patientId === "KERA-2026-001" &&
            visitDate === "Initial",
        ),
      ).toBe(true);
    });
    const previewImages = await screen.findAllByAltText("image_1");
    expect(
      previewImages.some((image) =>
        image.getAttribute("src")?.includes("/preview/image_1"),
      ),
    ).toBe(true);
    expect(
      screen.queryByText("No saved images for this visit yet."),
    ).not.toBeInTheDocument();
  });

  it("preserves protected UX: opening a saved case auto-loads other visit thumbnails in desktop mode", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        local_case_code: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        latest_image_uploaded_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        representative_view: "white",
        age: 0,
        sex: "female",
        visit_status: "active",
        is_initial_visit: true,
        smear_result: "not done",
        polymicrobial: false,
      },
      {
        case_id: "case_2",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        local_case_code: "",
        culture_category: "fungal",
        culture_species: "Candida",
        additional_organisms: [],
        visit_date: "FU #1",
        actual_visit_date: "2026-03-13",
        created_by_user_id: "user_researcher",
        created_at: "2026-03-16T00:00:00Z",
        latest_image_uploaded_at: "2026-03-16T00:00:00Z",
        image_count: 3,
        representative_image_id: "image_2",
        representative_view: "white",
        age: 0,
        sex: "female",
        visit_status: "active",
        is_initial_visit: false,
        smear_result: "not done",
        polymicrobial: false,
      },
    ]);
    apiMocks.fetchVisitImagesWithPreviews.mockImplementation(
      async (_siteId, _token, patientId: string, visitDate: string) => {
        if (patientId !== "KERA-2026-001") {
          return [];
        }
        if (visitDate === "FU #1") {
          return [
            {
              image_id: "image_2",
              visit_id: "visit_2",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_2.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_2",
              preview_url: "/preview/image_2",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-16T00:00:00Z",
              quality_scores: null,
            },
          ];
        }
        return [
          {
            image_id: "image_1",
            visit_id: "visit_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            image_path: "C:\\KERA\\image_1.png",
            view: "white",
            is_representative: true,
            content_url: "/content/image_1",
            preview_url: "/preview/image_1",
            lesion_prompt_box: null,
            uploaded_at: "2026-03-15T00:00:00Z",
            quality_scores: null,
          },
        ];
      },
    );
    apiMocks.fetchImages.mockResolvedValue([
      {
        image_id: "image_2",
        visit_id: "visit_2",
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
        image_path: "C:\\KERA\\image_2.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_2",
        preview_url: "/preview/image_2",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-16T00:00:00Z",
        quality_scores: null,
      },
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/preview/image_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);

    renderWorkspace();
    await openSavedCase();

    await waitFor(() => {
      expect(
        apiMocks.fetchImages.mock.calls.some(
          ([siteId, authToken, patientId, visitDate]) =>
            siteId === "SITE_A" &&
            authToken === "test-token" &&
            patientId === "KERA-2026-001" &&
            visitDate === undefined,
        ),
      ).toBe(true);
    });
    expect(
      await screen.findByText((content) => content.includes("FU #1")),
    ).toBeInTheDocument();
    const followUpPreview = await screen.findByAltText("image_2");
    expect(followUpPreview.getAttribute("src")).toContain("/preview/image_2");
    expect(
      screen.queryByText("Open this visit to load saved images."),
    ).not.toBeInTheDocument();
  });

  it("does not collapse the patient timeline when only the latest visit is locally seeded", async () => {
    const initialCase = {
      case_id: "case_initial",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "Initial",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-15T00:00:00Z",
      latest_image_uploaded_at: "2026-03-15T00:00:00Z",
      image_count: 1,
      representative_image_id: "image_initial",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
    };
    const followUpCase = {
      case_id: "case_fu1",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "FU #1",
      actual_visit_date: "2026-03-29",
      created_by_user_id: "user_researcher",
      created_at: "2026-03-29T07:00:00Z",
      latest_image_uploaded_at: "2026-03-29T07:00:01Z",
      image_count: 3,
      representative_image_id: "image_fu1",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: false,
      smear_result: "not done",
      polymicrobial: false,
    };
    apiMocks.fetchCases.mockImplementation(
      async (_siteId, _token, options?: { patientId?: string | null }) =>
        options?.patientId?.trim() === "KERA-2026-001"
          ? [followUpCase, initialCase]
          : [followUpCase],
    );
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: followUpCase,
          case_count: 2,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnail_count: 2,
          representative_thumbnails: [],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });
    apiMocks.fetchVisitImagesWithPreviews.mockImplementation(
      async (_siteId, _token, patientId: string, visitDate: string) => {
        if (patientId !== "KERA-2026-001") {
          return [];
        }
        if (visitDate === "FU #1") {
          return [
            {
              image_id: "image_fu1",
              visit_id: "visit_fu1",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_fu1.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_fu1",
              preview_url: "/preview/image_fu1",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:01Z",
              quality_scores: null,
            },
          ];
        }
        return [
          {
            image_id: "image_initial",
            visit_id: "visit_initial",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            image_path: "C:\\KERA\\image_initial.png",
            view: "white",
            is_representative: true,
            content_url: "/content/image_initial",
            preview_url: "/preview/image_initial",
            lesion_prompt_box: null,
            uploaded_at: "2026-03-15T00:00:00Z",
            quality_scores: null,
          },
        ];
      },
    );

    renderWorkspace();
    await openSavedCase();

    await waitFor(() => {
      expect(apiMocks.fetchCases).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ patientId: "KERA-2026-001" }),
      );
    });
    expect(await screen.findByText("2 visits")).toBeInTheDocument();
    expect((await screen.findAllByText("FU #1")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Initial")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(apiMocks.fetchImages).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        "KERA-2026-001",
        undefined,
        expect.any(AbortSignal),
      );
    }, { timeout: 3000 });
  });

  it("does not carry thumbnails from the previous patient into the newly opened patient", async () => {
    const patientAInitial = {
      case_id: "case_a_initial",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "Initial",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-15T00:00:00Z",
      latest_image_uploaded_at: "2026-03-15T00:00:00Z",
      image_count: 1,
      representative_image_id: "image_a_initial",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
    };
    const patientAFollowUp = {
      case_id: "case_a_fu1",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "FU #1",
      actual_visit_date: "2026-03-29",
      created_by_user_id: "user_researcher",
      created_at: "2026-03-29T07:00:00Z",
      latest_image_uploaded_at: "2026-03-29T07:00:01Z",
      image_count: 2,
      representative_image_id: "image_a_fu1",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: false,
      smear_result: "not done",
      polymicrobial: false,
    };
    const patientBInitial = {
      case_id: "case_b_initial",
      patient_id: "KERA-2026-002",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "Initial",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-18T00:00:00Z",
      latest_image_uploaded_at: "2026-03-18T00:00:00Z",
      image_count: 1,
      representative_image_id: "image_b_initial",
      representative_view: "white",
      age: 33,
      sex: "male",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
    };
    apiMocks.fetchCases.mockImplementation(
      async (_siteId, _token, options?: { patientId?: string | null }) => {
        const requestedPatientId = options?.patientId?.trim();
        if (requestedPatientId === "KERA-2026-001") {
          return [patientAFollowUp, patientAInitial];
        }
        if (requestedPatientId === "KERA-2026-002") {
          return [patientBInitial];
        }
        return [patientAFollowUp, patientBInitial];
      },
    );
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: patientAFollowUp,
          case_count: 2,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnail_count: 2,
          representative_thumbnails: [],
        },
        {
          patient_id: "KERA-2026-002",
          latest_case: patientBInitial,
          case_count: 1,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnail_count: 1,
          representative_thumbnails: [],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 2,
      total_pages: 1,
    });
    apiMocks.fetchVisitImagesWithPreviews.mockImplementation(
      async (_siteId, _token, patientId: string, visitDate: string) => {
        if (patientId === "KERA-2026-001" && visitDate === "FU #1") {
          return [
            {
              image_id: "image_a_fu1",
              visit_id: "visit_a_fu1",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_a_fu1.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_a_fu1",
              preview_url: "/preview/image_a_fu1",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:01Z",
              quality_scores: null,
            },
          ];
        }
        if (patientId === "KERA-2026-001" && visitDate === "Initial") {
          return [
            {
              image_id: "image_a_initial",
              visit_id: "visit_a_initial",
              patient_id: "KERA-2026-001",
              visit_date: "Initial",
              image_path: "C:\\KERA\\image_a_initial.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_a_initial",
              preview_url: "/preview/image_a_initial",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-15T00:00:00Z",
              quality_scores: null,
            },
          ];
        }
        if (patientId === "KERA-2026-002" && visitDate === "Initial") {
          return [
            {
              image_id: "image_b_initial",
              visit_id: "visit_b_initial",
              patient_id: "KERA-2026-002",
              visit_date: "Initial",
              image_path: "C:\\KERA\\image_b_initial.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_b_initial",
              preview_url: "/preview/image_b_initial",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-18T00:00:00Z",
              quality_scores: null,
            },
          ];
        }
        return [];
      },
    );
    apiMocks.fetchImages.mockImplementation(
      async (_siteId, _token, patientId?: string) => {
        if (patientId === "KERA-2026-001") {
          return [
            {
              image_id: "image_a_fu1",
              visit_id: "visit_a_fu1",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_a_fu1.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_a_fu1",
              preview_url: "/preview/image_a_fu1",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:01Z",
              quality_scores: null,
            },
            {
              image_id: "image_a_initial",
              visit_id: "visit_a_initial",
              patient_id: "KERA-2026-001",
              visit_date: "Initial",
              image_path: "C:\\KERA\\image_a_initial.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_a_initial",
              preview_url: "/preview/image_a_initial",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-15T00:00:00Z",
              quality_scores: null,
            },
          ];
        }
        if (patientId === "KERA-2026-002") {
          return [
            {
              image_id: "image_b_initial",
              visit_id: "visit_b_initial",
              patient_id: "KERA-2026-002",
              visit_date: "Initial",
              image_path: "C:\\KERA\\image_b_initial.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_b_initial",
              preview_url: "/preview/image_b_initial",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-18T00:00:00Z",
              quality_scores: null,
            },
          ];
        }
        return [];
      },
    );

    renderWorkspace();
    await openSavedCase("KERA-2026-001");

    expect((await screen.findAllByAltText("image_a_fu1")).length).toBeGreaterThan(0);
    expect((await screen.findAllByAltText("image_a_initial")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /List view/i }));
    await openSavedCase("KERA-2026-002");

    expect((await screen.findAllByAltText("image_b_initial")).length).toBeGreaterThan(0);
    expect(screen.queryAllByAltText("image_a_fu1")).toHaveLength(0);
    expect(screen.queryAllByAltText("image_a_initial")).toHaveLength(0);
  });

  it("keeps initial and follow-up thumbnails distinct when switching visits within the same patient timeline", async () => {
    const initialCase = {
      case_id: "case_initial_switch",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "Initial",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-15T00:00:00Z",
      latest_image_uploaded_at: "2026-03-15T00:00:00Z",
      image_count: 3,
      representative_image_id: "image_initial_1",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
    };
    const followUpCase = {
      case_id: "case_fu_switch",
      patient_id: "KERA-2026-001",
      chart_alias: "",
      local_case_code: "",
      culture_category: "bacterial",
      culture_species: "Staphylococcus aureus",
      additional_organisms: [],
      visit_date: "FU #1",
      actual_visit_date: null,
      created_by_user_id: "user_researcher",
      created_at: "2026-03-29T07:00:00Z",
      latest_image_uploaded_at: "2026-03-29T07:00:01Z",
      image_count: 3,
      representative_image_id: "image_fu_1",
      representative_view: "white",
      age: 20,
      sex: "female",
      visit_status: "active",
      is_initial_visit: false,
      smear_result: "not done",
      polymicrobial: false,
    };
    apiMocks.fetchCases.mockImplementation(
      async (_siteId, _token, options?: { patientId?: string | null }) =>
        options?.patientId?.trim() === "KERA-2026-001"
          ? [followUpCase, initialCase]
          : [followUpCase],
    );
    apiMocks.fetchPatientListPage.mockResolvedValue({
      items: [
        {
          patient_id: "KERA-2026-001",
          latest_case: followUpCase,
          case_count: 2,
          organism_summary: "Staphylococcus aureus",
          representative_thumbnail_count: 2,
          representative_thumbnails: [],
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });
    apiMocks.fetchVisitImagesWithPreviews.mockImplementation(
      async (_siteId, _token, patientId: string, visitDate: string) => {
        if (patientId !== "KERA-2026-001") {
          return [];
        }
        if (visitDate === "FU #1") {
          return [
            {
              image_id: "image_fu_1",
              visit_id: "visit_fu",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_fu_1.png",
              view: "white",
              is_representative: true,
              content_url: "/content/image_fu_1",
              preview_url: "/preview/image_fu_1",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:01Z",
              quality_scores: null,
            },
            {
              image_id: "image_fu_2",
              visit_id: "visit_fu",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_fu_2.png",
              view: "white",
              is_representative: false,
              content_url: "/content/image_fu_2",
              preview_url: "/preview/image_fu_2",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:02Z",
              quality_scores: null,
            },
            {
              image_id: "image_fu_3",
              visit_id: "visit_fu",
              patient_id: "KERA-2026-001",
              visit_date: "FU #1",
              image_path: "C:\\KERA\\image_fu_3.png",
              view: "fluorescein",
              is_representative: false,
              content_url: "/content/image_fu_3",
              preview_url: "/preview/image_fu_3",
              lesion_prompt_box: null,
              uploaded_at: "2026-03-29T07:00:03Z",
              quality_scores: null,
            },
          ];
        }
        return [
          {
            image_id: "image_initial_1",
            visit_id: "visit_initial",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            image_path: "C:\\KERA\\image_initial_1.png",
            view: "white",
            is_representative: true,
            content_url: "/content/image_initial_1",
            preview_url: "/preview/image_initial_1",
            lesion_prompt_box: null,
            uploaded_at: "2026-03-15T00:00:00Z",
            quality_scores: null,
          },
          {
            image_id: "image_initial_2",
            visit_id: "visit_initial",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            image_path: "C:\\KERA\\image_initial_2.png",
            view: "white",
            is_representative: false,
            content_url: "/content/image_initial_2",
            preview_url: "/preview/image_initial_2",
            lesion_prompt_box: null,
            uploaded_at: "2026-03-15T00:00:01Z",
            quality_scores: null,
          },
          {
            image_id: "image_initial_3",
            visit_id: "visit_initial",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            image_path: "C:\\KERA\\image_initial_3.png",
            view: "white",
            is_representative: false,
            content_url: "/content/image_initial_3",
            preview_url: "/preview/image_initial_3",
            lesion_prompt_box: null,
            uploaded_at: "2026-03-15T00:00:02Z",
            quality_scores: null,
          },
        ];
      },
    );
    apiMocks.fetchImages.mockResolvedValue([
      {
        image_id: "image_fu_1",
        visit_id: "visit_fu",
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
        image_path: "C:\\KERA\\image_fu_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_fu_1",
        preview_url: "/preview/image_fu_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-29T07:00:01Z",
        quality_scores: null,
      },
      {
        image_id: "image_fu_2",
        visit_id: "visit_fu",
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
        image_path: "C:\\KERA\\image_fu_2.png",
        view: "slit",
        is_representative: false,
        content_url: "/content/image_fu_2",
        preview_url: "/preview/image_fu_2",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-29T07:00:02Z",
        quality_scores: null,
      },
      {
        image_id: "image_fu_3",
        visit_id: "visit_fu",
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
        image_path: "C:\\KERA\\image_fu_3.png",
        view: "fluorescein",
        is_representative: false,
        content_url: "/content/image_fu_3",
        preview_url: "/preview/image_fu_3",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-29T07:00:03Z",
        quality_scores: null,
      },
      {
        image_id: "image_initial_1",
        visit_id: "visit_initial",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_initial_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_initial_1",
        preview_url: "/preview/image_initial_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
      {
        image_id: "image_initial_2",
        visit_id: "visit_initial",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_initial_2.png",
        view: "white",
        is_representative: false,
        content_url: "/content/image_initial_2",
        preview_url: "/preview/image_initial_2",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:01Z",
        quality_scores: null,
      },
      {
        image_id: "image_initial_3",
        visit_id: "visit_initial",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_initial_3.png",
        view: "white",
        is_representative: false,
        content_url: "/content/image_initial_3",
        preview_url: "/preview/image_initial_3",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:02Z",
        quality_scores: null,
      },
    ]);

    renderWorkspace();
    await openSavedCase("KERA-2026-001");

    expect((await screen.findAllByAltText("image_fu_1")).length).toBeGreaterThan(0);
    expect((await screen.findAllByAltText("image_initial_1")).length).toBeGreaterThan(0);

    const initialHeading = await screen.findByText("Initial");
    const initialCard = initialHeading.closest("section");
    if (!initialCard) {
      throw new Error("Unable to locate the Initial visit card.");
    }
    fireEvent.click(within(initialCard).getByRole("button", { name: "Open visit" }));

    await screen.findByRole("button", { name: "Current visit" });
    expect((await screen.findAllByAltText("image_initial_1")).length).toBeGreaterThan(0);
    expect((await screen.findAllByAltText("image_fu_1")).length).toBeGreaterThan(0);
    expect(screen.queryAllByAltText("image_initial_3").length).toBeGreaterThan(0);
    expect(screen.queryAllByAltText("image_fu_3").length).toBeGreaterThan(0);
  });

  it("loads saved images correctly in React Strict Mode", async () => {
    renderWorkspace(undefined, {}, undefined, { strictMode: true });
    await openSavedCase();

    await waitFor(() => {
      expect(
        apiMocks.fetchVisitImagesWithPreviews.mock.calls.some(
          ([siteId, authToken, patientId, visitDate]) =>
            siteId === "SITE_A" &&
            authToken === "test-token" &&
            patientId === "KERA-2026-001" &&
            visitDate === "Initial",
        ),
      ).toBe(true);
    });
    expect(screen.getAllByText("1 images").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        screen.queryByText("No saved images are attached to this case yet."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("No saved images for this visit yet."),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps saved images visible when the visit-image response already carries preview URLs", async () => {
    apiMocks.fetchVisitImagesWithPreviews.mockResolvedValue([
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/content/image_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);

    renderWorkspace();
    await openSavedCase();

    const previewImages = await screen.findAllByAltText("image_1");
    expect(
      previewImages.some((image) =>
        image.getAttribute("src")?.includes("/content/image_1"),
      ),
    ).toBe(true);
    expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
  });

  it("keeps saved previews visible when switching the representative image", async () => {
    let currentCases = [
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        local_case_code: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        latest_image_uploaded_at: "2026-03-15T00:00:00Z",
        image_count: 2,
        representative_image_id: "image_1",
        representative_view: "white",
        age: 0,
        sex: "female",
        visit_status: "active",
        is_initial_visit: true,
        smear_result: "not done",
        polymicrobial: false,
      },
    ];
    apiMocks.fetchCases.mockImplementation(async () => currentCases);
    apiMocks.fetchVisitImagesWithPreviews.mockResolvedValue([
      {
        image_id: "image_1",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_1.png",
        view: "white",
        is_representative: true,
        content_url: "/content/image_1",
        preview_url: "/preview/image_1",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
      {
        image_id: "image_2",
        visit_id: "visit_1",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        image_path: "C:\\KERA\\image_2.png",
        view: "fluorescein",
        is_representative: false,
        content_url: "/content/image_2",
        preview_url: "/preview/image_2",
        lesion_prompt_box: null,
        uploaded_at: "2026-03-15T00:00:00Z",
        quality_scores: null,
      },
    ]);
    apiMocks.setRepresentativeImage.mockImplementation(async () => {
      currentCases = [
        {
          ...currentCases[0],
          representative_image_id: "image_2",
          representative_view: "fluorescein",
        },
      ];
    });

    renderWorkspace();
    await openSavedCase();

    const initialImage1Previews = await screen.findAllByAltText("image_1");
    const initialImage2Previews = await screen.findAllByAltText("image_2");
    expect(
      initialImage1Previews.some((image) =>
        image.getAttribute("src")?.includes("/preview/image_1"),
      ),
    ).toBe(true);
    expect(
      initialImage2Previews.some((image) =>
        image.getAttribute("src")?.includes("/preview/image_2"),
      ),
    ).toBe(true);
    expect(apiMocks.fetchVisitImagesWithPreviews).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole("button", { name: "Set representative" }));

    await waitFor(() => {
      expect(apiMocks.setRepresentativeImage).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          representative_image_id: "image_2",
        },
      );
    });
    await waitFor(() => {
      expect(apiMocks.fetchCases).toHaveBeenCalledTimes(3);
    });
    expect(apiMocks.fetchVisitImagesWithPreviews).toHaveBeenCalledTimes(1);

    const updatedImage2Preview = (await screen.findAllByAltText("image_2"))[0];
    expect(updatedImage2Preview).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/image_2"),
    );
    const image2Card = updatedImage2Preview.closest("section");
    expect(image2Card).not.toBeNull();
    expect(
      within(image2Card!).getByText("Representative image"),
    ).toBeInTheDocument();
  });

  it("shows the MedSAM backlog cards and starts background backfill from list view", async () => {
    apiMocks.fetchMedsamArtifactStatus.mockResolvedValue({
      site_id: "SITE_A",
      total: { patients: 1, visits: 1, images: 1 },
      statuses: {
        missing_lesion_box: { patients: 0, visits: 0, images: 0 },
        missing_roi: { patients: 1, visits: 1, images: 1 },
        missing_lesion_crop: { patients: 1, visits: 1, images: 1 },
        medsam_backfill_ready: { patients: 1, visits: 1, images: 1 },
      },
      active_job: null,
      last_synced_at: "2026-03-15T00:00:00Z",
    });
    apiMocks.fetchMedsamArtifactItems.mockResolvedValue({
      scope: "visit",
      status: "missing_roi",
      items: [
        {
          scope: "visit",
          patient_id: "HTTP-001",
          visit_date: "Initial",
          image_count: 1,
          visit_count: 1,
          missing_lesion_box_count: 0,
          missing_roi_count: 1,
          missing_lesion_crop_count: 1,
          medsam_backfill_ready_count: 1,
          case_summary: {
            case_id: "case_1",
            patient_id: "HTTP-001",
            chart_alias: "",
            local_case_code: "",
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            additional_organisms: [],
            visit_date: "Initial",
            actual_visit_date: null,
            created_by_user_id: "user_researcher",
            created_at: "2026-03-15T00:00:00Z",
            latest_image_uploaded_at: "2026-03-15T00:00:00Z",
            image_count: 1,
            representative_image_id: "image_1",
            representative_view: "white",
            age: 60,
            sex: "female",
            visit_status: "active",
            is_initial_visit: true,
            smear_result: "not done",
            polymicrobial: false,
          },
        },
      ],
      page: 1,
      page_size: 25,
      total_count: 1,
      total_pages: 1,
    });

    renderWorkspace();

    expect(await screen.findByText("Artifact backlog")).toBeInTheDocument();
    expect(
      screen.getByText("Artifact backlog stays idle until you enable it."),
    ).toBeInTheDocument();
    expect(apiMocks.fetchMedsamArtifactStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable backlog" }));
    await waitFor(() => {
      expect(apiMocks.fetchMedsamArtifactStatus).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ mine: false, refresh: true }),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Cornea ROI missing/i }),
    );

    expect(
      await screen.findByText(
        "Review cases where corneal ROI artifacts are still missing.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear filter" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.fetchMedsamArtifactItems).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({
          scope: "visit",
          status_key: "missing_roi",
          page: 1,
          page_size: 25,
          mine: false,
        }),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Cornea ROI missing/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Review cases where corneal ROI artifacts are still missing.",
        ),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Backfill" }));

    await waitFor(() => {
      expect(apiMocks.backfillMedsamArtifacts).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          mine: false,
          refresh_cache: true,
        },
      );
    });
    await waitFor(() => {
      expect(apiMocks.fetchMedsamArtifactStatus).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ mine: false, refresh: true }),
      );
    });
  });

  it("collapses the backlog panel into a summary when all artifact counts are zero", async () => {
    renderWorkspace();

    expect(await screen.findByText("Artifact backlog")).toBeInTheDocument();
    expect(
      screen.getByText("Artifact backlog stays idle until you enable it."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable backlog" }));
    await waitFor(() => {
      expect(apiMocks.fetchMedsamArtifactStatus).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.objectContaining({ mine: false, refresh: true }),
      );
    });
    expect(screen.getByText("No artifact backlog")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lesion box missing/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cornea ROI missing/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lesion crop missing/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /MedSAM backlog/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Backfill" }),
    ).not.toBeInTheDocument();
  });

  it("does not auto-load site activity in the workspace list view", async () => {
    renderWorkspace();

    expect(await screen.findByText("Artifact backlog")).toBeInTheDocument();
    expect(
      screen.getByText("Artifact backlog stays idle until you enable it."),
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    });

    expect(apiMocks.fetchSiteActivity).not.toHaveBeenCalled();
    expect(apiMocks.fetchCases).not.toHaveBeenCalled();
    expect(apiMocks.fetchMedsamArtifactStatus).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Recent validation and contribution flow"),
    ).not.toBeInTheDocument();
  });

  it("keeps the backlog panel in the patient list sidebar during desktop fast mode", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);

    renderWorkspace(undefined, {
      n_patients: 22,
      n_visits: 43,
      n_images: 112,
      n_validation_runs: 7,
    });

    expect(await screen.findByText("Artifact backlog")).toBeInTheDocument();
    const hospitalSection = screen.getByText("Hospital").closest("section");
    if (!hospitalSection) {
      throw new Error("Unable to find the hospital rail section.");
    }
    expect(within(hospitalSection).getByText("22")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("43")).toBeInTheDocument();
    expect(within(hospitalSection).getByText("112")).toBeInTheDocument();
    expect(
      within(hospitalSection).queryByText("validations"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable backlog" }),
    ).toBeInTheDocument();
    expect(apiMocks.fetchMedsamArtifactStatus).not.toHaveBeenCalled();
  });

  it("uses multi-model compare as the primary AI validation flow", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        age: 0,
        sex: "female",
        visit_status: "active",
      },
    ]);
    apiMocks.fetchSiteModelVersions.mockResolvedValue([
      {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        ready: true,
      },
      {
        version_id: "model_swin",
        version_name: "swin-v1",
        architecture: "swin",
        ready: true,
      },
      {
        version_id: "model_dinov2",
        version_name: "dinov2-v1",
        architecture: "dinov2",
        ready: true,
      },
      {
        version_id: "model_dinov2_mil",
        version_name: "dinov2-mil-v1",
        architecture: "dinov2_mil",
        ready: true,
      },
      {
        version_id: "model_convnext",
        version_name: "conv-v1",
        architecture: "convnext_tiny",
        ready: true,
      },
      {
        version_id: "model_dense",
        version_name: "dense-v1",
        architecture: "densenet121",
        ready: true,
      },
      {
        version_id: "model_eff",
        version_name: "eff-v1",
        architecture: "efficientnet_v2_s",
        ready: true,
      },
      {
        version_id: "model_lgf_eff",
        version_name: "lgf-eff-v1",
        architecture: "lesion_guided_fusion__efficientnet_v2_s",
        ready: true,
      },
      {
        version_id: "model_analysis_temp",
        version_name: "analysis-temp",
        architecture: "multi_model_ensemble",
        stage: "analysis",
        ready: true,
      },
    ]);
    apiMocks.runCaseValidationCompare.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      execution_device: "cpu",
      comparisons: [
        {
          summary: {
            validation_id: "cmp_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.81,
            is_correct: false,
          },
          model_version: {
            version_id: "model_vit",
            version_name: "vit-v1",
            architecture: "vit",
            crop_mode: "automated",
          },
          artifact_availability: {
            gradcam: false,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
        },
        {
          summary: {
            validation_id: "cmp_2",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.77,
            is_correct: false,
          },
          model_version: {
            version_id: "model_swin",
            version_name: "swin-v1",
            architecture: "swin",
            crop_mode: "automated",
          },
          artifact_availability: {
            gradcam: false,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
        },
        {
          summary: {
            validation_id: "cmp_3",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.79,
            is_correct: false,
          },
          model_version: {
            version_id: "model_convnext",
            version_name: "conv-v1",
            architecture: "convnext_tiny",
            crop_mode: "automated",
          },
          artifact_availability: {
            gradcam: false,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
        },
        {
          summary: {
            validation_id: "cmp_4",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "bacterial",
            true_label: "bacterial",
            prediction_probability: 0.41,
            is_correct: true,
          },
          model_version: {
            version_id: "model_dense",
            version_name: "dense-v1",
            architecture: "densenet121",
            crop_mode: "automated",
          },
          artifact_availability: {
            gradcam: false,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
        },
        {
          summary: {
            validation_id: "cmp_5",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            predicted_label: "fungal",
            true_label: "bacterial",
            prediction_probability: 0.74,
            is_correct: false,
          },
          model_version: {
            version_id: "model_eff",
            version_name: "eff-v1",
            architecture: "efficientnet_v2_s",
            crop_mode: "automated",
          },
          artifact_availability: {
            gradcam: false,
            gradcam_cornea: false,
            gradcam_lesion: false,
            roi_crop: false,
            medsam_mask: false,
            lesion_crop: false,
            lesion_mask: false,
          },
        },
      ],
    });

    renderWorkspace();

    expect(apiMocks.fetchSiteModelVersions).not.toHaveBeenCalled();
    await openSavedCase();

    await waitFor(() => {
      expect(apiMocks.fetchSiteModelVersions).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("vit")).toBeInTheDocument();
    expect(screen.getByText("lgf-eff-v1")).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Run AI validation" }),
    );

    await waitFor(() => {
      expect(apiMocks.runCaseValidationCompare).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          model_version_ids: [
            "model_vit",
            "model_swin",
            "model_dinov2",
            "model_dinov2_mil",
            "model_convnext",
            "model_dense",
            "model_eff",
            "model_lgf_eff",
          ],
          execution_mode: "auto",
        },
      );
    });

    await waitFor(() => {
      expect(apiMocks.runCaseValidation).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          execution_mode: "cpu",
          model_version_id: "model_vit",
        },
      );
    });

    expect(await screen.findByText("Consensus snapshot")).toBeInTheDocument();
    expect(screen.getAllByText("4 / 5").length).toBeGreaterThan(0);
  });

  it("renders prediction post-mortem after AI validation", async () => {
    renderWorkspace();
    await openSavedCase();

    fireEvent.click(
      await screen.findByRole("button", { name: "Run AI validation" }),
    );

    expect(
      await screen.findByText("Prediction post-mortem"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The model favored fungal, but the available evidence suggests the case should be reviewed as a boundary miss.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Boundary-case review")).toBeInTheDocument();
    expect(
      screen.getByText("Culture confirmed a bacterial label."),
    ).toBeInTheDocument();
    expect(screen.getByText("Structured analysis")).toBeInTheDocument();
    expect(screen.getByText("Boundary case")).toBeInTheDocument();
  });

  it("runs AI Clinic in staged similar-cases then expanded-evidence flow", async () => {
    apiMocks.fetchSiteModelVersions.mockResolvedValue([
      {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        ready: true,
      },
      {
        version_id: "model_swin",
        version_name: "swin-v1",
        architecture: "swin",
        ready: true,
      },
      {
        version_id: "model_dinov2",
        version_name: "dinov2-v1",
        architecture: "dinov2",
        ready: true,
      },
      {
        version_id: "model_dinov2_mil",
        version_name: "dinov2-mil-v1",
        architecture: "dinov2_mil",
        ready: true,
      },
      {
        version_id: "model_convnext",
        version_name: "conv-v1",
        architecture: "convnext_tiny",
        ready: true,
      },
      {
        version_id: "model_dense",
        version_name: "dense-v1",
        architecture: "densenet121",
        ready: true,
      },
      {
        version_id: "model_eff",
        version_name: "eff-v1",
        architecture: "efficientnet_v2_s",
        ready: true,
      },
    ]);
    apiMocks.runCaseValidationCompare.mockResolvedValue({
      patient_id: "KERA-2026-001",
      visit_date: "Initial",
      execution_device: "cpu",
      comparisons: [
        {
          model_version: {
            version_id: "model_vit",
            version_name: "vit-v1",
            architecture: "vit",
            crop_mode: "automated",
          },
          summary: {
            predicted_label: "fungal",
            prediction_probability: 0.81,
            model_version: "vit-v1",
          },
          error: null,
        },
      ],
    });
    apiMocks.runCaseValidation.mockResolvedValue({
      summary: {
        validation_id: "validation_ai_clinic",
        patient_id: "KERA-2026-001",
        visit_date: "Initial",
        predicted_label: "fungal",
        true_label: null,
        prediction_probability: 0.82,
        is_correct: null,
      },
      case_prediction: null,
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        requires_medsam_crop: false,
        crop_mode: "automated",
        ensemble_mode: null,
      },
      execution_device: "cpu",
      artifact_availability: {
        gradcam: false,
        gradcam_cornea: false,
        gradcam_lesion: false,
        roi_crop: false,
        medsam_mask: false,
        lesion_crop: false,
        lesion_mask: false,
      },
      post_mortem: null,
    });

    renderWorkspace();
    await openSavedCase();
    await waitFor(() => {
      expect(apiMocks.fetchSiteModelVersions).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("vit")).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Run AI validation" }),
    );

    await waitFor(() => {
      expect(apiMocks.runCaseValidationCompare).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Find similar cases" }),
      ).not.toBeDisabled();
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Find similar cases" }),
    );

    await waitFor(() => {
      expect(apiMocks.runCaseAiClinicSimilarCases).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          execution_mode: "cpu",
          model_version_id: "model_vit",
          top_k: 3,
          retrieval_backend: "classifier",
        },
      );
    });

    expect(await screen.findByText("Expanded evidence")).toBeInTheDocument();
    expect(screen.getByText("SIM-001")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Load evidence" }));

    await waitFor(() => {
      expect(apiMocks.runCaseAiClinic).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          execution_mode: "cpu",
          model_version_id: "model_vit",
          top_k: 3,
          retrieval_backend: "classifier",
        },
      );
    });

    expect(
      await screen.findByText("Retrieved text evidence"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Dense stromal infiltrate with satellite lesions."),
    ).toBeInTheDocument();
    expect(screen.getByText("Workflow recommendation")).toBeInTheDocument();
  });

  it("submits contribution with the selected five-model set", async () => {
    apiMocks.fetchCases.mockReset();
    apiMocks.fetchCases.mockResolvedValue([
      {
        case_id: "case_1",
        patient_id: "KERA-2026-001",
        chart_alias: "",
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
        additional_organisms: [],
        visit_date: "Initial",
        actual_visit_date: null,
        created_by_user_id: "user_researcher",
        created_at: "2026-03-15T00:00:00Z",
        image_count: 1,
        representative_image_id: "image_1",
        age: 0,
        sex: "female",
        visit_status: "active",
      },
    ]);
    apiMocks.fetchSiteModelVersions.mockResolvedValue([
      {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
        ready: true,
      },
      {
        version_id: "model_swin",
        version_name: "swin-v1",
        architecture: "swin",
        ready: true,
      },
      {
        version_id: "model_dinov2",
        version_name: "dinov2-v1",
        architecture: "dinov2",
        ready: true,
      },
      {
        version_id: "model_dinov2_mil",
        version_name: "dinov2-mil-v1",
        architecture: "dinov2_mil",
        ready: true,
      },
      {
        version_id: "model_convnext",
        version_name: "conv-v1",
        architecture: "convnext_tiny",
        ready: true,
      },
      {
        version_id: "model_dense",
        version_name: "dense-v1",
        architecture: "densenet121",
        ready: true,
      },
      {
        version_id: "model_eff",
        version_name: "eff-v1",
        architecture: "efficientnet_v2_s",
        ready: true,
      },
    ]);
    apiMocks.runCaseContribution.mockResolvedValue({
      update: {
        update_id: "update_1",
        site_id: "SITE_A",
        base_model_version_id: "model_vit",
        architecture: "vit",
        upload_type: "weight delta",
        execution_device: "cpu",
        artifact_path: "C:\\KERA\\delta_1.pth",
        n_cases: 1,
        contributed_by: "user_researcher",
        case_reference_id: "case_ref_1",
        created_at: "2026-03-15T00:00:00Z",
        training_input_policy: "medsam_cornea_crop_only",
        training_summary: {},
        status: "pending_review",
      },
      updates: [
        {
          update_id: "update_1",
          site_id: "SITE_A",
          base_model_version_id: "model_vit",
          architecture: "vit",
          upload_type: "weight delta",
          execution_device: "cpu",
          artifact_path: "C:\\KERA\\delta_1.pth",
          n_cases: 1,
          contributed_by: "user_researcher",
          case_reference_id: "case_ref_1",
          created_at: "2026-03-15T00:00:00Z",
          training_input_policy: "medsam_cornea_crop_only",
          training_summary: {},
          status: "pending_review",
          crop_mode: "automated",
        },
      ],
      update_count: 1,
      visit_status: "active",
      execution_device: "cpu",
      model_version: {
        version_id: "model_vit",
        version_name: "vit-v1",
        architecture: "vit",
      },
      model_versions: [
        {
          version_id: "model_vit",
          version_name: "vit-v1",
          architecture: "vit",
          crop_mode: "automated",
          ensemble_mode: null,
        },
      ],
      failures: [],
      stats: {
        total_contributions: 1,
        user_contributions: 1,
        user_contribution_pct: 100,
        current_model_version: "global-http-seed",
      },
    });

    renderWorkspace();

    expect(apiMocks.fetchSiteModelVersions).not.toHaveBeenCalled();
    await openSavedCase();

    await waitFor(() => {
      expect(apiMocks.fetchSiteModelVersions).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("vit")).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Contribute case update" }),
    );

    await waitFor(() => {
      expect(apiMocks.runCaseContribution).toHaveBeenCalledWith(
        "SITE_A",
        "test-token",
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          execution_mode: "auto",
          model_version_id: undefined,
          model_version_ids: [
            "model_vit",
            "model_swin",
            "model_dinov2",
            "model_dinov2_mil",
            "model_convnext",
            "model_dense",
            "model_eff",
          ],
        },
      );
    });
  });
});
