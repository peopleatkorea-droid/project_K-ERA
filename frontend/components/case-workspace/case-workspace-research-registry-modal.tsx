"use client";

import { pick, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass } from "../ui/workspace-patterns";

type CaseWorkspaceResearchRegistryModalProps = {
  locale: Locale;
  busy: boolean;
  explanationConfirmed: boolean;
  usageConsented: boolean;
  joinReady: boolean;
  onClose: () => void;
  onExplanationConfirmedChange: (checked: boolean) => void;
  onUsageConsentedChange: (checked: boolean) => void;
  onJoin: () => void;
};

export function CaseWorkspaceResearchRegistryModal({
  locale,
  busy,
  explanationConfirmed,
  usageConsented,
  joinReady,
  onClose,
  onExplanationConfirmedChange,
  onUsageConsentedChange,
  onJoin,
}: CaseWorkspaceResearchRegistryModalProps) {
  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <Card
        as="section"
        variant="panel"
        className="grid max-w-[560px] gap-4 p-6"
      >
        <SectionHeader
          eyebrow={
            <div className={docSectionLabelClass}>
              {pick(locale, "Research registry", "연구 레지스트리")}
            </div>
          }
          title={pick(
            locale,
            "Join once, then keep contribution automatic",
            "한 번 가입하고 자동 기여 흐름 사용",
          )}
          titleAs="h3"
          description={pick(
            locale,
            "K-ERA keeps AI validation free. If you join the registry, de-identified cases from this site can be included for model improvement and multi-center research, with per-case opt-out remaining available.",
            "K-ERA는 AI 검증을 무료로 유지합니다. 레지스트리에 가입하면 이 기관의 비식별 케이스가 모델 개선과 다기관 연구에 포함될 수 있고, 각 케이스는 이후에도 개별 제외할 수 있습니다.",
          )}
        />
        <Card as="div" variant="nested" className="grid gap-2 p-4">
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(
              locale,
              "Original data ownership remains with the contributing institution. This step only enables research-registry participation for your account at the current site.",
              "원본 데이터의 권리는 기여 기관에 남아 있습니다. 이 단계는 현재 병원에서 이 계정의 연구 레지스트리 참여만 활성화합니다.",
            )}
          </p>
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(
              locale,
              "You can still exclude any case later from the case-side registry panel.",
              "이후에도 케이스별 레지스트리 패널에서 언제든 개별 제외할 수 있습니다.",
            )}
          </p>
        </Card>
        <div className="grid gap-3">
          <label className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-4 py-3 text-sm text-ink dark:bg-white/4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={explanationConfirmed}
                disabled={busy}
                onChange={(event) =>
                  onExplanationConfirmedChange(event.target.checked)
                }
              />
              <div className="grid gap-1">
                <span className="font-semibold">
                  {pick(
                    locale,
                    "Acknowledge the registry explanation: pseudonymization, central storage scope, local source retention, and per-case exclusion remain available.",
                    "설명 확인: 가명처리, 중앙 저장 범위, 원본 로컬 보관, 케이스별 제외 가능",
                  )}
                </span>
                <span className="text-[0.82rem] leading-6 text-muted">
                  {pick(
                    locale,
                    "I understand that the central registry receives de-identified research data only, while the source images and records remain at the contributing institution.",
                    "중앙 레지스트리에는 비식별 연구데이터만 올라가고, 원본 이미지와 원자료는 기여 기관 내부에 보관된다는 점을 확인합니다.",
                  )}
                </span>
              </div>
            </div>
          </label>
          <label className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-4 py-3 text-sm text-ink dark:bg-white/4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={usageConsented}
                disabled={busy}
                onChange={(event) => onUsageConsentedChange(event.target.checked)}
              />
              <div className="grid gap-1">
                <span className="font-semibold">
                  {pick(
                    locale,
                    "Consent to registry use: allow registry inclusion plus model validation or improvement research use.",
                    "활용 동의: registry 포함 및 모델 검증/개선 연구 활용 동의",
                  )}
                </span>
                <span className="text-[0.82rem] leading-6 text-muted">
                  {pick(
                    locale,
                    "I consent to eligible cases from this site being included in the registry flow and used for model validation or improvement studies, while keeping per-case opt-out available.",
                    "이 병원의 적격 케이스가 레지스트리 흐름에 포함되고 모델 검증·개선 연구에 활용되는 데 동의하며, 이후에도 케이스별 제외가 가능함을 이해합니다.",
                  )}
                </span>
              </div>
            </div>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {pick(locale, "Continue without joining", "가입 없이 계속")}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={!joinReady}
            onClick={onJoin}
          >
            {pick(locale, "Join research registry", "연구 레지스트리 가입")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
