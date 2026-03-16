"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { AccessRequestRecord, ProjectRecord, SiteRecord } from "../../lib/api";
import { pick, translateRole, translateStatus, type Locale } from "../../lib/i18n";
import type { ReviewDraft } from "./use-admin-workspace-state";

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  pendingRequests: AccessRequestRecord[];
  reviewDrafts: Record<string, ReviewDraft>;
  canManagePlatform: boolean;
  projects: ProjectRecord[];
  sites: SiteRecord[];
  setReviewDrafts: Dispatch<SetStateAction<Record<string, ReviewDraft>>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
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
  reviewDrafts,
  canManagePlatform,
  projects,
  sites,
  setReviewDrafts,
  formatDateTime,
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
          "Review institution access requests, assign the final role and site, and leave a short reviewer note before approval.",
          "기관 접근 요청을 검토하고 최종 역할과 site를 배정한 뒤 승인 메모를 남길 수 있습니다.",
        )}
        aside={<span className={docSiteBadgeClass}>{`${pendingRequests.length} ${pick(locale, "pending", "대기")}`}</span>}
      />

      {pendingRequests.length === 0 ? (
        <div className={emptySurfaceClass}>
          {pick(locale, "No pending access requests are assigned to this account.", "이 계정에 배정된 대기 중 접근 요청이 없습니다.")}
        </div>
      ) : (
        <div className="grid gap-4">
          {pendingRequests.map((request) => {
            const requestedSiteAvailable = sites.some((site) => site.site_id === request.requested_site_id);
            const defaultProjectId = projects[0]?.project_id ?? "";
            const requestedSiteLabel = request.requested_site_label || request.requested_site_id;
            const needsSiteCreation =
              request.requested_site_source === "institution_directory" && !request.resolved_site_id;
            const draft = reviewDrafts[request.request_id] ?? {
              assigned_role: request.requested_role,
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
              ? !canManagePlatform || !draft.project_id || !draft.site_code.trim() || !draft.display_name.trim()
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
                  <MetricItem value={translateRole(locale, draft.assigned_role)} label={pick(locale, "Assigned role", "배정 역할")} />
                </MetricGrid>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={pick(locale, "Assigned role", "배정 역할")}>
                    <select
                      value={draft.assigned_role}
                      onChange={(event) =>
                        setReviewDrafts((current) => ({
                          ...current,
                          [request.request_id]: { ...draft, assigned_role: event.target.value },
                        }))
                      }
                    >
                      {canManagePlatform ? <option value="site_admin">{translateRole(locale, "site_admin")}</option> : null}
                      <option value="researcher">{translateRole(locale, "researcher")}</option>
                      <option value="viewer">{translateRole(locale, "viewer")}</option>
                    </select>
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
                          {site.display_name}
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
                          <Field label={pick(locale, "Project", "프로젝트")}>
                            <select
                              value={draft.project_id}
                              onChange={(event) =>
                                setReviewDrafts((current) => ({
                                  ...current,
                                  [request.request_id]: { ...draft, project_id: event.target.value },
                                }))
                              }
                            >
                              <option value="">{pick(locale, "Select project", "프로젝트 선택")}</option>
                              {projects.map((project) => (
                                <option key={project.project_id} value={project.project_id}>
                                  {project.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field
                            label={pick(locale, "Site code", "site 코드")}
                            hint={pick(
                              locale,
                              "Uppercase letters, numbers, and underscores only.",
                              "영문 대문자, 숫자, 밑줄만 사용합니다.",
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
                              placeholder="HIRA_PARK_EYE"
                            />
                          </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label={pick(locale, "App display name", "앱 표시 이름")}>
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
      )}
    </Card>
  );
}
