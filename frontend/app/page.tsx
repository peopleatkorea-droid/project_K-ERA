"use client";

import Link from "next/link";
import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AdminWorkspace } from "../components/admin-workspace";
import { CaseWorkspace } from "../components/case-workspace";
import { LocaleToggle, pick, translateApiError, translateRole, translateStatus, useI18n } from "../lib/i18n";
import {
  createPatient,
  downloadManifest,
  fetchAccessRequests,
  fetchMe,
  fetchMyAccessRequests,
  fetchPatients,
  fetchPublicSites,
  type PatientRecord,
  type SiteSummary,
  fetchSiteSummary,
  fetchSites,
  googleLogin,
  reviewAccessRequest,
  submitAccessRequest,
  type AccessRequestRecord,
  type AuthState,
  type AuthUser,
  type SiteRecord,
} from "../lib/api";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

const TOKEN_KEY = "kera_web_token";
const WORKSPACE_THEME_KEY = "kera_workspace_theme";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
type OperationsSection = "dashboard" | "training" | "cross_validation";

function parseOperationsLaunchFromSearch(): { mode: "canvas" | "operations"; section: OperationsSection } | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("workspace") !== "operations") {
    return null;
  }
  const section = params.get("section");
  if (section === "training" || section === "cross_validation" || section === "dashboard") {
    return { mode: "operations", section };
  }
  return { mode: "operations", section: "dashboard" };
}

function statusCopy(locale: "en" | "ko", status: AuthState): string {
  if (status === "pending") {
    return pick(locale, "Your institution request is pending review.", "기관 접근 요청이 검토 대기 중입니다.");
  }
  if (status === "rejected") {
    return pick(
      locale,
      "Your last institution request was rejected. Submit a revised request.",
      "이전 기관 접근 요청이 반려되었습니다. 수정 후 다시 제출해 주세요."
    );
  }
  if (status === "application_required") {
    return pick(locale, "Submit your institution and role request to continue.", "계속하려면 기관과 역할 요청을 제출해 주세요.");
  }
  return pick(locale, "Approved", "승인됨");
}

