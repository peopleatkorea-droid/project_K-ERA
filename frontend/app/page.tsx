"use client";

import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AdminWorkspace } from "../components/admin-workspace";
import { CaseWorkspace } from "../components/case-workspace";
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
  login,
  reviewAccessRequest,
  submitAccessRequest,
  type AccessRequestRecord,
  type AuthResponse,
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
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

function statusCopy(status: AuthState): string {
  if (status === "pending") {
    return "Your institution request is pending review.";
  }
  if (status === "rejected") {
    return "Your last institution request was rejected. Submit a revised request.";
  }
  if (status === "application_required") {
    return "Submit your institution and role request to continue.";
  }
  return "Approved";
}

export default function HomePage() {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin123" });
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

  const approved = user?.approval_status === "approved";
  const canReview = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));
  const canOpenOperations = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
    }
  }, []);

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
        setError(nextError instanceof Error ? nextError.message : "Unable to load institutions.");
      });
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    const currentToken = token;
    async function bootstrap() {
      setLoading(true);
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
        setError(nextError instanceof Error ? nextError.message : "Failed to connect.");
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
  }, [token]);

  useEffect(() => {
    if (!token || !selectedSiteId || !approved) {
      return;
    }
    const currentToken = token;
    const currentSiteId = selectedSiteId;
    async function loadSite() {
      setLoading(true);
      setError(null);
      try {
        const [nextSummary, nextPatients] = await Promise.all([
          fetchSiteSummary(currentSiteId, currentToken),
          fetchPatients(currentSiteId, currentToken),
        ]);
        setSummary(nextSummary);
        setPatients(nextPatients);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load site data.");
      } finally {
        setLoading(false);
      }
    }
    void loadSite();
  }, [token, selectedSiteId, approved]);

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
        setError(nextError instanceof Error ? nextError.message : "Failed to load approval queue.");
      });
  }, [token, canReview]);

  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleButtonRef.current || !window.google?.accounts?.id) {
      return;
    }
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError("Google login did not return a credential.");
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const auth = await googleLogin(response.credential);
          window.localStorage.setItem(TOKEN_KEY, auth.access_token);
          setToken(auth.access_token);
          setUser(auth.user);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Google login failed.");
        } finally {
          setLoading(false);
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
  }, [googleReady, token]);

  async function applyAuth(auth: AuthResponse) {
    window.localStorage.setItem(TOKEN_KEY, auth.access_token);
    setToken(auth.access_token);
    setUser(auth.user);
  }

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

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await applyAuth(await login(loginForm.username, loginForm.password));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedSiteId) {
      return;
    }
    setLoading(true);
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
      setError(nextError instanceof Error ? nextError.message : "Patient creation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await submitAccessRequest(token, requestForm);
      setUser(response.user);
      setMyRequests(await fetchMyAccessRequests(token));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Request submission failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    if (!token) {
      return;
    }
    const draft = reviewDrafts[requestId];
    setLoading(true);
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
      setError(nextError instanceof Error ? nextError.message : "Review failed.");
    } finally {
      setLoading(false);
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
              <div className="eyebrow">Clinical Research Workspace</div>
              <h1>K-ERA Case Canvas</h1>
              <p>
                Sign in with your institution account, request the right site once, and move directly into a
                document-style case canvas after approval.
              </p>
            </div>
            <div className="highlight-grid">
              <div className="highlight">
                <strong>Google Sign-In</strong>
                <span className="muted">Researchers can onboard with a verified institution-linked Google account.</span>
              </div>
              <div className="highlight">
                <strong>Approval Queue</strong>
                <span className="muted">Admins review institution and role requests before site access opens.</span>
              </div>
              <div className="highlight">
                <strong>Case Canvas</strong>
                <span className="muted">Author, validate, and contribute cases from one continuous workspace.</span>
              </div>
              <div className="highlight">
                <strong>Admin Recovery</strong>
                <span className="muted">A local admin fallback remains available for setup and incident recovery.</span>
              </div>
            </div>
          </article>

          <section className="hero-card login-panel">
            <div className="eyebrow">Sign In</div>
            <h2>Enter the case workspace</h2>
            <p className="muted">Google is the default path for researchers. Local username/password stays admin-only for recovery.</p>
            {GOOGLE_CLIENT_ID ? (
              <div className="google-panel">
                <div className="field">
                  <label>Institution Google login</label>
                  <div ref={googleButtonRef} className="google-button-slot" />
                </div>
              </div>
            ) : (
              <div className="empty">Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set.</div>
            )}
            <div className="divider-line">Administrator recovery only</div>
            <form className="stack" onSubmit={handleLocalLogin}>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  value={loginForm.username}
                  onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                />
              </div>
              {error ? <div className="error">{error}</div> : null}
              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? "Connecting..." : "Enter admin recovery"}
              </button>
            </form>
          </section>
        </section>
      </main>
    );
  }

  if (!approved) {
    return (
      <main className="shell">
        <section className="dashboard">
          <div className="section-head">
            <div>
              <div className="eyebrow">Approval Required</div>
              <h2>Institution access request</h2>
              <p className="muted">
                Signed in as {user.full_name} ({user.username})
              </p>
            </div>
            <button className="secondary-button" type="button" onClick={handleLogout}>
              Log Out
            </button>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="approval-grid">
            <article className="content-card approval-status-card">
              <div className="eyebrow">Current Status</div>
              <h3>{statusCopy(user.approval_status)}</h3>
              <p className="muted">Approved accounts receive site access and enter the clinician console automatically.</p>
              <div className={`status-chip tone-${user.approval_status}`}>{user.approval_status}</div>
              {myRequests.length === 0 ? (
                <div className="empty">No institution request submitted yet.</div>
              ) : (
                <div className="request-list">
                  {myRequests.map((request) => (
                    <div key={request.request_id} className="request-item">
                      <strong>{request.requested_site_id}</strong>
                      <div className="muted">
                        {request.requested_role} · {request.status}
                      </div>
                      {request.message ? <div className="muted">“{request.message}”</div> : null}
                      {request.reviewer_notes ? <div className="muted">Reviewer: {request.reviewer_notes}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="content-card approval-form-card">
              <div className="eyebrow">Request Access</div>
              <h3>Choose your institution and role</h3>
              <form className="stack" onSubmit={handleRequestAccess}>
                <div className="field">
                  <label htmlFor="requested_site_id">Hospital</label>
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
                  <label htmlFor="requested_role">Requested role</label>
                  <select
                    id="requested_role"
                    value={requestForm.requested_role}
                    onChange={(event) => setRequestForm((current) => ({ ...current, requested_role: event.target.value }))}
                  >
                    <option value="researcher">researcher</option>
                    <option value="viewer">viewer</option>
                    <option value="site_admin">site_admin</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="message">Note for reviewer</label>
                  <textarea
                    id="message"
                    rows={4}
                    value={requestForm.message}
                    onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder="Department, study role, or context for this request."
                  />
                </div>
                <button className="primary-button" type="submit" disabled={loading || !requestForm.requested_site_id}>
                  {loading ? "Submitting..." : "Submit institution request"}
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
        onOpenOperations={() => setWorkspaceMode("operations")}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
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
        onSelectSite={setSelectedSiteId}
        onOpenCanvas={() => setWorkspaceMode("canvas")}
        onLogout={handleLogout}
        onRefreshSites={() => refreshApprovedSites(token)}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
      />
    );
  }

  return null;
}
