"use client";

import { type ReactNode } from "react";

import { pick, type Locale } from "../../lib/i18n";
import {
  canvasDocumentClass,
  canvasHeaderClass,
  canvasHeaderContentClass,
  canvasHeaderGlowClass,
  canvasHeaderMetaChipClass,
  canvasHeaderMetaRowClass,
  canvasSummaryCardClass,
  canvasSummaryGridClass,
  canvasSummaryLabelClass,
  canvasSummaryValueClass,
} from "../ui/workspace-patterns";

type CaseWorkspaceAuthoringCanvasProps = {
  locale: Locale;
  selectedSiteLabel: string | null;
  draftStatusLabel: string;
  resolvedVisitReferenceLabel: string;
  intakeCompleted: boolean;
  patientSummaryLabel: string;
  visitSummaryLabel: string;
  organismSummary: string;
  patientVisitForm: ReactNode;
  imageManagerPanel?: ReactNode;
};

export function CaseWorkspaceAuthoringCanvas({
  locale,
  selectedSiteLabel,
  draftStatusLabel,
  resolvedVisitReferenceLabel,
  intakeCompleted,
  patientSummaryLabel,
  visitSummaryLabel,
  organismSummary,
  patientVisitForm,
  imageManagerPanel,
}: CaseWorkspaceAuthoringCanvasProps) {
  return (
    <article className={canvasDocumentClass}>
      <section className={canvasHeaderClass}>
        <div className={canvasHeaderGlowClass} />
        <div className={canvasHeaderContentClass}>
          <div className="grid gap-3">
            <div className={`${canvasHeaderMetaRowClass} min-w-0 flex-nowrap overflow-x-auto pb-1`}>
              <span className={canvasHeaderMetaChipClass}>{selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}</span>
              <span className={canvasHeaderMetaChipClass}>{draftStatusLabel}</span>
              <span className={canvasHeaderMetaChipClass}>{resolvedVisitReferenceLabel}</span>
            </div>
          </div>

          {!intakeCompleted ? (
            <div className={canvasSummaryGridClass}>
              <div className={canvasSummaryCardClass}>
                <span className={canvasSummaryLabelClass}>{pick(locale, "Patient", "환자")}</span>
                <strong className={canvasSummaryValueClass}>{patientSummaryLabel}</strong>
              </div>
              <div className={canvasSummaryCardClass}>
                <span className={canvasSummaryLabelClass}>{pick(locale, "Visit", "방문")}</span>
                <strong className={canvasSummaryValueClass}>{visitSummaryLabel}</strong>
              </div>
              <div className={canvasSummaryCardClass}>
                <span className={canvasSummaryLabelClass}>{pick(locale, "Organism", "원인균")}</span>
                <strong className={canvasSummaryValueClass}>{organismSummary}</strong>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {patientVisitForm}
      {imageManagerPanel ?? null}
    </article>
  );
}
