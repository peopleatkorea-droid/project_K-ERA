"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { AccessRequestRecord, InstitutionDirectorySyncResponse, ProjectRecord, SiteRecord } from "../../lib/api";
import { pick, translateRole, translateStatus, type Locale } from "../../lib/i18n";
import { getRequestedSiteLabel, getSiteDisplayName } from "../../lib/site-labels";
import type { ReviewDraft } from "./use-admin-workspace-state";

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  pendingRequests: AccessRequestRecord[];
  autoApprovedRequests: AccessRequestRecord[];
  reviewDrafts: Record<string, ReviewDraft>;
  canManagePlatform: boolean;
  institutionSyncBusy: boolean;
  institutionSyncStatus: InstitutionDirectorySyncResponse | null;
  projects: ProjectRecord[];
  sites: SiteRecord[];
  setReviewDrafts: Dispatch<SetStateAction<Record<string, ReviewDraft>>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onInstitutionSync: () => void;
  onReview: (requestId: string, decision: "approved" | "rejected") => void;
};

function normalizeSiteCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export function RequestsSection({
  locale,
  notAvailableLabel,
  pendingRequests,
  autoApprovedRequests,
  reviewDrafts,
  canManagePlatform,
  institutionSyncBusy,
  institutionSyncStatus,
  projects,
  sites,
  setReviewDrafts,
  formatDateTime,
  onInstitutionSync,
  onReview,
}: Props) {
  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Access review", "접근 검토")}</div>}
        title={pick(locale, "Institution approval queue", "기관 승인 대기열")}
        titleAs="h3"
        description={pick(
          locale,
          "Researcher requests are auto-approved when the selected hospital already exists. Only unmapped institution requests stay in the manual review queue.",
          "선택한 기관이 이미 K-ERA site에 연결되어 있으면 researcher 요청은 자동 승인됩니다. 아직 매핑되지 않은 기관 요청만 수동 검토 대기열에 남습니다.",
        )}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={docSiteBadgeClass}>{`${pendingRequests.length} ${pick(locale, "pending", "대기")}`}</span>
            <span className={docSiteBadgeClass}>{`${autoApprovedRequests.length} ${pick(locale, "auto-approved", "자동 승인")}`}</span>
            {canManagePlatform ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={institutionSyncBusy}
                onClick={onInstitutionSync}
              >
                {pick(locale, "Sync HIRA directory", "HIRA 디렉터리 동기화")}
              </Button>
            ) : null}
          </div>
        }
      />

      <Card as="section" variant="nested" className="grid gap-2 border border-border/80 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong className="text-sm font-semibold text-ink">
            {pick(locale, "Last HIRA sync", "최근 HIRA 동기화")}
          </strong>
          <span className={docSiteBadgeClass}>
            {institutionSyncStatus?.synced_at
              ? formatDateTime(institutionSyncStatus.synced_at, notAvailableLabel)
              : pick(locale, "Not synced yet", "아직 동기화되지 않음")}
          </span>
        </div>
        <div className="text-sm leading-6 text-muted">
          {institutionSyncStatus?.institutions_synced
            ? pick(
                locale,
                `${institutionSyncStatus.institutions_synced.toLocaleString()} institutions cached`
                  + (institutionSyncStatus.pages_synced
                    ? ` across ${institutionSyncStatus.pages_synced.toLocaleString()} page(s).`
                    : "."),
                `기관 ${institutionSyncStatus.institutions_synced.toLocaleString()}개가 저장되어 있습니다`
                  + (institutionSyncStatus.pages_synced
                    ? ` (${institutionSyncStatus.pages_synced.toLocaleString()}페이지 동기화).`
                    : "."),
              )
            : pick(
                locale,
                "Run one sync to build the official ophthalmology institution directory.",
                "공식 안과 기관 디렉터리를 만들려면 한 번 동기화를 실행하세요.",
              )}
        </div>
      </Card>

      {autoApprovedRequests.length > 0 ? (
        <div className="grid gap-4">
          <SectionHeader
            title={pick(locale, "Recent auto-approved researcher access", "최근 자동 승인 researcher 접근")}
            titleAs="h4"
            description={pick(
              locale,
              "These requests were approved immediately because the requested hospital already mapped to an active K-ERA site.",
              "이 요청들은 선택한 기관이 이미 활성 K-ERA site에 연결되어 있어서 즉시 승인되었습니다.",
            )}
          />
          {autoApprovedRequests.map((request) => (
            <Card key={request.request_id} as="article" variant="nested" className="grid gap-4 p-5">
              <SectionHeader
                title={request.email}
                titleAs="h4"
                description={request.message || pick(locale, "No requester note was provided.", "요청 메모가 없습니다.")}
                aside={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={docSiteBadgeClass}>{translateStatus(locale, request.status)}</span>
                    <span className={docSiteBadgeClass}>{formatDateTime(request.reviewed_at, notAvailableLabel)}</span>
                  </div>
                }
              />
              <MetricGrid columns={4}>
                <MetricItem value={getRequestedSiteLabel(request)} label={pick(locale, "Requested hospital", "요청 기관")} />
                <MetricItem value={request.resolved_site_label || request.resolved_site_id || notAvailableLabel} label={pick(locale, "Approved site", "승인 site")} />
                <MetricItem value={translateRole(locale, request.requested_role)} label={pick(locale, "Assigned role", "배정 역할")} />
                <MetricItem value={formatDateTime(request.created_at, notAvailableLabel)} label={pick(locale, "Requested at", "요청 시각")} />
              </MetricGrid>
            </Card>
          ))}
        </div>
      ) : null}

      {pendingRequests.length === 0 && autoApprovedRequests.length === 0 ? (
        <div className={emptySurfaceClass}>
          {pick(locale, "No pending access requests are assigned to this account.", "이 계정에 배정된 대기 중 접근 요청이 없습니다.")}
        </div>
      ) : pendingRequests.length > 0 ? (
        <div className="grid gap-4">
          {pendingRequests.map((request) => {
            const requestedSiteAvailable = sites.some((site) => site.site_id === request.requested_site_id);
            const defaultProjectId = projects[0]?.project_id ?? "";
            const requestedSiteLabel = getRequestedSiteLabel(request);
            const needsSiteCreation =
              request.requested_site_source === "institution_directory" && !request.resolved_site_id;
            const draft = reviewDrafts[request.request_id] ?? {
              assigned_role: "researcher",
              assigned_site_id:
                request.resolved_site_id ?? (requestedSiteAvailable ? request.requested_site_id : ""),
              create_site_if_missing: needsSiteCreation,
              project_id: defaultProjectId,
              site_code: "",
              display_name: requestedSiteLabel,
              hospital_name: requestedSiteLabel,
              research_registry_enabled: false,
              reviewer_notes: "",
            };
            const mappedSiteLabel =
              request.resolved_site_label ||
              request.resolved_site_id ||
              (needsSiteCreation ? pick(locale, "Not mapped yet", "아직 매핑되지 않음") : notAvailableLabel);
            const approvalDisabled = draft.create_site_if_missing
              ? !canManagePlatform || !draft.site_code.trim() || !draft.hospital_name.trim()
              : !draft.assigned_site_id.trim();

            return (
              <Card key={request.request_id} as="article" variant="nested" className="grid gap-4 p-5">
                <SectionHeader
                  title={request.email}
                  titleAs="h4"
                  description={request.message || pick(locale, "No requester note was provided.", "요청 메모가 없습니다.")}
                  aside={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className={docSiteBadgeClass}>{formatDateTime(request.created_at, notAvailableLabel)}</span>
                      <span className={docSiteBadgeClass}>{translateStatus(locale, request.status)}</span>
                    </div>
                  }
                />

                <MetricGrid columns={4}>
                  <MetricItem value={requestedSiteLabel} label={pick(locale, "Requested hospital", "요청 기관")} />
                  <MetricItem value={translateRole(locale, request.requested_role)} label={pick(locale, "Requested role", "요청 역할")} />
                  <MetricItem value={mappedSiteLabel} label={pick(locale, "Mapped hospital", "매핑된 site")} />
                  <MetricItem value={translateRole(locale, "researcher")} label={pick(locale, "Assigned role", "배정 역할")} />
                </MetricGrid>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={pick(locale, "Assigned role", "배정 역할")}>
                    <div className="rounded-[var(--radius-md)] border border-border bg-white/55 px-3.5 py-3 text-sm font-semibold text-ink dark:bg-white/4">
                      {translateRole(locale, "researcher")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted">
                      {pick(
                        locale,
                        "Institution access requests always resolve to researcher access. Admin and site admin accounts are created separately with passwords.",
                        "기관 접근 요청은 researcher 권한으로만 승인됩니다. admin 및 site admin 계정은 비밀번호 기반으로 별도 생성합니다.",
                      )}
                    </div>
                  </Field>
                  <Field
                    label={pick(locale, "Assigned hospital", "배정 site")}
                    hint={
                      draft.create_site_if_missing
                        ? pick(
                            locale,
                            "Disabled while creating a new site during approval.",
                            "승인 중 새 site를 생성하는 동안에는 기존 site 선택이 비활성화됩니다.",
                          )
                        : undefined
                    }
                  >
                    <select
                      value={draft.assigned_site_id}
                      disabled={draft.create_site_if_missing}
                      onChange={(event) =>
                        setReviewDrafts((current) => ({
                          ...current,
                          [request.request_id]: {
                            ...draft,
                            assigned_site_id: event.target.value,
                            create_site_if_missing: event.target.value ? false : draft.create_site_if_missing,
                          },
                        }))
                      }
                    >
                      <option value="">{pick(locale, "Select site", "site 선택")}</option>
                      {sites.map((site) => (
                        <option key={site.site_id} value={site.site_id}>
                          {getSiteDisplayName(site)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {needsSiteCreation && canManagePlatform ? (
                  <Card as="section" variant="nested" className="grid gap-4 border border-border/80 p-4">
                    <SectionHeader
                      title={pick(locale, "Create site during approval", "승인 중 site 생성")}
                      titleAs="h4"
                      description={pick(
                        locale,
                        "This request points to the HIRA institution directory and is not mapped to a K-ERA site yet.",
                        "이 요청은 HIRA 기관 디렉터리를 가리키며 아직 K-ERA site에 연결되지 않았습니다.",
                      )}
                      aside={
                        <span className={docSiteBadgeClass}>
                          {draft.create_site_if_missing
                            ? pick(locale, "Create new site", "신규 생성")
                            : pick(locale, "Use existing site", "기존 site 사용")}
                        </span>
                      }
                    />

                    <Field
                      as="div"
                      label={pick(locale, "Approval mode", "승인 방식")}
                      hint={pick(
                        locale,
                        "Choose an existing site or create a new K-ERA site from this institution request.",
                        "기존 site에 배정하거나 이 기관 요청에서 새 K-ERA site를 생성할 수 있습니다.",
                      )}
                    >
                      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-border bg-white/55 px-3.5 py-2.5 text-sm text-ink dark:bg-white/4">
                        <input
                          type="checkbox"
                          checked={draft.create_site_if_missing}
                          onChange={(event) =>
                            setReviewDrafts((current) => ({
                              ...current,
                              [request.request_id]: {
                                ...draft,
                                create_site_if_missing: event.target.checked,
                                assigned_site_id: event.target.checked ? "" : draft.assigned_site_id,
                              },
                            }))
                          }
                        />
                        <span>{pick(locale, "Create a new K-ERA site for this institution", "이 기관으로 새 K-ERA site 생성")}</span>
                      </label>
                    </Field>

                    {draft.create_site_if_missing ? (
                      <>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field
                            label={pick(locale, "HIRA site ID", "HIRA 코드")}
                            hint={pick(
                              locale,
                              "Use the canonical 8-digit HIRA code for the new site.",
                              "새 site에는 8자리 HIRA 코드를 사용하세요.",
                            )}
                          >
                            <input
                              value={draft.site_code}
                              onChange={(event) =>
                                setReviewDrafts((current) => ({
                                  ...current,
                                  [request.request_id]: {
                                    ...draft,
                                    site_code: normalizeSiteCode(event.target.value),
                                  },
                                }))
                              }
                              placeholder="39100103"
                            />
                          </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label={pick(locale, "Alias (optional)", "별칭 (선택)")}>
                            <input
                              value={draft.display_name}
                              onChange={(event) =>
                                setReviewDrafts((current) => ({
                                  ...current,
                                  [request.request_id]: { ...draft, display_name: event.target.value },
                                }))
                              }
                            />
                          </Field>
                          <Field label={pick(locale, "Official hospital name", "공식 기관명")}>
                            <input
                              value={draft.hospital_name}
                              onChange={(event) =>
                                setReviewDrafts((current) => ({
                                  ...current,
                                  [request.request_id]: { ...draft, hospital_name: event.target.value },
                                }))
                              }
                            />
                          </Field>
                        </div>

                        <Field
                          as="div"
                          label={pick(locale, "Research registry", "연구 registry")}
                          hint={pick(
                            locale,
                            "Keep this off until the new institution is ready for registry enrollment.",
                            "새 기관의 registry 운영 준비가 끝날 때까지는 비활성화 상태로 두는 편이 안전합니다.",
                          )}
                        >
                          <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-border bg-white/55 px-3.5 py-2.5 text-sm text-ink dark:bg-white/4">
                            <input
                              type="checkbox"
                              checked={draft.research_registry_enabled}
                              onChange={(event) =>
                                setReviewDrafts((current) => ({
                                  ...current,
                                  [request.request_id]: {
                                    ...draft,
                                    research_registry_enabled: event.target.checked,
                                  },
                                }))
                              }
                            />
                            <span>{pick(locale, "Enable research registry for the new site", "새 site의 연구 registry 활성화")}</span>
                          </label>
                        </Field>
                      </>
                    ) : null}
                  </Card>
                ) : null}

                <Field label={pick(locale, "Reviewer note", "검토 메모")}>
                  <textarea
                    rows={3}
                    value={draft.reviewer_notes}
                    onChange={(event) =>
                      setReviewDrafts((current) => ({
                        ...current,
                        [request.request_id]: { ...draft, reviewer_notes: event.target.value },
                      }))
                    }
                  />
                </Field>

                <div className="flex flex-wrap justify-end gap-3">
                  <Button type="button" variant="danger" onClick={() => onReview(request.request_id, "rejected")}>
                    {pick(locale, "Reject", "반려")}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={approvalDisabled}
                    onClick={() => onReview(request.request_id, "approved")}
                  >
                    {pick(locale, "Approve", "승인")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
