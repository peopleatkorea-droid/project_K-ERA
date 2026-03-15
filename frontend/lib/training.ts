import { request } from "./api-core";
import type {
  AiClinicEmbeddingStatusResponse,
  AiClinicResponse,
  CaseValidationCompareResponse,
  CaseValidationResponse,
  CrossValidationJobResponse,
  CrossValidationReport,
  EmbeddingBackfillJobResponse,
  InitialTrainingBenchmarkJobResponse,
  InitialTrainingJobResponse,
  ModelVersionRecord,
  SiteJobRecord,
  SiteValidationJobResponse,
  SiteValidationRunRecord,
  ValidationCasePredictionRecord,
} from "./types";

export async function fetchSiteValidations(siteId: string, token: string) {
  return request<SiteValidationRunRecord[]>(`/api/sites/${siteId}/validations`, {}, token);
}

export async function fetchValidationCases(
  siteId: string,
  validationId: string,
  token: string,
  options: {
    misclassified_only?: boolean;
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.misclassified_only) {
    params.set("misclassified_only", "true");
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ValidationCasePredictionRecord[]>(`/api/sites/${siteId}/validations/${validationId}/cases${suffix}`, {}, token);
}

export async function runCaseValidation(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  },
) {
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

export async function runCaseValidationCompare(
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

export async function runCaseAiClinic(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    top_k?: number;
    retrieval_backend?: "classifier" | "dinov2" | "hybrid";
  },
) {
  return request<AiClinicResponse>(
    `/api/sites/${siteId}/cases/ai-clinic`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        top_k: 3,
        retrieval_backend: "hybrid",
        ...payload,
      }),
    },
    token,
  );
}

export async function backfillAiClinicEmbeddings(
  siteId: string,
  token: string,
  payload?: {
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    force_refresh?: boolean;
  },
) {
  return request<EmbeddingBackfillJobResponse>(
    `/api/sites/${siteId}/ai-clinic/embeddings/backfill`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        force_refresh: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchAiClinicEmbeddingStatus(
  siteId: string,
  token: string,
  options?: {
    model_version_id?: string;
  },
) {
  const params = new URLSearchParams();
  if (options?.model_version_id) {
    params.set("model_version_id", options.model_version_id);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<AiClinicEmbeddingStatusResponse>(`/api/sites/${siteId}/ai-clinic/embeddings/status${suffix}`, {}, token);
}

export async function fetchSiteModelVersions(siteId: string, token: string) {
  return request<ModelVersionRecord[]>(`/api/sites/${siteId}/model-versions`, {}, token);
}

export async function runSiteValidation(
  siteId: string,
  token: string,
  payload: {
    execution_mode?: "auto" | "cpu" | "gpu";
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
    model_version_id?: string;
  } = {},
) {
  return request<SiteValidationJobResponse>(
    `/api/sites/${siteId}/validations/run`,
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

export async function runInitialTraining(
  siteId: string,
  token: string,
  payload: {
    architecture?: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual" | "both";
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    test_split?: number;
    use_pretrained?: boolean;
    regenerate_split?: boolean;
  } = {},
) {
  return request<InitialTrainingJobResponse>(
    `/api/sites/${siteId}/training/initial`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        epochs: 30,
        learning_rate: 1e-4,
        batch_size: 16,
        val_split: 0.2,
        test_split: 0.2,
        use_pretrained: true,
        regenerate_split: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function runInitialTrainingBenchmark(
  siteId: string,
  token: string,
  payload: {
    architectures: string[];
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual" | "both";
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    test_split?: number;
    use_pretrained?: boolean;
    regenerate_split?: boolean;
  },
) {
  return request<InitialTrainingBenchmarkJobResponse>(
    `/api/sites/${siteId}/training/initial/benchmark`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        crop_mode: "automated",
        epochs: 30,
        learning_rate: 1e-4,
        batch_size: 16,
        val_split: 0.2,
        test_split: 0.2,
        use_pretrained: true,
        regenerate_split: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchSiteJob(siteId: string, jobId: string, token: string) {
  return request<SiteJobRecord>(`/api/sites/${siteId}/jobs/${jobId}`, {}, token);
}

export async function fetchCrossValidationReports(siteId: string, token: string) {
  return request<CrossValidationReport[]>(`/api/sites/${siteId}/training/cross-validation`, {}, token);
}

export async function runCrossValidation(
  siteId: string,
  token: string,
  payload: {
    architecture?: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual";
    num_folds?: number;
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    use_pretrained?: boolean;
  } = {},
) {
  return request<CrossValidationJobResponse>(
    `/api/sites/${siteId}/training/cross-validation`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        num_folds: 5,
        epochs: 10,
        learning_rate: 1e-4,
        batch_size: 16,
        val_split: 0.2,
        use_pretrained: true,
        ...payload,
      }),
    },
    token,
  );
}
