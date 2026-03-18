"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

import {
  controlPlaneDevLogin,
  controlPlaneFetchMe,
  controlPlaneFetchModelUpdates,
  controlPlaneFetchModelVersions,
  controlPlaneFetchNodes,
  controlPlaneFetchOverview,
  controlPlaneGoogleLogin,
  controlPlaneLogout,
  controlPlanePublishModelVersion,
  controlPlaneRegisterNode,
  controlPlaneReviewModelUpdate,
} from "../lib/control-plane-client";
import { persistLocalNodeCredentials } from "../lib/local-node-client";
import type {
  ControlPlaneModelUpdate,
  ControlPlaneModelVersion,
  ControlPlaneNode,
  ControlPlaneOverview,
  ControlPlaneUser,
} from "../lib/control-plane/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Field } from "./ui/field";
import { SectionHeader } from "./ui/section-header";

type LoadState = {
  me: ControlPlaneUser | null;
  overview: ControlPlaneOverview | null;
  nodes: ControlPlaneNode[];
  updates: ControlPlaneModelUpdate[];
  versions: ControlPlaneModelVersion[];
};

const initialState: LoadState = {
  me: null,
  overview: null,
  nodes: [],
  updates: [],
  versions: [],
};

export function ControlPlaneConsole() {
  const [state, setState] = useState<LoadState>(initialState);
  const [loading, setLoading] = useState(true);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"dev" | "google">("dev");
  const [devLoginForm, setDevLoginForm] = useState({ email: "", fullName: "" });
  const [googleToken, setGoogleToken] = useState("");
  const [registrationForm, setRegistrationForm] = useState({
    device_name: "local-node",
    os_info: "Windows",
    app_version: "0.1.0",
    site_id: "",
    display_name: "",
    hospital_name: "",
    source_institution_id: "",
  });
  const [publishForm, setPublishForm] = useState({
    version_id: "",
    version_name: "",
    architecture: "convnext_tiny",
    download_url: "",
    sha256: "",
    size_bytes: "",
    source_provider: "download_url",
  });
  const [nodeSecret, setNodeSecret] = useState<{ nodeId: string; nodeToken: string } | null>(null);
  const [nodePersistenceStatus, setNodePersistenceStatus] = useState<string | null>(null);

  async function refresh(adminHint = false) {
    setLoading(true);
    setError(null);
    try {
      const me = await controlPlaneFetchMe();
      if (me.global_role === "admin" || adminHint) {
        const [overview, nodes, updates, versions] = await Promise.all([
          controlPlaneFetchOverview(),
          controlPlaneFetchNodes(),
          controlPlaneFetchModelUpdates(),
          controlPlaneFetchModelVersions(),
        ]);
        setState({ me, overview, nodes, updates, versions });
      } else {
        setState((current) => ({ ...current, me }));
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to load the control plane.";
      setError(message);
      setState(initialState);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function handleDevLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setError(null);
        await controlPlaneDevLogin(devLoginForm.email, devLoginForm.fullName);
        await refresh(true);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Login failed.");
      }
    });
  }

  function handleGoogleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setError(null);
        await controlPlaneGoogleLogin(googleToken);
        await refresh(true);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Google login failed.");
      }
    });
  }

  function handleNodeRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setError(null);
        setNodePersistenceStatus(null);
        const result = await controlPlaneRegisterNode(registrationForm);
        setNodeSecret({
          nodeId: result.node_id,
          nodeToken: result.node_token,
        });
        try {
          await persistLocalNodeCredentials({
            control_plane_base_url: `${window.location.origin}/control-plane/api`,
            node_id: result.node_id,
            node_token: result.node_token,
            site_id: result.bootstrap.site.site_id,
            overwrite: true,
          });
          setNodePersistenceStatus("Stored on the local node.");
        } catch (persistError) {
          setNodePersistenceStatus(
            persistError instanceof Error
              ? `Issued but not stored locally: ${persistError.message}`
              : "Issued but not stored locally.",
          );
        }
        await refresh(true);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Node registration failed.");
      }
    });
  }

  function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setError(null);
        await controlPlanePublishModelVersion({
          version_id: publishForm.version_id || undefined,
          version_name: publishForm.version_name,
          architecture: publishForm.architecture,
          download_url: publishForm.download_url,
          sha256: publishForm.sha256,
          size_bytes: Number(publishForm.size_bytes || 0),
          source_provider: publishForm.source_provider,
        });
        await refresh(true);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Model publish failed.");
      }
    });
  }

  function handleReview(updateId: string, decision: "approved" | "rejected") {
    startTransition(async () => {
      try {
        setError(null);
        await controlPlaneReviewModelUpdate(updateId, decision, "");
        await refresh(true);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Update review failed.");
      }
    });
  }

  function handleLogout() {
    startTransition(async () => {
      await controlPlaneLogout();
      setNodeSecret(null);
      setState(initialState);
      await refresh();
    });
  }

  const currentVersion = state.versions.find((item) => item.is_current) || null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.12),transparent_36%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-6xl gap-5">
        <Card as="section" variant="surface" className="grid gap-6 p-6 sm:p-8">
          <SectionHeader
            eyebrow={
              <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                Local-First Control Plane
              </span>
            }
            title="Central control plane sandbox"
            description="Run the Vercel-targeted control plane locally first. Use development auth for local wiring, then switch to Google sign-in before deployment."
            aside={
              state.me ? (
                <Button variant="ghost" onClick={handleLogout} disabled={busy}>
                  Sign out
                </Button>
              ) : null
            }
          />

          {error ? (
            <div className="rounded-[14px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          {!state.me ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card variant="panel" className="grid gap-4 p-5">
                <SectionHeader title="Development login" description="Use this only for local development before the real Google flow is enabled." titleAs="h4" />
                <div className="inline-flex gap-2 rounded-full border border-border bg-surface-muted/60 p-1">
                  <button
                    className={`rounded-full px-3 py-1.5 text-sm ${authMode === "dev" ? "bg-white text-ink" : "text-muted"}`}
                    onClick={() => setAuthMode("dev")}
                    type="button"
                  >
                    Dev
                  </button>
                  <button
                    className={`rounded-full px-3 py-1.5 text-sm ${authMode === "google" ? "bg-white text-ink" : "text-muted"}`}
                    onClick={() => setAuthMode("google")}
                    type="button"
                  >
                    Google token
                  </button>
                </div>

                {authMode === "dev" ? (
                  <form className="grid gap-4" onSubmit={handleDevLogin}>
                    <Field as="div" label="Email" htmlFor="cp-dev-email">
                      <input
                        id="cp-dev-email"
                        value={devLoginForm.email}
                        onChange={(event) => setDevLoginForm((current) => ({ ...current, email: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="Full name" htmlFor="cp-dev-name">
                      <input
                        id="cp-dev-name"
                        value={devLoginForm.fullName}
                        onChange={(event) => setDevLoginForm((current) => ({ ...current, fullName: event.target.value }))}
                      />
                    </Field>
                    <Button type="submit" variant="primary" disabled={busy}>
                      {busy ? "Connecting..." : "Enter control plane"}
                    </Button>
                  </form>
                ) : (
                  <form className="grid gap-4" onSubmit={handleGoogleLogin}>
                    <Field
                      as="div"
                      label="Google ID token"
                      hint="This is useful after you connect a Google Identity Services button or test token issuer locally."
                      htmlFor="cp-google-token"
                    >
                      <textarea
                        id="cp-google-token"
                        value={googleToken}
                        rows={5}
                        onChange={(event) => setGoogleToken(event.target.value)}
                      />
                    </Field>
                    <Button type="submit" variant="primary" disabled={busy}>
                      {busy ? "Verifying..." : "Sign in with token"}
                    </Button>
                  </form>
                )}
              </Card>

              <Card variant="panel" className="grid gap-4 p-5">
                <SectionHeader title="What this page covers" description="This is intentionally small. The local node still owns patient data, validation, and contribution generation." titleAs="h4" />
                <ul className="grid gap-2 text-sm text-muted">
                  <li>Google or development login</li>
                  <li>Site bootstrap and node registration</li>
                  <li>Current release manifest management</li>
                  <li>Model update review queue</li>
                  <li>LLM relay API behind the central session</li>
                </ul>
              </Card>
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <Card variant="panel" className="grid gap-4 p-5">
                  <SectionHeader title="Signed-in identity" description="This account is stored in the central control plane database." titleAs="h4" />
                  <dl className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Email</dt>
                      <dd>{state.me.email}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Role</dt>
                      <dd>{state.me.global_role}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Memberships</dt>
                      <dd>{state.me.memberships.length}</dd>
                    </div>
                  </dl>
                  {state.me.memberships.length ? (
                    <div className="grid gap-2">
                      {state.me.memberships.map((membership) => (
                        <div key={membership.membership_id} className="rounded-[12px] border border-border bg-surface-muted/50 px-4 py-3 text-sm">
                          <div className="font-semibold">{membership.site?.display_name || membership.site_id}</div>
                          <div className="text-muted">
                            {membership.role} / {membership.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>

                <Card variant="panel" className="grid gap-4 p-5">
                  <SectionHeader title="Register a local node" description="If this user has no approved site yet, the first registration can create one." titleAs="h4" />
                  <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleNodeRegistration}>
                    <Field as="div" label="Device name" htmlFor="cp-device-name">
                      <input
                        id="cp-device-name"
                        value={registrationForm.device_name}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, device_name: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="App version" htmlFor="cp-app-version">
                      <input
                        id="cp-app-version"
                        value={registrationForm.app_version}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, app_version: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="Site ID" htmlFor="cp-site-id">
                      <input
                        id="cp-site-id"
                        value={registrationForm.site_id}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, site_id: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="Display name" htmlFor="cp-display-name">
                      <input
                        id="cp-display-name"
                        value={registrationForm.display_name}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, display_name: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="Hospital name" htmlFor="cp-hospital-name">
                      <input
                        id="cp-hospital-name"
                        value={registrationForm.hospital_name}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, hospital_name: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" label="Source institution ID" htmlFor="cp-source-inst">
                      <input
                        id="cp-source-inst"
                        value={registrationForm.source_institution_id}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, source_institution_id: event.target.value }))}
                      />
                    </Field>
                    <Field as="div" className="sm:col-span-2" label="OS info" htmlFor="cp-os-info">
                      <input
                        id="cp-os-info"
                        value={registrationForm.os_info}
                        onChange={(event) => setRegistrationForm((current) => ({ ...current, os_info: event.target.value }))}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Button type="submit" variant="primary" disabled={busy}>
                        {busy ? "Registering..." : "Register node"}
                      </Button>
                    </div>
                  </form>

                  {nodeSecret ? (
                    <div className="rounded-[12px] border border-brand/20 bg-[rgba(48,88,255,0.05)] px-4 py-3 text-sm">
                      <div className="font-semibold">Node credentials</div>
                      <div className="mt-2 break-all text-muted">node_id: {nodeSecret.nodeId}</div>
                      <div className="mt-1 break-all text-muted">node_token: {nodeSecret.nodeToken}</div>
                      {nodePersistenceStatus ? (
                        <div className="mt-2 text-muted">{nodePersistenceStatus}</div>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </div>

              {state.me.global_role === "admin" ? (
                <div className="grid gap-5">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <Card variant="panel" className="grid gap-4 p-5">
                      <SectionHeader title="Overview" description={loading ? "Loading..." : "Minimal central status for the local-first control plane."} titleAs="h4" />
                      <dl className="grid gap-2 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-muted">Users</dt><dd>{state.overview?.user_count ?? 0}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Sites</dt><dd>{state.overview?.site_count ?? 0}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Nodes</dt><dd>{state.overview?.node_count ?? 0}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Pending updates</dt><dd>{state.overview?.pending_model_updates ?? 0}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Current model</dt><dd>{state.overview?.current_model_version || "-"}</dd></div>
                      </dl>
                    </Card>

                    <Card variant="panel" className="grid gap-4 p-5">
                      <SectionHeader title="Publish current release" description="The central plane stores only metadata. Keep model binaries in OneDrive or S3 and paste the release URL here." titleAs="h4" />
                      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handlePublish}>
                        <Field as="div" label="Version ID" htmlFor="cp-version-id">
                          <input
                            id="cp-version-id"
                            value={publishForm.version_id}
                            onChange={(event) => setPublishForm((current) => ({ ...current, version_id: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" label="Version name" htmlFor="cp-version-name">
                          <input
                            id="cp-version-name"
                            value={publishForm.version_name}
                            onChange={(event) => setPublishForm((current) => ({ ...current, version_name: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" label="Architecture" htmlFor="cp-arch">
                          <input
                            id="cp-arch"
                            value={publishForm.architecture}
                            onChange={(event) => setPublishForm((current) => ({ ...current, architecture: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" label="Source provider" htmlFor="cp-provider">
                          <input
                            id="cp-provider"
                            value={publishForm.source_provider}
                            onChange={(event) => setPublishForm((current) => ({ ...current, source_provider: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" className="sm:col-span-2" label="Download URL" htmlFor="cp-download-url">
                          <input
                            id="cp-download-url"
                            value={publishForm.download_url}
                            onChange={(event) => setPublishForm((current) => ({ ...current, download_url: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" label="SHA256" htmlFor="cp-sha">
                          <input
                            id="cp-sha"
                            value={publishForm.sha256}
                            onChange={(event) => setPublishForm((current) => ({ ...current, sha256: event.target.value }))}
                          />
                        </Field>
                        <Field as="div" label="Size bytes" htmlFor="cp-size">
                          <input
                            id="cp-size"
                            value={publishForm.size_bytes}
                            onChange={(event) => setPublishForm((current) => ({ ...current, size_bytes: event.target.value }))}
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          <Button type="submit" variant="primary" disabled={busy}>
                            {busy ? "Publishing..." : "Publish model"}
                          </Button>
                        </div>
                      </form>
                      {currentVersion ? (
                        <div className="rounded-[12px] border border-border bg-surface-muted/50 px-4 py-3 text-sm">
                          Current release: <span className="font-semibold">{currentVersion.version_name}</span>
                        </div>
                      ) : null}
                    </Card>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <Card variant="panel" className="grid gap-4 p-5">
                      <SectionHeader title="Pending model updates" description="Approve or reject metadata-only update submissions from local nodes." titleAs="h4" />
                      <div className="grid gap-3">
                        {state.updates.length ? (
                          state.updates.map((update) => (
                            <div key={update.update_id} className="rounded-[12px] border border-border bg-surface-muted/55 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="grid gap-1 text-sm">
                                  <div className="font-semibold">{update.update_id}</div>
                                  <div className="text-muted">
                                    site: {update.site_id || "-"} / node: {update.node_id || "-"} / status: {update.status}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="primary" onClick={() => handleReview(update.update_id, "approved")} disabled={busy}>
                                    Approve
                                  </Button>
                                  <Button size="sm" variant="danger" onClick={() => handleReview(update.update_id, "rejected")} disabled={busy}>
                                    Reject
                                  </Button>
                                </div>
                              </div>
                              <pre className="mt-3 overflow-x-auto rounded-[10px] bg-surface px-3 py-2 text-xs text-muted">
                                {JSON.stringify(update.payload_json, null, 2)}
                              </pre>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[12px] border border-border bg-surface-muted/55 px-4 py-3 text-sm text-muted">
                            No model updates have been uploaded yet.
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card variant="panel" className="grid gap-4 p-5">
                      <SectionHeader title="Registered nodes" description="These nodes were registered through the control plane API and can call bootstrap/heartbeat/current-release." titleAs="h4" />
                      <div className="grid gap-3">
                        {state.nodes.length ? (
                          state.nodes.map((node) => (
                            <div key={node.node_id} className="rounded-[12px] border border-border bg-surface-muted/55 px-4 py-3 text-sm">
                              <div className="font-semibold">{node.device_name}</div>
                              <div className="text-muted">site: {node.site_id}</div>
                              <div className="text-muted">app: {node.app_version || "-"}</div>
                              <div className="text-muted">last seen: {node.last_seen_at || "-"}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[12px] border border-border bg-surface-muted/55 px-4 py-3 text-sm text-muted">
                            No nodes registered yet.
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}
