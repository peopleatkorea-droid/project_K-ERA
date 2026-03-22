const defaultControlPlaneBasePath = "/control-plane/api";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function controlPlaneBasePath(): string {
  const configured = process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_PATH?.trim();
  if (!configured) {
    return defaultControlPlaneBasePath;
  }
  return trimTrailingSlash(configured.startsWith("/") ? configured : `/${configured}`);
}

export function controlPlaneSessionSecret(): string {
  return (
    process.env.KERA_CONTROL_PLANE_SESSION_SECRET?.trim() ||
    process.env.KERA_API_SECRET?.trim() ||
    "replace-me-in-production-control-plane"
  );
}

export function controlPlaneDatabaseUrl(): string {
  return (
    process.env.KERA_LOCAL_CONTROL_PLANE_DATABASE_URL?.trim() ||
    process.env.KERA_CONTROL_PLANE_LOCAL_DATABASE_URL?.trim() ||
    process.env.KERA_CONTROL_PLANE_DATABASE_URL?.trim() ||
    process.env.KERA_AUTH_DATABASE_URL?.trim() ||
    process.env.KERA_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    ""
  );
}

export function controlPlaneAdminEmails(): string[] {
  const configured = process.env.KERA_CONTROL_PLANE_ADMIN_EMAILS?.trim() || "";
  return configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function controlPlaneDevAuthEnabled(): boolean {
  return (process.env.KERA_CONTROL_PLANE_DEV_AUTH?.trim().toLowerCase() || "false") === "true";
}

export function controlPlaneLlmApiKey(): string {
  return (
    process.env.KERA_CONTROL_PLANE_OPENAI_API_KEY?.trim() ||
    process.env.KERA_AI_CLINIC_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

export function controlPlaneLlmModel(): string {
  return process.env.KERA_AI_CLINIC_LLM_MODEL?.trim() || "gpt-4o-mini";
}

export function controlPlaneLlmBaseUrl(): string {
  return process.env.KERA_AI_CLINIC_LLM_BASE_URL?.trim() || "https://api.openai.com/v1/responses";
}

export function controlPlaneLlmTimeoutMs(): number {
  const seconds = Number(process.env.KERA_AI_CLINIC_LLM_TIMEOUT_SECONDS?.trim() || "45");
  return Math.max(5_000, Math.floor(seconds * 1000));
}

export function controlPlaneHiraApiKey(): string {
  return (
    process.env.KERA_HIRA_API_KEY?.trim() ||
    process.env.HIRA_API_KEY?.trim() ||
    ""
  );
}

export function controlPlaneHiraHospitalInfoUrl(): string {
  return (
    process.env.KERA_HIRA_HOSPITAL_INFO_URL?.trim() ||
    "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
  );
}

export function controlPlaneHiraApiTimeoutMs(): number {
  const seconds = Number(process.env.KERA_HIRA_API_TIMEOUT_SECONDS?.trim() || "30");
  return Math.max(5_000, Math.floor(seconds * 1000));
}
