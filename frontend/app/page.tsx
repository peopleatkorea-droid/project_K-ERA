"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createPatient,
  downloadManifest,
  fetchMe,
  fetchPatients,
  fetchSiteSummary,
  fetchSites,
  login,
  type LoginResponse,
} from "../lib/api";

type SiteRecord = {
  site_id: string;
  display_name: string;
  hospital_name: string;
};

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

const TOKEN_KEY = "kera_web_token";

export default function HomePage() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: "admin",
    password: "admin123",
    patient_id: "",
    sex: "female",
    age: "65",
    chart_alias: "",
    local_case_code: "",
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
    }
  }, []);

  useEffect(() => {
    async function bootstrap(currentToken: string) {
      setLoading(true);
      setError(null);
      try {
        const me = (await fetchMe(currentToken)) as LoginResponse["user"];
        const nextSites = (await fetchSites(currentToken)) as SiteRecord[];
        setUser(me);
        setSites(nextSites);
        setSelectedSiteId((previous) => previous ?? nextSites[0]?.site_id ?? null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to connect to the API.");
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      void bootstrap(token);
    }
  }, [token]);

  useEffect(() => {
    async function loadSiteData(currentToken: string, siteId: string) {
      setLoading(true);
      setError(null);
      try {
        const [nextSummary, nextPatients] = await Promise.all([
          fetchSiteSummary(siteId, currentToken),
          fetchPatients(siteId, currentToken),
        ]);
        setSummary(nextSummary as SiteSummary);
        setPatients(nextPatients as PatientRecord[]);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load site data.");
      } finally {
        setLoading(false);
      }
    }

    if (token && selectedSiteId) {
      void loadSiteData(token, selectedSiteId);
    }
  }, [selectedSiteId, token]);

  const orderedPatients = useMemo(
    () => [...patients].sort((a, b) => a.patient_id.localeCompare(b.patient_id)),
    [patients]
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await login(form.username, form.password);
      window.localStorage.setItem(TOKEN_KEY, response.access_token);
      setToken(response.access_token);
      setUser(response.user);
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
        patient_id: form.patient_id,
        sex: form.sex,
        age: Number(form.age),
        chart_alias: form.chart_alias,
        local_case_code: form.local_case_code,
      });
      const nextPatients = (await fetchPatients(selectedSiteId, token)) as PatientRecord[];
      const nextSummary = (await fetchSiteSummary(selectedSiteId, token)) as SiteSummary;
      setPatients(nextPatients);
      setSummary(nextSummary);
      setForm((current) => ({
        ...current,
        patient_id: "",
        chart_alias: "",
        local_case_code: "",
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Patient creation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleManifestDownload() {
    if (!token || !selectedSiteId) {
      return;
    }
    try {
      const blob = await downloadManifest(selectedSiteId, token);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedSiteId}_dataset_manifest.csv`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Manifest export failed.");
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setPatients([]);
  }

  if (!token || !user) {
    return (
      <main className="shell">
        <section className="hero">
          <article className="hero-card hero-copy">
            <div>
              <div className="eyebrow">Clinician Web Workspace</div>
              <h1>K-ERA Research Web</h1>
              <p>
                A FastAPI and Next.js migration path for the keratitis workflow. Start with
                secure login, site-aware case management, manifest export, and API-backed
                validation operations.
              </p>
            </div>
            <div className="highlight-grid">
              <div className="highlight">
                <strong>API-backed State</strong>
                <span className="muted">Patients, visits, and runs are served from PostgreSQL.</span>
              </div>
              <div className="highlight">
                <strong>Site-aware Access</strong>
                <span className="muted">The app respects role and site assignment from the backend.</span>
              </div>
              <div className="highlight">
                <strong>Manifest Export</strong>
                <span className="muted">The CSV is generated on demand from the current DB state.</span>
              </div>
              <div className="highlight">
                <strong>Migration-ready UX</strong>
                <span className="muted">This is the first vertical slice replacing the Streamlit shell.</span>
              </div>
            </div>
          </article>

          <section className="hero-card login-panel">
            <div className="eyebrow">Secure Sign In</div>
            <h2>Enter the API-backed workflow</h2>
            <p className="muted">
              Use an existing platform account first. Google login and institution approval can
              replace this screen later without changing the patient and site APIs.
            </p>
            <form className="stack" onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
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
            <button className="secondary-button" type="button" onClick={handleManifestDownload} disabled={!selectedSiteId}>
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
                      value={form.patient_id}
                      onChange={(event) => setForm((current) => ({ ...current, patient_id: event.target.value }))}
                      disabled={!selectedSiteId}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sex">Sex</label>
                    <select
                      id="sex"
                      value={form.sex}
                      onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))}
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
                      value={form.age}
                      onChange={(event) => setForm((current) => ({ ...current, age: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="chart_alias">Chart Alias</label>
                    <input
                      id="chart_alias"
                      value={form.chart_alias}
                      onChange={(event) => setForm((current) => ({ ...current, chart_alias: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="local_case_code">Local Case Code</label>
                    <input
                      id="local_case_code"
                      value={form.local_case_code}
                      onChange={(event) => setForm((current) => ({ ...current, local_case_code: event.target.value }))}
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
                {orderedPatients.length === 0 ? (
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
                        {orderedPatients.map((patient) => (
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
          </section>
        </section>
      </section>
    </main>
  );
}
