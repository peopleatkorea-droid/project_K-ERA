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
  aiClinicExpandedBusy: boolean;
  canRunAiClinic: boolean;
  canExpandAiClinic: boolean;
  onRunAiClinic: () => void;
  onExpandAiClinic: () => void;
  children: ReactNode;
};

export function AiClinicPanel({
  locale,
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
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "AI Clinic", "AI Clinic")}</div>}
        title={pick(locale, "Run AI Clinic review", "AI Clinic review 실행")}
        titleAs="h4"
        description={pick(
          locale,
          "Start with similar-patient retrieval, then load narrative evidence and workflow guidance only when needed.",
          "먼저 유사 환자 검색을 띄우고, 필요할 때만 narrative evidence와 workflow guidance를 추가로 불러옵니다."
        )}
        aside={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
              {aiClinicBusy ? pick(locale, "Finding...", "검색 중...") : pick(locale, "Find similar cases", "유사 환자 찾기")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onExpandAiClinic}
              disabled={aiClinicExpandedBusy || !canExpandAiClinic}
            >
              {aiClinicExpandedBusy
                ? pick(locale, "Loading evidence...", "근거 불러오는 중...")
                : pick(locale, "Load evidence", "근거 불러오기")}
            </Button>
          </div>
        }
      />

      {!validationResult ? (
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            "Run validation first. AI Clinic uses that result to stage similar-case retrieval first and expanded evidence second.",
            "먼저 validation을 실행하세요. AI Clinic은 그 결과를 기준으로 유사 케이스 검색을 먼저, 확장 근거는 그다음 단계로 불러옵니다."
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
