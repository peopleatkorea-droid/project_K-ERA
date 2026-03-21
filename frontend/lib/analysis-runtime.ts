"use client";

import { request, requestBlob } from "./api-core";
import { hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";
import { warnDesktopMlFallback } from "./desktop-sidecar-config";
import type {
  AiClinicResponse,
  CaseContributionResponse,
  CaseValidationCompareResponse,
  CaseValidationResponse,
  LesionPreviewRecord,
  LiveLesionPreviewJobResponse,
  RoiPreviewRecord,
  SemanticPromptInputMode,
  SemanticPromptReviewResponse,
  SiteJobRecord,
} from "./types";

type DesktopBinaryResponse = {
  bytes: number[];
  media_type?: string | null;
};

function canUseDesktopAnalysisTransport() {
  return hasDesktopRuntime();
}

function desktopBinaryToBlob(response: DesktopBinaryResponse) {
  return new Blob([new Uint8Array(response.bytes ?? [])], {
    type: response.media_type?.trim() || "application/octet-stream",
  });
}

function warnAnalysisFallback(operation: string) {
  warnDesktopMlFallback(operation);
}

export async function runAnalysisCaseValidation(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    model_version_ids?: string[];
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  },
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<CaseValidationResponse>("run_case_validation", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  warnAnalysisFallback("runCaseValidation");
  return request<CaseValidationResponse>(
    `/api/sites/${siteId}/cases/validate`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        generate_gradcam: true,
        generate_medsam: true,
        ...payload,
      }),
    },
    token,
  );
}

export async function runAnalysisCaseValidationCompare(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    model_version_ids: string[];
    execution_mode?: "auto" | "cpu" | "gpu";
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  },
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<CaseValidationCompareResponse>("run_case_validation_compare", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  warnAnalysisFallback("runCaseValidationCompare");
  return request<CaseValidationCompareResponse>(
    `/api/sites/${siteId}/cases/validate/compare`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        generate_gradcam: false,
        generate_medsam: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function runAnalysisCaseAiClinic(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    model_version_ids?: string[];
    top_k?: number;
    retrieval_backend?: "standard" | "classifier" | "dinov2" | "hybrid";
  },
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<AiClinicResponse>("run_case_ai_clinic", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  warnAnalysisFallback("runCaseAiClinic");
  return request<AiClinicResponse>(
    `/api/sites/${siteId}/cases/ai-clinic`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        top_k: 3,
        retrieval_backend: "standard",
        ...payload,
      }),
    },
    token,
  );
}

export async function runAnalysisCaseContribution(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    model_version_ids?: string[];
  },
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<CaseContributionResponse>("run_case_contribution", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  warnAnalysisFallback("runCaseContribution");
  return request<CaseContributionResponse>(
    `/api/sites/${siteId}/cases/contribute`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchAnalysisSiteJob(siteId: string, jobId: string, token: string) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<SiteJobRecord>("fetch_site_job", {
      payload: {
        site_id: siteId,
        token,
        job_id: jobId,
      },
    });
  }
  warnAnalysisFallback("fetchSiteJob");
  return request<SiteJobRecord>(`/api/sites/${siteId}/jobs/${jobId}`, {}, token);
}

export async function fetchAnalysisCaseRoiPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<RoiPreviewRecord[]>("fetch_case_roi_preview", {
      payload: {
        site_id: siteId,
        token,
        patient_id: patientId,
        visit_date: visitDate,
      },
    });
  }
  warnAnalysisFallback("fetchCaseRoiPreview");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<RoiPreviewRecord[]>(`/api/sites/${siteId}/cases/roi-preview?${params.toString()}`, {}, token);
}

export async function fetchAnalysisCaseLesionPreview(
  siteId: string,
  patientId: string,
  visitDate: string,
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<LesionPreviewRecord[]>("fetch_case_lesion_preview", {
      payload: {
        site_id: siteId,
        token,
        patient_id: patientId,
        visit_date: visitDate,
      },
    });
  }
  warnAnalysisFallback("fetchCaseLesionPreview");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<LesionPreviewRecord[]>(`/api/sites/${siteId}/cases/lesion-preview?${params.toString()}`, {}, token);
}

