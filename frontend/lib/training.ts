import { request } from "./api-core";
import {
  fetchAnalysisSiteJob as fetchSiteJobRuntime,
  runAnalysisCaseAiClinic as runCaseAiClinicRuntime,
  runAnalysisCaseValidation as runCaseValidationRuntime,
  runAnalysisCaseValidationCompare as runCaseValidationCompareRuntime,
} from "./analysis-runtime";
import { hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";
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

function canUseDesktopTrainingTransport() {
  return hasDesktopRuntime();
}

export async function fetchSiteValidations(
  siteId: string,
  token: string,
  optionsOrSignal:
    | AbortSignal
    | {
        signal?: AbortSignal;
        limit?: number;
      }
    | undefined = {},
) {
  const options =
    optionsOrSignal instanceof AbortSignal
      ? { signal: optionsOrSignal }
      : optionsOrSignal ?? {};
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<SiteValidationRunRecord[]>("fetch_site_validations", {
      payload: {
        site_id: siteId,
        token,
        limit: options.limit,
      },
    }, options.signal);
  }
  const params = new URLSearchParams();
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<SiteValidationRunRecord[]>(`/api/sites/${siteId}/validations${suffix}`, { signal: options.signal }, token);
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
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<ValidationCasePredictionRecord[]>("fetch_validation_cases", {
      payload: {
        site_id: siteId,
        token,
        validation_id: validationId,
        misclassified_only: options.misclassified_only ?? false,
        limit: options.limit,
      },
    });
  }
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
    model_version_ids?: string[];
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  },
) {
  return runCaseValidationRuntime(siteId, token, payload);
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
  return runCaseValidationCompareRuntime(siteId, token, payload);
}

export async function runCaseAiClinic(
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
  return runCaseAiClinicRuntime(siteId, token, payload);
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
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<EmbeddingBackfillJobResponse>("backfill_ai_clinic_embeddings", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
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
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<AiClinicEmbeddingStatusResponse>("fetch_ai_clinic_embedding_status", {
      payload: {
        site_id: siteId,
        token,
        model_version_id: options?.model_version_id,
      },
    });
  }
  const params = new URLSearchParams();
  if (options?.model_version_id) {
    params.set("model_version_id", options.model_version_id);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<AiClinicEmbeddingStatusResponse>(`/api/sites/${siteId}/ai-clinic/embeddings/status${suffix}`, {}, token);
}

export async function fetchSiteModelVersions(siteId: string, token: string, signal?: AbortSignal) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<ModelVersionRecord[]>("fetch_site_model_versions", {
      payload: {
        site_id: siteId,
        token,
      },
    }, signal);
  }
  return request<ModelVersionRecord[]>(`/api/sites/${siteId}/model-versions`, { signal }, token);
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
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<SiteValidationJobResponse>("run_site_validation", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
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
    crop_mode?: "automated" | "manual" | "both" | "paired";
    case_aggregation?: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    test_split?: number;
    use_pretrained?: boolean;
    regenerate_split?: boolean;
  } = {},
) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<InitialTrainingJobResponse>("run_initial_training", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  return request<InitialTrainingJobResponse>(
    `/api/sites/${siteId}/training/initial`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        case_aggregation: "mean",
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
    crop_mode?: "automated" | "manual" | "both" | "paired";
    case_aggregation?: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    test_split?: number;
    use_pretrained?: boolean;
    regenerate_split?: boolean;
  },
) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<InitialTrainingBenchmarkJobResponse>("run_initial_training_benchmark", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  return request<InitialTrainingBenchmarkJobResponse>(
    `/api/sites/${siteId}/training/initial/benchmark`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        crop_mode: "automated",
        case_aggregation: "mean",
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

export async function resumeInitialTrainingBenchmark(
  siteId: string,
  token: string,
  payload: {
    job_id: string;
    execution_mode?: "auto" | "cpu" | "gpu";
  },
) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<InitialTrainingBenchmarkJobResponse>("resume_initial_training_benchmark", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  return request<InitialTrainingBenchmarkJobResponse>(
    `/api/sites/${siteId}/training/initial/benchmark/resume`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchSiteJob(siteId: string, jobId: string, token: string) {
  return fetchSiteJobRuntime(siteId, jobId, token);
}

export async function cancelSiteJob(siteId: string, jobId: string, token: string) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<SiteJobRecord>("cancel_site_job", {
      payload: {
        site_id: siteId,
        token,
        job_id: jobId,
      },
    });
  }
  return request<SiteJobRecord>(
    `/api/sites/${siteId}/jobs/${jobId}/cancel`,
    {
      method: "POST",
    },
    token,
  );
}

export async function fetchCrossValidationReports(siteId: string, token: string) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<CrossValidationReport[]>("fetch_cross_validation_reports", {
      payload: {
        site_id: siteId,
        token,
      },
    });
  }
  return request<CrossValidationReport[]>(`/api/sites/${siteId}/training/cross-validation`, {}, token);
}

export async function runCrossValidation(
  siteId: string,
  token: string,
  payload: {
    architecture?: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual" | "paired";
    case_aggregation?: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
    num_folds?: number;
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    use_pretrained?: boolean;
  } = {},
) {
  if (canUseDesktopTrainingTransport()) {
    return invokeDesktop<CrossValidationJobResponse>("run_cross_validation", {
      payload: {
        site_id: siteId,
        token,
        ...payload,
      },
    });
  }
  return request<CrossValidationJobResponse>(
    `/api/sites/${siteId}/training/cross-validation`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        case_aggregation: "mean",
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
