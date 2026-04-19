"use client";

import { request, requestBlob } from "./api-core";
import { convertDesktopFilePath, hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiJson } from "./desktop-local-api";
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
  data?: string | null;
  bytes?: number[] | null;
  media_type?: string | null;
};

type DesktopPathResponse = {
  path: string;
};

type ValidationArtifactKind =
  | "gradcam"
  | "gradcam_cornea"
  | "gradcam_lesion"
  | "roi_crop"
  | "medsam_mask"
  | "lesion_crop"
  | "lesion_mask";

const DESKTOP_ARTIFACT_PREVIEW_MAX_SIDE = 560;

function canUseDesktopAnalysisTransport() {
  return hasDesktopRuntime();
}

function desktopBinaryToBlob(response: DesktopBinaryResponse) {
  let bytes: Uint8Array;
  if (typeof response.data === "string" && response.data.length > 0) {
    const binary = atob(response.data);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } else {
    bytes = new Uint8Array(response.bytes ?? []);
  }
  const normalizedBytes = new Uint8Array(bytes.byteLength);
  normalizedBytes.set(bytes);
  return new Blob([normalizedBytes], {
    type: response.media_type?.trim() || "application/octet-stream",
  });
}

function warnAnalysisFallback(operation: string) {
  warnDesktopMlFallback(operation);
}

async function requestAiClinicHttp<T>(
  siteId: string,
  token: string,
  path: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    model_version_ids?: string[];
    top_k?: number;
    retrieval_backend?: "standard" | "classifier" | "dinov2" | "hybrid";
    retrieval_profile?: "dinov2_lesion_crop" | "dinov2_cornea_roi" | "dinov2_full_frame";
  },
) {
  return request<T>(
    `/api/sites/${siteId}${path}`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        top_k: 3,
        retrieval_backend: "dinov2",
        retrieval_profile: "dinov2_lesion_crop",
        ...payload,
      }),
    },
    token,
  );
}

async function resolveDesktopArtifactUrl(command: string, payload: Record<string, unknown>) {
  const response = await invokeDesktop<DesktopPathResponse>(command, { payload });
  return convertDesktopFilePath(response.path);
}