export async function fetchAnalysisStoredCaseLesionPreview(
  siteId: string,
  patientId: string,
  visitDate: string,
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<LesionPreviewRecord[]>("list_stored_case_lesion_previews", {
      payload: {
        site_id: siteId,
        patient_id: patientId,
        visit_date: visitDate,
      },
    });
  }
  warnAnalysisFallback("fetchStoredCaseLesionPreview");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<LesionPreviewRecord[]>(`/api/sites/${siteId}/cases/lesion-preview/stored?${params.toString()}`, {}, token);
}

export async function fetchAnalysisValidationArtifactBlob(
  siteId: string,
  validationId: string,
  patientId: string,
  visitDate: string,
  artifactKind: "gradcam" | "gradcam_cornea" | "gradcam_lesion" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask",
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    const response = await invokeDesktop<DesktopBinaryResponse>("read_validation_artifact", {
      payload: {
        site_id: siteId,
        validation_id: validationId,
        patient_id: patientId,
        visit_date: visitDate,
        artifact_kind: artifactKind,
      },
    });
    return desktopBinaryToBlob(response);
  }
  warnAnalysisFallback("fetchValidationArtifactBlob");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return requestBlob(
    `/api/sites/${siteId}/validations/${validationId}/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "Artifact fetch failed",
  );
}

export async function fetchAnalysisCaseRoiPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    const response = await invokeDesktop<DesktopBinaryResponse>("read_case_roi_preview_artifact", {
      payload: {
        site_id: siteId,
        patient_id: patientId,
        visit_date: visitDate,
        image_id: imageId,
        artifact_kind: artifactKind,
      },
    });
    return desktopBinaryToBlob(response);
  }
  warnAnalysisFallback("fetchCaseRoiPreviewArtifactBlob");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  return requestBlob(
    `/api/sites/${siteId}/cases/roi-preview/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "ROI preview fetch failed",
  );
}

export async function fetchAnalysisCaseLesionPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    const response = await invokeDesktop<DesktopBinaryResponse>("read_case_lesion_preview_artifact", {
      payload: {
        site_id: siteId,
        patient_id: patientId,
        visit_date: visitDate,
        image_id: imageId,
        artifact_kind: artifactKind,
      },
    });
    return desktopBinaryToBlob(response);
  }
  warnAnalysisFallback("fetchCaseLesionPreviewArtifactBlob");
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  return requestBlob(
    `/api/sites/${siteId}/cases/lesion-preview/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "Lesion preview fetch failed",
  );
}

export async function startAnalysisLiveLesionPreview(siteId: string, imageId: string, token: string) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<LiveLesionPreviewJobResponse>("start_live_lesion_preview", {
      payload: {
        site_id: siteId,
        token,
        image_id: imageId,
      },
    });
  }
  warnAnalysisFallback("startLiveLesionPreview");
  return request<LiveLesionPreviewJobResponse>(
    `/api/sites/${siteId}/images/${imageId}/lesion-live-preview`,
    {
      method: "POST",
    },
    token,
  );
}

export async function fetchAnalysisLiveLesionPreviewJob(
  siteId: string,
  imageId: string,
  jobId: string,
  token: string,
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<LiveLesionPreviewJobResponse>("fetch_live_lesion_preview_job", {
      payload: {
        site_id: siteId,
        token,
        image_id: imageId,
        job_id: jobId,
      },
    });
  }
  warnAnalysisFallback("fetchLiveLesionPreviewJob");
  return request<LiveLesionPreviewJobResponse>(
    `/api/sites/${siteId}/images/${imageId}/lesion-live-preview/jobs/${jobId}`,
    {},
    token,
  );
}

export async function fetchAnalysisSemanticPromptScores(
  siteId: string,
  imageId: string,
  token: string,
  options: {
    top_k?: number;
    input_mode?: SemanticPromptInputMode;
  } = {},
) {
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<SemanticPromptReviewResponse>("fetch_image_semantic_prompt_scores", {
      payload: {
        site_id: siteId,
        token,
        image_id: imageId,
        top_k: options.top_k ?? 3,
        input_mode: options.input_mode ?? "source",
      },
    });
  }
  warnAnalysisFallback("fetchImageSemanticPromptScores");
  const params = new URLSearchParams();
  params.set("top_k", String(options.top_k ?? 3));
  params.set("input_mode", options.input_mode ?? "source");
  return request<SemanticPromptReviewResponse>(
    `/api/sites/${siteId}/images/${imageId}/semantic-prompts?${params.toString()}`,
    {},
    token,
  );
}
