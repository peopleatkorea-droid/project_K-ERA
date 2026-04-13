"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { CaseSummaryRecord } from "../../lib/api";
import type { SavedImagePreview } from "./shared";
import {
  buildWorkspaceHistoryEntry,
  isSameWorkspaceHistoryEntry,
  readWorkspaceHistoryEntry,
  writeWorkspaceHistoryEntry,
  type WorkspaceHistoryEntry,
} from "./case-workspace-core-helpers";

type Args = {
  cases: CaseSummaryRecord[];
  railView: "cases" | "patients";
  selectedCaseId: string | null;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setRailView: Dispatch<SetStateAction<"cases" | "patients">>;
  setSelectedCase: Dispatch<SetStateAction<CaseSummaryRecord | null>>;
  setSelectedCaseImages: Dispatch<SetStateAction<SavedImagePreview[]>>;
};

export function useCaseWorkspaceBrowserHistory({
  cases,
  railView,
  selectedCaseId,
  setPanelOpen,
  setRailView,
  setSelectedCase,
  setSelectedCaseImages,
}: Args) {
  const workspaceHistoryRef = useRef<WorkspaceHistoryEntry | null>(null);
  const workspacePopNavigationRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const historyEntry = readWorkspaceHistoryEntry(event.state);
      if (!historyEntry) {
        return;
      }

      workspacePopNavigationRef.current = true;
      setPanelOpen(true);
      setRailView(historyEntry.rail_view);
      setSelectedCase(
        historyEntry.selected_case_id
          ? (cases.find((item) => item.case_id === historyEntry.selected_case_id) ??
            null)
          : null,
      );
      if (!historyEntry.selected_case_id) {
        setSelectedCaseImages([]);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [cases, setPanelOpen, setRailView, setSelectedCase, setSelectedCaseImages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextEntry = buildWorkspaceHistoryEntry(railView, selectedCaseId);
    const browserEntry = readWorkspaceHistoryEntry(window.history.state);

    if (workspacePopNavigationRef.current) {
      workspacePopNavigationRef.current = false;
      workspaceHistoryRef.current = nextEntry;
      if (!isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        writeWorkspaceHistoryEntry(nextEntry, "replace");
      }
      return;
    }

    if (!workspaceHistoryRef.current) {
      workspaceHistoryRef.current = nextEntry;
      if (isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        return;
      }
      if (nextEntry.selected_case_id) {
        const backstopEntry = buildWorkspaceHistoryEntry(
          "patients",
          nextEntry.selected_case_id,
        );
        if (!isSameWorkspaceHistoryEntry(browserEntry, backstopEntry)) {
          writeWorkspaceHistoryEntry(backstopEntry, "replace");
        }
        writeWorkspaceHistoryEntry(nextEntry, "push");
        return;
      }
      writeWorkspaceHistoryEntry(nextEntry, "replace");
      return;
    }

    if (isSameWorkspaceHistoryEntry(workspaceHistoryRef.current, nextEntry)) {
      if (!isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        writeWorkspaceHistoryEntry(nextEntry, "replace");
      }
      return;
    }

    if (
      nextEntry.selected_case_id &&
      workspaceHistoryRef.current.rail_view === "cases" &&
      !workspaceHistoryRef.current.selected_case_id
    ) {
      const backstopEntry = buildWorkspaceHistoryEntry(
        "patients",
        nextEntry.selected_case_id,
      );
      if (!isSameWorkspaceHistoryEntry(browserEntry, backstopEntry)) {
        writeWorkspaceHistoryEntry(backstopEntry, "replace");
      }
    }

    workspaceHistoryRef.current = nextEntry;
    writeWorkspaceHistoryEntry(nextEntry, "push");
  }, [railView, selectedCaseId]);
}
