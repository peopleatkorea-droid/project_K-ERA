"use client";

import { memo, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { CaseValidationResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import type { AiClinicPreviewResponse, CaseWorkspaceAiClinicRunOptions } from "./shared";

type Props = {
  locale: Locale;
  showStepActions?: boolean;
  validationResult: CaseValidationResponse | null;
  aiClinicBusy: boolean;
  aiClinicExpandedBusy: boolean;
  canRunAiClinic: boolean;
  canExpandAiClinic: boolean;
  onRunAiClinic: (
    options?: CaseWorkspaceAiClinicRunOptions,
  ) => Promise<AiClinicPreviewResponse | null>;
  onExpandAiClinic: () => void;
  children: ReactNode;
};

function AiClinicPanelInner({
  locale,
  showStepActions = true,
  validationResult,
  aiClinicBusy,
  aiClinicExpandedBusy,
  canRunAiClinic,
  canExpandAiClinic,
  onRunAiClinic,
  onExpandAiClinic,
  children,
}: Props) {
  return (
    <Card as="section" variant="panel" className="grid gap-4 p-5">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Step 3", "3단계")}</div>}
        title={pick(locale, "Similar-patient review", "유사 환자 해석")}
        titleAs="h4"
        description={pick(
          locale,
          "Use this after Step 1. First find similar patients, then load extra evidence and guidance only if needed.",
          "1단계 이후에 사용합니다. 먼저 비슷한 환자를 찾고, 필요할 때만 추가 근거와 가이드를 불러옵니다."
        )}
        aside={
          showStepActions ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
                {aiClinicBusy ? pick(locale, "Finding similar patients...", "비슷한 환자 찾는 중...") : pick(locale, "Find similar patients", "비슷한 환자 찾기")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onExpandAiClinic}
                disabled={aiClinicExpandedBusy || !canExpandAiClinic}
              >
                {aiClinicExpandedBusy
                  ? pick(locale, "Loading evidence and guidance...", "근거와 가이드 불러오는 중...")
                  : pick(locale, "Load evidence & guidance", "근거와 가이드 불러오기")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink">
          {pick(locale, "Similar-patient retrieval", "유사 환자 retrieval")}
        </span>
        <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink">
          {pick(locale, "3D cluster map", "3D 클러스터 맵")}
        </span>
      </div>

      {!validationResult ? (
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            'Run Step 1 first. Similar-patient review uses the single-case judgment as its anchor, then adds extra evidence only when you ask for it.',
            '먼저 1단계를 실행하세요. 유사 환자 해석은 단일 케이스 판정을 기준으로 시작하고, 추가 근거는 필요할 때만 이어서 불러옵니다.'
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

export const AiClinicPanel = memo(AiClinicPanelInner);
