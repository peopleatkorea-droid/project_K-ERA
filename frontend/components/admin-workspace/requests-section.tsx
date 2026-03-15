"use client";

import type { Dispatch, SetStateAction } from "react";

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
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Access review", "접근 검토")}</div>
          <h3>{pick(locale, "Institution approval queue", "기관 승인 대기열")}</h3>
        </div>
        <div className="doc-site-badge">{pendingRequests.length} {pick(locale, "pending", "대기")}</div>
      </div>
      {pendingRequests.length === 0 ? (
        <div className="empty-surface">{pick(locale, "No pending access requests are assigned to this account.", "이 계정에 할당된 대기 중 접근 요청이 없습니다.")}</div>
      ) : (
        <div className="ops-list">
          {pendingRequests.map((request) => {
            const draft = reviewDrafts[request.request_id] ?? {
              assigned_role: request.requested_role,
              assigned_site_id: request.requested_site_id,
              reviewer_notes: "",
            };
            return (
              <article key={request.request_id} className="ops-card">
                <div className="panel-card-head">
                  <strong>{request.email}</strong>
                  <span>{formatDateTime(request.created_at, notAvailableLabel)}</span>
                </div>
                <div className="panel-meta">
                  <span>{request.requested_site_id}</span>
                  <span>{translateRole(locale, request.requested_role)}</span>
                  <span>{translateStatus(locale, request.status)}</span>
                </div>
                {request.message ? <p>{request.message}</p> : null}
                <div className="ops-form-grid">
                  <label className="inline-field">
                    <span>{pick(locale, "Assigned role", "부여 역할")}</span>
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
                  </label>
                  <label className="inline-field">
                    <span>{pick(locale, "Assigned hospital", "부여 병원")}</span>
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
                        <option key={site.site_id} value={site.site_id}>{site.display_name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="notes-field">
                  <span>{pick(locale, "Reviewer note", "검토 메모")}</span>
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
                </label>
                <div className="workspace-actions">
                  <button className="ghost-button" type="button" onClick={() => onReview(request.request_id, "rejected")}>
                    {pick(locale, "Reject", "반려")}
                  </button>
                  <button className="primary-workspace-button" type="button" onClick={() => onReview(request.request_id, "approved")}>
                    {pick(locale, "Approve", "승인")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
