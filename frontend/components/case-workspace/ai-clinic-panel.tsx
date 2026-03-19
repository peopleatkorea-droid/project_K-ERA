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
        title={pick(locale, "Run AI Clinic review", "AI Clinic 리뷰 실행")}
        titleAs="h4"
        description={pick(
          locale,
          "Use the saved validation result to assemble similar-patient evidence, narrative evidence, and workflow guidance in one AI Clinic flow.",
          "저장된 검증 결과를 바탕으로 유사 환자 근거, 서술 근거, 워크플로 가이드를 하나의 AI Clinic 흐름으로 묶습니다."
        )}
        aside={
          <Button type="button" variant="ghost" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
            {aiClinicBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run AI Clinic", "AI Clinic 실행")}
          </Button>
        }
      />

      {!validationResult ? (
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            "Run validation first, then AI Clinic can build a combined review from similar patients, narrative evidence, and workflow guidance.",
            "먼저 검증을 실행하면 AI Clinic이 유사 환자, 서술 근거, 워크플로 가이드를 묶어 리뷰를 구성합니다."
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
