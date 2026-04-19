"use client";

import { memo, type ReactNode } from "react";

import type { CaseWorkspaceToastState } from "./case-workspace-definitions";
import { workspaceNoiseClass, workspaceShellClass, workspaceToastClass } from "../ui/workspace-patterns";

type CaseWorkspaceShellProps = {
  theme: "dark" | "light";
  children: ReactNode;
};

export type CaseWorkspaceToastOverlayProps = {
  toast: CaseWorkspaceToastState;
  savedLabel: string;
  actionNeededLabel: string;
};

export const CaseWorkspaceToastOverlay = memo(function CaseWorkspaceToastOverlay({
  toast,
  savedLabel,
  actionNeededLabel,
}: CaseWorkspaceToastOverlayProps) {
  if (!toast) {
    return null;
  }
  return (
    <div className={workspaceToastClass(toast.tone)}>
      <strong>{toast.tone === "success" ? savedLabel : actionNeededLabel}</strong>
      <span>{toast.message}</span>
    </div>
  );
});

export function CaseWorkspaceShell({
  theme,
  children,
}: CaseWorkspaceShellProps) {
  return (
    <main className={workspaceShellClass} data-workspace-theme={theme}>
      <div className={workspaceNoiseClass} />
      {children}
    </main>
  );
}