export default function HomePage() {
  const { locale } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [myRequests, setMyRequests] = useState<AccessRequestRecord[]>([]);
  const [adminRequests, setAdminRequests] = useState<AccessRequestRecord[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [googleReady, setGoogleReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [patientBusy, setPatientBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [reviewBusyById, setReviewBusyById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [patientForm, setPatientForm] = useState({
    patient_id: "",
    sex: "female",
    age: "65",
    chart_alias: "",
    local_case_code: "",
  });
  const [requestForm, setRequestForm] = useState({
    requested_site_id: "",
    requested_role: "researcher",
    message: "",
  });
  const [workspaceMode, setWorkspaceMode] = useState<"canvas" | "operations">("canvas");
  const [operationsSection, setOperationsSection] = useState<OperationsSection>("dashboard");
  const [workspaceTheme, setWorkspaceTheme] = useState<"dark" | "light">("dark");
  const [launchTarget, setLaunchTarget] = useState<{ mode: "canvas" | "operations"; section: OperationsSection } | null>(null);

  const approved = user?.approval_status === "approved";
  const canReview = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));
  const canOpenOperations = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));
  const copy = {
    unableLoadInstitutions: pick(locale, "Unable to load institutions.", "기관 목록을 불러오지 못했습니다."),
    failedConnect: pick(locale, "Failed to connect.", "연결에 실패했습니다."),
    failedLoadSiteData: pick(locale, "Failed to load hospital data.", "병원 데이터를 불러오지 못했습니다."),
    failedLoadApprovalQueue: pick(locale, "Failed to load approval queue.", "승인 대기열을 불러오지 못했습니다."),
    googleNoCredential: pick(locale, "Google login did not return a credential.", "Google 로그인 자격 정보가 반환되지 않았습니다."),
    googleLoginFailed: pick(locale, "Google login failed.", "Google 로그인에 실패했습니다."),
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    requestSubmissionFailed: pick(locale, "Request submission failed.", "요청 제출에 실패했습니다."),
    connecting: pick(locale, "Connecting...", "연결 중..."),
    submitting: pick(locale, "Submitting...", "제출 중..."),
    heroEyebrow: pick(locale, "Clinical Research Workspace", "임상 연구 워크스페이스"),
    heroBody: pick(
      locale,
      "Sign in with your institution account, request the right hospital once, and move directly into a document-style case canvas after approval.",
      "기관 계정으로 로그인하고 한 번만 병원 접근을 요청하면, 승인 후 문서형 케이스 캔버스로 바로 이동할 수 있습니다."
    ),
    signIn: pick(locale, "Sign In", "로그인"),
    enterWorkspace: pick(locale, "Enter the case workspace", "케이스 워크스페이스 입장"),
    signInBody: pick(
      locale,
      "Google is the default path for researchers. Local username/password stays admin-only for recovery.",
      "연구자는 Google 로그인이 기본 경로이며, 로컬 아이디/비밀번호는 관리자 복구용으로만 유지됩니다."
    ),
    googleLogin: pick(locale, "Institution Google login", "기관 Google 로그인"),
    googleDisabled: pick(
      locale,
      "Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set.",
      "`NEXT_PUBLIC_GOOGLE_CLIENT_ID`가 설정되기 전까지 Google 로그인이 비활성화됩니다."
    ),
    adminRecoveryOnly: pick(locale, "Administrator recovery only", "관리자 복구 전용"),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "비밀번호"),
    enterAdminRecovery: pick(locale, "Enter admin recovery", "관리자 복구로 입장"),
    approvalRequired: pick(locale, "Approval Required", "승인 필요"),
    institutionAccessRequest: pick(locale, "Institution access request", "기관 접근 요청"),
    signedInAs: (name: string, username: string) =>
      pick(locale, `Signed in as ${name} (${username})`, `${name} (${username}) 계정으로 로그인됨`),
    currentStatus: pick(locale, "Current Status", "현재 상태"),
    approvedBody: pick(
      locale,
      "Approved accounts receive hospital access and enter the clinician console automatically.",
      "승인된 계정은 병원 접근 권한을 받고 바로 임상 콘솔에 들어갑니다."
    ),
    noInstitutionRequest: pick(locale, "No institution request submitted yet.", "아직 기관 접근 요청을 제출하지 않았습니다."),
    reviewerLabel: pick(locale, "Reviewer", "검토자"),
    requestAccess: pick(locale, "Request Access", "접근 요청"),
    chooseInstitutionRole: pick(locale, "Choose your institution and role", "기관과 역할 선택"),
    hospital: pick(locale, "Hospital", "병원"),
    requestedRole: pick(locale, "Requested role", "요청 역할"),
    noteForReviewer: pick(locale, "Note for reviewer", "검토자 메모"),
    requestPlaceholder: pick(
      locale,
      "Department, study role, or context for this request.",
      "소속 부서, 연구 역할, 요청 배경을 적어주세요."
    ),
    submitInstitutionRequest: pick(locale, "Submit institution request", "기관 접근 요청 제출"),
    logOut: pick(locale, "Log Out", "로그아웃"),
    highlightGoogleTitle: pick(locale, "Google Sign-In", "Google 로그인"),
    highlightGoogleBody: pick(
      locale,
      "Researchers can onboard with a verified institution-linked Google account.",
      "연구자는 기관에 연결된 Google 계정으로 온보딩할 수 있습니다."
    ),
    highlightApprovalTitle: pick(locale, "Approval Queue", "승인 큐"),
    highlightApprovalBody: pick(
      locale,
      "Admins review institution and role requests before hospital access opens.",
      "관리자가 기관과 역할 요청을 검토한 뒤 병원 접근이 열립니다."
    ),
    highlightCanvasTitle: pick(locale, "Case Authoring", "증례 작성"),
    highlightCanvasBody: pick(
      locale,
      "Create, validate, and contribute cases from one workspace.",
      "하나의 작업공간에서 증례 작성, 검증, 기여를 처리합니다."
    ),
    highlightRecoveryTitle: pick(locale, "Admin Recovery", "관리자 복구"),
    highlightRecoveryBody: pick(
      locale,
      "A local admin fallback remains available for setup and incident recovery.",
      "초기 설정과 장애 대응을 위한 로컬 관리자 경로는 유지됩니다."
    ),
  };
  const adminRecoveryLinkLabel = pick(locale, "Open administrator recovery", "관리자 복구 열기");
  const adminLaunchLinks = [
    {
      label: pick(locale, "Admin training", "관리자 학습"),
      href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dtraining",
    },
    {
      label: pick(locale, "Admin cross-validation", "관리자 교차 검증"),
      href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dcross_validation",
    },
    {
      label: pick(locale, "Admin hospital validation", "관리자 병원 검증"),
      href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Ddashboard",
    },
  ];
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
    }
    setLaunchTarget(parseOperationsLaunchFromSearch());
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(WORKSPACE_THEME_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setWorkspaceTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_THEME_KEY, workspaceTheme);
  }, [workspaceTheme]);

  useEffect(() => {
    if (!approved || !canOpenOperations || !launchTarget || launchTarget.mode !== "operations") {
      return;
    }
    setOperationsSection(launchTarget.section);
    setWorkspaceMode("operations");
  }, [approved, canOpenOperations, launchTarget]);

  useEffect(() => {
    void fetchPublicSites()
      .then((items) => {
        setPublicSites(items);
        setRequestForm((current) => ({
          ...current,
          requested_site_id: current.requested_site_id || items[0]?.site_id || "",
        }));
      })
      .catch((nextError) => {
        setError(describeError(nextError, copy.unableLoadInstitutions));
      });
  }, [copy.unableLoadInstitutions]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const currentToken = token;
    async function bootstrap() {
      setBootstrapBusy(true);
      setError(null);
      try {
        const me = await fetchMe(currentToken);
        setUser(me);
        if (me.approval_status === "approved") {
          const nextSites = await fetchSites(currentToken);
          setSites(nextSites);
          setSelectedSiteId((current) => current ?? nextSites[0]?.site_id ?? null);
        } else {
          setSites([]);
          setSelectedSiteId(null);
          setMyRequests(await fetchMyAccessRequests(currentToken));
        }
      } catch (nextError) {
        setError(describeError(nextError, copy.failedConnect));
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setBootstrapBusy(false);
      }
    }
    void bootstrap();
  }, [token, copy.failedConnect]);

  useEffect(() => {
    if (!token || !selectedSiteId || !approved) {
      return;
    }
    const currentToken = token;
    const currentSiteId = selectedSiteId;
    async function loadSite() {
      setSiteBusy(true);
      setError(null);
      try {
        const [nextSummary, nextPatients] = await Promise.all([
          fetchSiteSummary(currentSiteId, currentToken),
          fetchPatients(currentSiteId, currentToken),
        ]);
        setSummary(nextSummary);
        setPatients(nextPatients);
      } catch (nextError) {
        setError(describeError(nextError, copy.failedLoadSiteData));
      } finally {
        setSiteBusy(false);
      }
    }
    void loadSite();
  }, [token, selectedSiteId, approved, copy.failedLoadSiteData]);

  useEffect(() => {
    if (!token || !canReview) {
      setAdminRequests([]);
      return;
    }
    const currentToken = token;
    void fetchAccessRequests(currentToken, "pending")
      .then((items) => {
        setAdminRequests(items);
        setReviewDrafts((current) => {
          const next = { ...current };
          for (const item of items) {
            next[item.request_id] = next[item.request_id] ?? {
              assigned_role: item.requested_role,
              assigned_site_id: item.requested_site_id,
              reviewer_notes: "",
            };
          }
          return next;
        });
      })
      .catch((nextError) => {
        setError(describeError(nextError, copy.failedLoadApprovalQueue));
      });
  }, [token, canReview, copy.failedLoadApprovalQueue]);

  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleButtonRef.current || !window.google?.accounts?.id) {
      return;
    }
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError(copy.googleNoCredential);
          return;
        }
        setAuthBusy(true);
        setError(null);
        try {
          const auth = await googleLogin(response.credential);
          window.localStorage.setItem(TOKEN_KEY, auth.access_token);
          setToken(auth.access_token);
          setUser(auth.user);
        } catch (nextError) {
          setError(describeError(nextError, copy.googleLoginFailed));
        } finally {
          setAuthBusy(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      width: 320,
      text: "signin_with",
      shape: "pill",
    });
  }, [googleReady, token, copy.googleLoginFailed, copy.googleNoCredential]);

  async function refreshSiteData(siteId: string, currentToken: string) {
    const [nextSummary, nextPatients] = await Promise.all([
      fetchSiteSummary(siteId, currentToken),
      fetchPatients(siteId, currentToken),
    ]);
    setSummary(nextSummary);
    setPatients(nextPatients);
  }

  async function refreshApprovedSites(currentToken: string) {
    const nextSites = await fetchSites(currentToken);
    setSites(nextSites);
    setSelectedSiteId((current) => current ?? nextSites[0]?.site_id ?? null);
  }

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedSiteId) {
      return;
    }
    setPatientBusy(true);
    setError(null);
    try {
      await createPatient(selectedSiteId, token, {
        patient_id: patientForm.patient_id,
        sex: patientForm.sex,
        age: Number(patientForm.age),
        chart_alias: patientForm.chart_alias,
        local_case_code: patientForm.local_case_code,
      });
      setPatientForm((current) => ({ ...current, patient_id: "", chart_alias: "", local_case_code: "" }));
      await refreshSiteData(selectedSiteId, token);
    } catch (nextError) {
      setError(describeError(nextError, pick(locale, "Patient creation failed.", "환자 생성에 실패했습니다.")));
    } finally {
      setPatientBusy(false);
    }
  }

  async function handleRequestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setRequestBusy(true);
    setError(null);
    try {
      const response = await submitAccessRequest(token, requestForm);
      setUser(response.user);
      setMyRequests(await fetchMyAccessRequests(token));
    } catch (nextError) {
      setError(describeError(nextError, copy.requestSubmissionFailed));
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    if (!token) {
      return;
    }
    const draft = reviewDrafts[requestId];
    setReviewBusyById((current) => ({ ...current, [requestId]: true }));
    setError(null);
    try {
      await reviewAccessRequest(requestId, token, {
        decision,
        assigned_role: draft?.assigned_role,
        assigned_site_id: draft?.assigned_site_id,
        reviewer_notes: draft?.reviewer_notes,
      });
      setAdminRequests(await fetchAccessRequests(token, "pending"));
    } catch (nextError) {
      setError(describeError(nextError, pick(locale, "Review failed.", "검토에 실패했습니다.")));
    } finally {
      setReviewBusyById((current) => ({ ...current, [requestId]: false }));
    }
  }

  async function handleManifestDownload() {
    if (!token || !selectedSiteId) {
      return;
    }
    const blob = await downloadManifest(selectedSiteId, token);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedSiteId}_dataset_manifest.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function handleLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setWorkspaceMode("canvas");
    setOperationsSection("dashboard");
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setPatients([]);
    setMyRequests([]);
    setAdminRequests([]);
  }

  if (!token || !user) {
    return (
      <main className="shell">
        <div className="shell-toolbar">
          <LocaleToggle />
        </div>
        {GOOGLE_CLIENT_ID ? (
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => setGoogleReady(true)}
          />
        ) : null}
        <section className="hero">
          <article className="hero-card hero-copy">
            <div>
              <div className="eyebrow">{copy.heroEyebrow}</div>
              <h1>{pick(locale, "K-ERA", "K-ERA")}</h1>
              <p>{copy.heroBody}</p>
            </div>
            <div className="highlight-grid">
              <div className="highlight">
                <strong>{copy.highlightGoogleTitle}</strong>
                <span className="muted">{copy.highlightGoogleBody}</span>
              </div>
              <div className="highlight">
                <strong>{copy.highlightApprovalTitle}</strong>
                <span className="muted">{copy.highlightApprovalBody}</span>
              </div>
              <div className="highlight">
                <strong>{copy.highlightCanvasTitle}</strong>
                <span className="muted">{copy.highlightCanvasBody}</span>
              </div>
              <div className="highlight">
                <strong>{copy.highlightRecoveryTitle}</strong>
                <span className="muted">{copy.highlightRecoveryBody}</span>
              </div>
            </div>
          </article>

          <section className="hero-card login-panel">
            <div className="eyebrow">{copy.signIn}</div>
            <h2>{copy.enterWorkspace}</h2>
            <p className="muted">{copy.signInBody}</p>
            {GOOGLE_CLIENT_ID ? (
              <div className="google-panel">
                <div className="field">
                  <label>{copy.googleLogin}</label>
                  <div ref={googleButtonRef} className="google-button-slot" />
                </div>
              </div>
            ) : (
              <div className="empty">{copy.googleDisabled}</div>
            )}
            {error ? <div className="error">{error}</div> : null}
            <div className="divider-line">{copy.adminRecoveryOnly}</div>
            <Link href="/admin-login" className="secondary-button">
              {adminRecoveryLinkLabel}
            </Link>
            <div className="login-utility-links">
              {adminLaunchLinks.map((item) => (
                <Link key={item.href} href={item.href} className="text-button">
                  {item.label}
                </Link>
              ))}
            </div>
          </section>
        </section>
      </main>
    );
  }

  if (!approved) {
    return (
      <main className="shell">
        <div className="shell-toolbar">
          <LocaleToggle />
        </div>
        <section className="dashboard">
          <div className="section-head">
            <div>
              <div className="eyebrow">{copy.approvalRequired}</div>
              <h2>{copy.institutionAccessRequest}</h2>
              <p className="muted">{copy.signedInAs(user.full_name, user.username)}</p>
            </div>
            <button className="secondary-button" type="button" onClick={handleLogout}>
              {copy.logOut}
            </button>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="approval-grid">
            <article className="content-card approval-status-card">
              <div className="eyebrow">{copy.currentStatus}</div>
              <h3>{statusCopy(locale, user.approval_status)}</h3>
              <p className="muted">{copy.approvedBody}</p>
              <div className={`status-chip tone-${user.approval_status}`}>{translateStatus(locale, user.approval_status)}</div>
              {myRequests.length === 0 ? (
                <div className="empty">{copy.noInstitutionRequest}</div>
              ) : (
                <div className="request-list">
                  {myRequests.map((request) => (
                    <div key={request.request_id} className="request-item">
                      <strong>{request.requested_site_id}</strong>
                      <div className="muted">
                        {translateRole(locale, request.requested_role)} · {translateStatus(locale, request.status)}
                      </div>
                      {request.message ? <div className="muted">“{request.message}”</div> : null}
                      {request.reviewer_notes ? <div className="muted">{copy.reviewerLabel}: {request.reviewer_notes}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="content-card approval-form-card">
              <div className="eyebrow">{copy.requestAccess}</div>
              <h3>{copy.chooseInstitutionRole}</h3>
              <form className="stack" onSubmit={handleRequestAccess}>
                <div className="field">
                  <label htmlFor="requested_site_id">{copy.hospital}</label>
                  <select
                    id="requested_site_id"
                    value={requestForm.requested_site_id}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, requested_site_id: event.target.value }))
                    }
                  >
                    {publicSites.map((site) => (
                      <option key={site.site_id} value={site.site_id}>
                        {site.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="requested_role">{copy.requestedRole}</label>
                  <select
                    id="requested_role"
                    value={requestForm.requested_role}
                    onChange={(event) => setRequestForm((current) => ({ ...current, requested_role: event.target.value }))}
                  >
                    <option value="researcher">{translateRole(locale, "researcher")}</option>
                    <option value="viewer">{translateRole(locale, "viewer")}</option>
                    <option value="site_admin">{translateRole(locale, "site_admin")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="message">{copy.noteForReviewer}</label>
                  <textarea
                    id="message"
                    rows={4}
                    value={requestForm.message}
                    onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder={copy.requestPlaceholder}
                  />
                </div>
                <button className="primary-button" type="submit" disabled={requestBusy || !requestForm.requested_site_id}>
                  {requestBusy ? copy.submitting : copy.submitInstitutionRequest}
                </button>
              </form>
            </article>
          </section>
        </section>
      </main>
    );
  }

  if (workspaceMode === "canvas" || !canOpenOperations) {
    return (
      <CaseWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        canOpenOperations={canOpenOperations}
        onSelectSite={setSelectedSiteId}
        onExportManifest={handleManifestDownload}
        onLogout={handleLogout}
        onOpenOperations={(section) => {
          setOperationsSection(section ?? "dashboard");
          setWorkspaceMode("operations");
        }}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
        theme={workspaceTheme}
        onToggleTheme={() => setWorkspaceTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
    );
  }

  if (workspaceMode === "operations" && canOpenOperations) {
    return (
      <AdminWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        initialSection={operationsSection}
        onSelectSite={setSelectedSiteId}
        onOpenCanvas={() => setWorkspaceMode("canvas")}
        onLogout={handleLogout}
        onRefreshSites={() => refreshApprovedSites(token)}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
        theme={workspaceTheme}
        onToggleTheme={() => setWorkspaceTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
    );
  }

  return null;
}
