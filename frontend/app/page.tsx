"use client";

import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";

import {
  createPatient,
  downloadManifest,
  fetchAccessRequests,
  fetchMe,
  fetchMyAccessRequests,
  fetchPatients,
  fetchPublicSites,
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

type PatientRecord = {
  patient_id: string;
  sex: string;
  age: number;
  chart_alias?: string;
  local_case_code?: string;
};

type SiteSummary = {
  site_id: string;
  n_patients: number;
  n_visits: number;
  n_images: number;
  n_active_visits: number;
  n_validation_runs: number;
};

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

  const approved = user?.approval_status === "approved";
  const canReview = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));

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
        setSummary(nextSummary as SiteSummary);
        setPatients(nextPatients as PatientRecord[]);
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
      setPatients((await fetchPatients(selectedSiteId, token)) as PatientRecord[]);
      setSummary((await fetchSiteSummary(selectedSiteId, token)) as SiteSummary);
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
              <div className="eyebrow">Clinician Web Workspace</div>
              <h1>K-ERA Research Web</h1>
              <p>
                Google institution onboarding now sits in front of the clinician workflow. Approved users enter
                the site console, pending users stay in an approval lane until an admin reviews the request.
              </p>
            </div>
            <div className="highlight-grid">
              <div className="highlight">
                <strong>Google Sign-In</strong>
                <span className="muted">Researchers can sign in with a verified Google account.</span>
              </div>
              <div className="highlight">
                <strong>Approval Queue</strong>
                <span className="muted">Admins and site admins review hospital and role requests.</span>
              </div>
              <div className="highlight">
                <strong>PostgreSQL-backed</strong>
                <span className="muted">Users, requests, sites, and manifest exports stay in one backend.</span>
              </div>
              <div className="highlight">
                <strong>Fallback Admin</strong>
                <span className="muted">The local admin login remains available for setup and recovery.</span>
              </div>
            </div>
          </article>

          <section className="hero-card login-panel">
            <div className="eyebrow">Sign In</div>
            <h2>Enter the research platform</h2>
            <p className="muted">Google is for researcher onboarding. Local username/password remains for admin recovery.</p>
            {GOOGLE_CLIENT_ID ? (
              <div className="google-panel">
                <div className="field">
                  <label>Researcher Google login</label>
                  <div ref={googleButtonRef} className="google-button-slot" />
                </div>
              </div>
            ) : (
              <div className="empty">Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set.</div>
            )}
            <div className="divider-line">Administrator fallback</div>
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
                {loading ? "Connecting..." : "Login to API"}
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

  return (
    <main className="shell">
      <section className="dashboard">
        <div className="section-head">
          <div>
            <div className="eyebrow">FastAPI + Next.js</div>
            <h2>Clinician Research Console</h2>
            <p className="muted">
              Logged in as {user.full_name} · {user.role}
            </p>
          </div>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => void handleManifestDownload()} disabled={!selectedSiteId}>
              Export Manifest CSV
            </button>
            <button className="secondary-button" type="button" onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <section className="page-grid">
          <aside className="sidebar-card">
            <div className="eyebrow">Sites</div>
            <h3>Accessible hospitals</h3>
            <div className="site-list">
              {sites.length === 0 ? (
                <div className="empty">No sites are assigned to this account yet.</div>
              ) : (
                sites.map((site) => (
                  <button
                    key={site.site_id}
                    className={`site-button ${selectedSiteId === site.site_id ? "active" : ""}`}
                    type="button"
                    onClick={() => setSelectedSiteId(site.site_id)}
                  >
                    <strong>{site.display_name}</strong>
                    <div className="muted">{site.hospital_name || site.site_id}</div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="content-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">Dashboard</div>
                <h3>{selectedSiteId ? `Site ${selectedSiteId}` : "Choose a site"}</h3>
              </div>
              {selectedSiteId ? <span className="status-chip">API connected</span> : null}
            </div>

            {summary ? (
              <div className="metric-grid">
                <div className="metric-card">
                  <strong>{summary.n_patients}</strong>
                  <span className="muted">Patients</span>
                </div>
                <div className="metric-card">
                  <strong>{summary.n_visits}</strong>
                  <span className="muted">Visits</span>
                </div>
                <div className="metric-card">
                  <strong>{summary.n_images}</strong>
                  <span className="muted">Images</span>
                </div>
                <div className="metric-card">
                  <strong>{summary.n_validation_runs}</strong>
                  <span className="muted">Validation runs</span>
                </div>
              </div>
            ) : (
              <div className="empty">Select a site to load the API-backed summary.</div>
            )}

            <div className="split" style={{ marginTop: 24 }}>
              <section className="panel" style={{ padding: 20 }}>
                <div className="section-head">
                  <div>
                    <div className="eyebrow">Create Patient</div>
                    <h3>First migrated workflow</h3>
                  </div>
                </div>
                <form className="stack" onSubmit={handleCreatePatient}>
                  <div className="field">
                    <label htmlFor="patient_id">Patient ID</label>
                    <input
                      id="patient_id"
                      value={patientForm.patient_id}
                      onChange={(event) => setPatientForm((current) => ({ ...current, patient_id: event.target.value }))}
                      disabled={!selectedSiteId}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sex">Sex</label>
                    <select
                      id="sex"
                      value={patientForm.sex}
                      onChange={(event) => setPatientForm((current) => ({ ...current, sex: event.target.value }))}
                    >
                      <option value="female">female</option>
                      <option value="male">male</option>
                      <option value="other">other</option>
                      <option value="unknown">unknown</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="age">Age</label>
                    <input
                      id="age"
                      type="number"
                      value={patientForm.age}
                      onChange={(event) => setPatientForm((current) => ({ ...current, age: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="chart_alias">Chart Alias</label>
                    <input
                      id="chart_alias"
                      value={patientForm.chart_alias}
                      onChange={(event) => setPatientForm((current) => ({ ...current, chart_alias: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="local_case_code">Local Case Code</label>
                    <input
                      id="local_case_code"
                      value={patientForm.local_case_code}
                      onChange={(event) => setPatientForm((current) => ({ ...current, local_case_code: event.target.value }))}
                    />
                  </div>
                  <button className="primary-button" type="submit" disabled={loading || !selectedSiteId}>
                    {loading ? "Saving..." : "Create patient"}
                  </button>
                </form>
              </section>

              <section className="panel" style={{ padding: 20 }}>
                <div className="section-head">
                  <div>
                    <div className="eyebrow">Patients</div>
                    <h3>Current site records</h3>
                  </div>
                </div>
                {patients.length === 0 ? (
                  <div className="empty">No patient rows yet. Create one to validate the new API flow.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Patient</th>
                          <th>Sex</th>
                          <th>Age</th>
                          <th>Alias</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patients
                          .slice()
                          .sort((a, b) => a.patient_id.localeCompare(b.patient_id))
                          .map((patient) => (
                            <tr key={patient.patient_id}>
                              <td>{patient.patient_id}</td>
                              <td>{patient.sex}</td>
                              <td>{patient.age}</td>
                              <td>{patient.chart_alias || patient.local_case_code || "-"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {canReview ? (
              <section className="approval-admin-panel">
                <div className="section-head">
                  <div>
                    <div className="eyebrow">Approval Queue</div>
                    <h3>Pending institution requests</h3>
                  </div>
                </div>
                {adminRequests.length === 0 ? (
                  <div className="empty">No pending requests right now.</div>
                ) : (
                  <div className="request-list admin-list">
                    {adminRequests.map((request) => {
                      const draft = reviewDrafts[request.request_id] ?? {
                        assigned_role: request.requested_role,
                        assigned_site_id: request.requested_site_id,
                        reviewer_notes: "",
                      };
                      return (
                        <div key={request.request_id} className="request-item admin-item">
                          <div className="request-item-head">
                            <div>
                              <strong>{request.email}</strong>
                              <div className="muted">
                                requested {request.requested_role} at {request.requested_site_id}
                              </div>
                            </div>
                            <span className="status-chip tone-pending">pending</span>
                          </div>
                          {request.message ? <p className="muted">{request.message}</p> : null}
                          <div className="review-grid">
                            <div className="field">
                              <label>Assign site</label>
                              <select
                                value={draft.assigned_site_id}
                                onChange={(event) =>
                                  setReviewDrafts((current) => ({
                                    ...current,
                                    [request.request_id]: { ...draft, assigned_site_id: event.target.value },
                                  }))
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
                              <label>Assign role</label>
                              <select
                                value={draft.assigned_role}
                                onChange={(event) =>
                                  setReviewDrafts((current) => ({
                                    ...current,
                                    [request.request_id]: { ...draft, assigned_role: event.target.value },
                                  }))
                                }
                              >
                                <option value="site_admin">site_admin</option>
                                <option value="researcher">researcher</option>
                                <option value="viewer">viewer</option>
                              </select>
                            </div>
                          </div>
                          <div className="field">
                            <label>Reviewer notes</label>
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
                          </div>
                          <div className="button-row">
                            <button className="primary-button" type="button" disabled={loading} onClick={() => void handleReview(request.request_id, "approved")}>
                              Approve
                            </button>
                            <button className="secondary-button" type="button" disabled={loading} onClick={() => void handleReview(request.request_id, "rejected")}>
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}
