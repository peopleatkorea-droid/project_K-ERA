"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { AccessRequestRecord, SiteRecord } from "../../lib/api";
import { pick, translateRole, translateStatus, type Locale } from "../../lib/i18n";

type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  pendingRequests: AccessRequestRecord[];
  reviewDrafts: Record<string, ReviewDraft>;
  sites: SiteRecord[];
  setReviewDrafts: Dispatch<SetStateAction<Record<string, ReviewDraft>>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  onReview: (requestId: string, decision: "approved" | "rejected") => void;
};

export function RequestsSection({
  locale,
  notAvailableLabel,
  pendingRequests,
  reviewDrafts,
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
          "기관 접근 요청을 검토하고, 최종 역할과 병원을 지정한 뒤 짧은 검토 메모와 함께 승인합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{`${pendingRequests.length} ${pick(locale, "pending", "대기")}`}</span>}
      />

      {pendingRequests.length === 0 ? (
        <div className={emptySurfaceClass}>
          {pick(locale, "No pending access requests are assigned to this account.", "이 계정에 배정된 접근 요청이 없습니다.")}
        </div>
      ) : (
        <div className="grid gap-4">
          {pendingRequests.map((request) => {
            const draft = reviewDrafts[request.request_id] ?? {
              assigned_role: request.requested_role,
              assigned_site_id: request.requested_site_id,
              reviewer_notes: "",
            };

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
                  <MetricItem value={request.requested_site_id} label={pick(locale, "Requested hospital", "요청 병원")} />
                  <MetricItem value={translateRole(locale, request.requested_role)} label={pick(locale, "Requested role", "요청 역할")} />
                  <MetricItem value={draft.assigned_site_id || notAvailableLabel} label={pick(locale, "Assigned hospital", "배정 병원")} />
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
                      <option value="site_admin">{translateRole(locale, "site_admin")}</option>
                      <option value="researcher">{translateRole(locale, "researcher")}</option>
                      <option value="viewer">{translateRole(locale, "viewer")}</option>
                    </select>
                  </Field>
                  <Field label={pick(locale, "Assigned hospital", "배정 병원")}>
                    <select
                      value={draft.assigned_site_id}
                      onChange={(event) =>
                        setReviewDrafts((current) => ({
                          ...current,
                          [request.request_id]: { ...draft, assigned_site_id: event.target.value },
                        }))
                      }
                    >
                      {sites.map((site) => (
                        <option key={site.site_id} value={site.site_id}>
                          {site.display_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

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
                  <Button type="button" variant="primary" onClick={() => onReview(request.request_id, "approved")}>
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
