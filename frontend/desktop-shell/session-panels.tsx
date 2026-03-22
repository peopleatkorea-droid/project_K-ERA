"use client";

import type { FormEvent } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { SectionHeader } from "../components/ui/section-header";

import type { DesktopShellCopy } from "./shell-copy";

type LoginFormState = {
  username: string;
  password: string;
};

type DesktopLoginPanelProps = {
  copy: DesktopShellCopy;
  authBusy: boolean;
  backendHealthy: boolean;
  desktopGoogleAuthEnabled: boolean;
  loginForm: LoginFormState;
  showDevLogin: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGoogleLogin: () => void;
  onDevLogin: () => void;
  onLoginChange: (patch: Partial<LoginFormState>) => void;
};

export function DesktopLoginPanel({
  copy,
  authBusy,
  backendHealthy,
  desktopGoogleAuthEnabled,
  loginForm,
  showDevLogin,
  onSubmit,
  onGoogleLogin,
  onDevLogin,
  onLoginChange,
}: DesktopLoginPanelProps) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <SectionHeader title={copy.loginSectionTitle} description={copy.loginSectionDescription} />
      {desktopGoogleAuthEnabled ? (
        <Button type="button" variant="primary" disabled={authBusy || !backendHealthy} onClick={onGoogleLogin}>
          {authBusy ? copy.signingIn : copy.googleSignIn}
        </Button>
      ) : null}
      <Field as="div" label={copy.username} htmlFor="desktop-username">
        <input id="desktop-username" value={loginForm.username} onChange={(event) => onLoginChange({ username: event.target.value })} />
      </Field>
      <Field as="div" label={copy.password} htmlFor="desktop-password">
        <input
          id="desktop-password"
          type="password"
          value={loginForm.password}
          onChange={(event) => onLoginChange({ password: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={desktopGoogleAuthEnabled ? "ghost" : "primary"} disabled={authBusy || !backendHealthy}>
          {authBusy ? copy.signingIn : copy.signIn}
        </Button>
        {showDevLogin ? (
          <Button type="button" variant="ghost" disabled={authBusy || !backendHealthy} onClick={onDevLogin}>
            {copy.devSignIn}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

type DesktopSessionOpeningCardProps = {
  copy: DesktopShellCopy;
};

export function DesktopSessionOpeningCard({ copy }: DesktopSessionOpeningCardProps) {
  return (
    <Card as="section" variant="surface" className="grid gap-4 p-6">
      <SectionHeader title={copy.openingSessionTitle} description={copy.sessionBusy} />
    </Card>
  );
}

type DesktopBlockedCardProps = {
  copy: DesktopShellCopy;
  onLogout: () => void;
};

export function DesktopBlockedCard({ copy, onLogout }: DesktopBlockedCardProps) {
  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        title={copy.workspaceAccessRequiredTitle}
        description={copy.sessionBlocked}
        aside={
          <Button type="button" variant="ghost" size="sm" onClick={onLogout}>
            {copy.signOut}
          </Button>
        }
      />
    </Card>
  );
}
