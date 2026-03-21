"use client";

import { type ReactNode } from "react";

import { workspaceNoiseClass, workspaceShellClass, workspaceToastClass } from "../ui/workspace-patterns";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type CaseWorkspaceShellProps = {
  theme: "dark" | "light";
  toast: ToastState;
  savedLabel: string;
  actionNeededLabel: string;
  children: ReactNode;
};

export function CaseWorkspaceShell({
  theme,
  toast,
  savedLabel,
  actionNeededLabel,
  children,
}: CaseWorkspaceShellProps) {
  return (
    <main className={workspaceShellClass} data-workspace-theme={theme}>
      <div className={workspaceNoiseClass} />
      {children}
      {toast ? (
        <div className={workspaceToastClass(toast.tone)}>
          <strong>{toast.tone === "success" ? savedLabel : actionNeededLabel}</strong>
          <span>{toast.message}</span>
        </div>
      ) : null}
    </main>
  );
}
