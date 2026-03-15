"use client";

import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { CaseValidationResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  validationResult: CaseValidationResponse | null;
  aiClinicBusy: boolean;
  canRunAiClinic: boolean;
  onRunAiClinic: () => void;
  children: ReactNode;
};

export function AiClinicPanel({
  locale,
  validationResult,
  aiClinicBusy,
  canRunAiClinic,
  onRunAiClinic,
  children,
}: Props) {
  return (
    <Card as="section" variant="panel" className="grid gap-4 p-5">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "AI Clinic", "AI Clinic")}</div>}
        title={pick(locale, "Find similar patients", "유사 환자 찾기")}
        titleAs="h4"
        description={pick(
          locale,
          "Use the saved validation output to retrieve nearby patients from the configured visual retrieval backend.",
          "저장된 검증 결과를 바탕으로 visual retrieval backend에서 가까운 환자를 검색합니다."
        )}
        aside={
          <Button type="button" variant="ghost" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
            {aiClinicBusy ? pick(locale, "Searching...", "검색 중...") : pick(locale, "Run similarity search", "유사도 검색 실행")}
          </Button>
        }
      />

      {!validationResult ? (
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            "Run validation first, then AI Clinic will retrieve up to three similar patients using the configured visual retrieval backend.",
            "먼저 검증을 실행하면 AI Clinic이 설정된 visual retrieval backend를 사용해 최대 3명의 유사 환자를 찾아줍니다."
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