function appendArtifactVersion(url: string | null, versionTag: string | null | undefined) {
  if (!url || !versionTag || url.startsWith("blob:")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}kera_v=${encodeURIComponent(versionTag)}`;
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
    selection_profile?: "single_case_review" | "visit_level_review";
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
    model_version_ids?: string[];
    selection_profile?: "single_case_review" | "visit_level_review";
    execution_mode?: "auto" | "cpu" | "gpu";
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  },
) {
  const normalizedModelVersionIds = Array.isArray(payload.model_version_ids)
    ? payload.model_version_ids
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0)
    : undefined;
  const normalizedPayload = {
    ...payload,
    model_version_ids:
      normalizedModelVersionIds && normalizedModelVersionIds.length > 0
        ? normalizedModelVersionIds
        : undefined,
  };
  if (canUseDesktopAnalysisTransport()) {
    return invokeDesktop<CaseValidationCompareResponse>("run_case_validation_compare", {
      payload: {
        site_id: siteId,
        token,
        ...normalizedPayload,
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
        ...normalizedPayload,
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
    retrieval_profile?: "dinov2_lesion_crop" | "dinov2_cornea_roi" | "dinov2_full_frame";
  },
) {
  const normalizedPayload = {
    ...payload,
    retrieval_backend: payload.retrieval_backend ?? "dinov2",
    retrieval_profile: payload.retrieval_profile ?? "dinov2_lesion_crop",
  };
  if (canUseDesktopAnalysisTransport()) {
    try {
      return await invokeDesktop<AiClinicResponse>("run_case_ai_clinic", {
        payload: {
          site_id: siteId,
          token,
          ...normalizedPayload,
        },
      });
    } catch {
      return requestAiClinicHttp<AiClinicResponse>(
        siteId,
        token,
        "/cases/ai-clinic",
        normalizedPayload,
      );
    }
  }
  warnAnalysisFallback("runCaseAiClinic");
  return requestAiClinicHttp<AiClinicResponse>(
    siteId,
    token,
    "/cases/ai-clinic",
    normalizedPayload,
  );
}

export async function runAnalysisCaseAiClinicSimilarCases(
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
    retrieval_profile?: "dinov2_lesion_crop" | "dinov2_cornea_roi" | "dinov2_full_frame";
  },
) {
  const normalizedPayload = {
    ...payload,
    retrieval_backend: payload.retrieval_backend ?? "dinov2",
    retrieval_profile: payload.retrieval_profile ?? "dinov2_lesion_crop",
  };
  if (canUseDesktopAnalysisTransport()) {
    try {
      return await invokeDesktop<AiClinicResponse>("run_case_ai_clinic_similar_cases", {
        payload: {
          site_id: siteId,
          token,
          ...normalizedPayload,
        },
      });
    } catch {
      return requestAiClinicHttp<AiClinicResponse>(
        siteId,
        token,
        "/cases/ai-clinic/similar-cases",
        normalizedPayload,
      );
    }
  }
  warnAnalysisFallback("runCaseAiClinicSimilarCases");
  return requestAiClinicHttp<AiClinicResponse>(
    siteId,
    token,
    "/cases/ai-clinic/similar-cases",
    normalizedPayload,
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
  artifactKind: ValidationArtifactKind,
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

export async function fetchAnalysisValidationArtifactUrl(
  siteId: string,
  validationId: string,
  patientId: string,
  visitDate: string,
  artifactKind: ValidationArtifactKind,
  token: string,
  options: {
    previewMaxSide?: number;
  } = {},
) {
  if (canUseDesktopAnalysisTransport()) {
    const url = await resolveDesktopArtifactUrl("resolve_validation_artifact_path", {
      site_id: siteId,
      validation_id: validationId,
      patient_id: patientId,
      visit_date: visitDate,
      artifact_kind: artifactKind,
      preview_max_side:
        options.previewMaxSide ?? DESKTOP_ARTIFACT_PREVIEW_MAX_SIDE,
    });
    return appendArtifactVersion(url, `${validationId}:${artifactKind}`);
  }
  const blob = await fetchAnalysisValidationArtifactBlob(
    siteId,
    validationId,
    patientId,
    visitDate,
    artifactKind,
    token,
  );
  return URL.createObjectURL(blob);
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

export async function fetchAnalysisCaseRoiPreviewArtifactUrl(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string,
  options: {
    previewMaxSide?: number;
  } = {},
) {
  if (canUseDesktopAnalysisTransport()) {
    return resolveDesktopArtifactUrl("resolve_case_roi_preview_artifact_path", {
      site_id: siteId,
      patient_id: patientId,
      visit_date: visitDate,
      image_id: imageId,
      artifact_kind: artifactKind,
      preview_max_side:
        options.previewMaxSide ?? DESKTOP_ARTIFACT_PREVIEW_MAX_SIDE,
    });
  }
  const blob = await fetchAnalysisCaseRoiPreviewArtifactBlob(siteId, patientId, visitDate, imageId, artifactKind, token);
  return URL.createObjectURL(blob);
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

export async function fetchAnalysisCaseLesionPreviewArtifactUrl(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string,
  options: {
    previewMaxSide?: number;
  } = {},
) {
  if (canUseDesktopAnalysisTransport()) {
    return resolveDesktopArtifactUrl("resolve_case_lesion_preview_artifact_path", {
      site_id: siteId,
      patient_id: patientId,
      visit_date: visitDate,
      image_id: imageId,
      artifact_kind: artifactKind,
      preview_max_side:
        options.previewMaxSide ?? DESKTOP_ARTIFACT_PREVIEW_MAX_SIDE,
    });
  }
  const blob = await fetchAnalysisCaseLesionPreviewArtifactBlob(siteId, patientId, visitDate, imageId, artifactKind, token);
  return URL.createObjectURL(blob);
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

export type ImageTextSearchResult = {
  image_id: string;
  patient_id: string;
  visit_date: string;
  view: string;
  preview_url: string | null;
  score: number;
};

export type ImageTextSearchResponse = {
  query: string;
  eligible_image_count: number;
  results: ImageTextSearchResult[];
};

export async function searchAnalysisImagesByText(
  siteId: string,
  query: string,
  token: string,
  topK = 10,
): Promise<ImageTextSearchResponse> {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ImageTextSearchResponse>(
      `/api/sites/${siteId}/images/search/text`,
      token,
      { method: "POST", body: { query, top_k: topK } },
    );
  }
  return request<ImageTextSearchResponse>(
    `/api/sites/${siteId}/images/search/text`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    },
    token,
  );
}
