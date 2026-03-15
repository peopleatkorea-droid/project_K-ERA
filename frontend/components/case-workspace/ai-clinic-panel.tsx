"use client";

import type { ReactNode } from "react";

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
    <section className="panel-card">
      <div className="panel-card-head">
        <strong>{pick(locale, "AI Clinic", "AI Clinic")}</strong>
        <button className="ghost-button" type="button" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
          {aiClinicBusy ? pick(locale, "Searching...", "검색 중...") : pick(locale, "Find similar patients", "유사 환자 찾기")}
        </button>
      </div>
      {!validationResult ? (
        <p>{pick(locale, "Run validation first, then AI Clinic will retrieve up to three similar patients using the configured visual retrieval backend.", "먼저 검증을 실행하면 AI Clinic이 설정된 visual retrieval backend로 최대 3명의 유사 환자를 검색합니다.")}</p>
      ) : (
        children
      )}
    </section>
  );
}
