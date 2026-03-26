import type { AuthState } from "./types";

export function normalizeAuthState(value: string | null | undefined): AuthState {
  const normalized = String(value ?? "").trim();
  if (normalized === "approved" || normalized === "pending" || normalized === "rejected" || normalized === "application_required") {
    return normalized;
  }
  return "application_required";
}

export function normalizeSiteIds(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((siteId): siteId is string => typeof siteId === "string" && siteId.trim().length > 0);
}

export function normalizeEffectiveApprovalStatus(input: {
  role?: string | null;
  site_ids?: string[] | null;
  approval_status?: string | null;
}): AuthState {
  const role = String(input.role ?? "").trim().toLowerCase();
  if (role === "admin") {
    return "approved";
  }
  const approvalStatus = normalizeAuthState(input.approval_status);
  const siteIds = normalizeSiteIds(input.site_ids);
  if (approvalStatus === "approved" && siteIds.length === 0) {
    return "application_required";
  }
  return approvalStatus;
}
