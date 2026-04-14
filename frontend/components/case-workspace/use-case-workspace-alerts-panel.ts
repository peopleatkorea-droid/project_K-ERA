"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  CaseWorkspaceToastLogEntry,
  CaseWorkspaceToastState,
} from "./case-workspace-definitions";

type Args = {
  maxEntries?: number;
};

type Result = {
  toast: CaseWorkspaceToastState;
  alertsPanelOpen: boolean;
  alertsPanelRef: RefObject<HTMLDivElement | null>;
  toastHistory: CaseWorkspaceToastLogEntry[];
  setToast: Dispatch<SetStateAction<CaseWorkspaceToastState>>;
  toggleAlertsPanel: () => void;
  clearToastHistory: () => void;
};

export function useCaseWorkspaceAlertsPanel({
  maxEntries = 8,
}: Args = {}): Result {
  const [toast, setToastState] = useState<CaseWorkspaceToastState>(null);
  const [toastHistory, setToastHistory] = useState<CaseWorkspaceToastLogEntry[]>(
    [],
  );
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const alertsPanelRef = useRef<HTMLDivElement | null>(null);

  const setToast = useCallback<
    Dispatch<SetStateAction<CaseWorkspaceToastState>>
  >(
    (nextValue) => {
      setToastState((current) => {
        const resolved =
          typeof nextValue === "function" ? nextValue(current) : nextValue;
        if (resolved) {
          setToastHistory((existing) =>
            [
              {
                id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                tone: resolved.tone,
                message: resolved.message,
                created_at: new Date().toISOString(),
              },
              ...existing,
            ].slice(0, maxEntries),
          );
        }
        return resolved;
      });
    },
    [maxEntries],
  );

  const toggleAlertsPanel = useCallback(() => {
    setAlertsPanelOpen((current) => !current);
  }, []);

  const clearToastHistory = useCallback(() => {
    setToastHistory([]);
  }, []);

  useEffect(() => {
    if (!alertsPanelOpen) {
      return;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (alertsPanelRef.current?.contains(target)) {
        return;
      }
      setAlertsPanelOpen(false);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAlertsPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [alertsPanelOpen]);

  return {
    toast,
    alertsPanelOpen,
    alertsPanelRef,
    toastHistory,
    setToast,
    toggleAlertsPanel,
    clearToastHistory,
  };
}
