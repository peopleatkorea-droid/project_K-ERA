"use client";

import type { Dispatch, SetStateAction } from "react";

import type { OrganismRecord, PatientIdLookupResponse } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { CanvasBlock } from "../ui/canvas-block";
import { Field } from "../ui/field";
import {
  canvasBlockClass,
  canvasBlockEyebrowClass,
  canvasBlockStatusClass,
  canvasBlockSummaryClass,
  canvasBlockTitleClass,
  canvasFooterBodyClass,
  canvasFooterClass,
  canvasFooterCopyClass,
  canvasFooterTitleClass,
  canvasPropertyCardClass,
  canvasPropertyGridClass,
  canvasPropertyLabelClass,
  canvasPropertyValueClass,
  factorListClass,
  organismAddButtonClass,
  organismChipClass,
  organismChipCopyClass,
  organismChipRemoveClass,
  organismChipRowClass,
  organismChipStaticClass,
  predisposingFactorPillClass,
  supportFieldClass,
  supportHintClass,
  supportLabelClass,
} from "../ui/workspace-patterns";

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  visit_status: string;
  is_initial_visit: boolean;
  predisposing_factor: string[];
  other_history: string;
  intake_completed: boolean;
};

type Props = {
  locale: Locale;
  draft: DraftState;
  draftStatusLabel?: string;
  notAvailableLabel: string;
  sexOptions: string[];
  contactLensOptions: string[];
  predisposingFactorOptions: string[];
  visitStatusOptions: string[];
  cultureSpecies: Record<string, string[]>;
  speciesOptions: string[];
  pendingOrganism: OrganismRecord;
  pendingSpeciesOptions: string[];
  showAdditionalOrganismForm: boolean;
  intakeOrganisms: OrganismRecord[];
  patientIdLookup: PatientIdLookupResponse | null;
  patientIdLookupBusy: boolean;
  patientIdLookupError: string | null;
  primaryOrganismSummary: string;
  resolvedVisitReferenceLabel: string;
  actualVisitDateLabel: string;
  setDraft: Dispatch<SetStateAction<DraftState>>;
  setPendingOrganism: Dispatch<SetStateAction<OrganismRecord>>;
  setShowAdditionalOrganismForm: Dispatch<SetStateAction<boolean>>;
  togglePredisposingFactor: (factor: string) => void;
  updatePrimaryOrganism: (category: string, species: string) => void;
  addAdditionalOrganism: () => void;
  removeAdditionalOrganism: (organism: OrganismRecord) => void;
  onCompleteIntake: () => void;
};

type SummaryPropertyProps = {
  label: string;
  value?: string;
};

function SummaryProperty({ label, value }: SummaryPropertyProps) {
  return (
    <div className={canvasPropertyCardClass}>
      <span className={canvasPropertyLabelClass}>{label}</span>
      {value ? <span className={canvasPropertyValueClass}>{value}</span> : null}
    </div>
  );
}

const compactPatientFieldClassName =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.82))] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] dark:bg-white/4";
const compactPatientLabelClassName = "text-[0.78rem] font-semibold text-muted whitespace-nowrap";
const compactPatientControlClassName =
  "min-h-11 w-full rounded-[12px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/4";
const lockedSummaryBarClass =
  "grid gap-0 border-t border-border/70 pt-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:divide-x md:divide-border/60";
const lockedSummaryItemClass =
  "grid min-w-0 gap-0.5 py-1 md:px-4 md:first:pl-0 md:last:pr-0";
const lockedSummaryValueClass =
  "min-w-0 truncate text-sm font-semibold leading-5 tracking-[-0.02em] text-ink";

export function PatientVisitForm({
  locale,
  draft,
  draftStatusLabel,
  notAvailableLabel,
  sexOptions,
  contactLensOptions,
  predisposingFactorOptions,
  visitStatusOptions,
  cultureSpecies,
  speciesOptions,
  pendingOrganism,
  pendingSpeciesOptions,
  showAdditionalOrganismForm,
  intakeOrganisms,
  patientIdLookup,
  patientIdLookupBusy,
  patientIdLookupError,
  primaryOrganismSummary,
  resolvedVisitReferenceLabel,
  actualVisitDateLabel,
  setDraft,
  setPendingOrganism,
  setShowAdditionalOrganismForm,
  togglePredisposingFactor,
  updatePrimaryOrganism,
  addAdditionalOrganism,
  removeAdditionalOrganism,
  onCompleteIntake,
}: Props) {
  const sexLabel = translateOption(locale, "sex", draft.sex);
  const predisposingSummary =
    draft.predisposing_factor.length > 0
      ? draft.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" / ")
      : pick(locale, "No predisposing factor selected", "선행 인자 없음");
  const organismToneCopy =
    draft.additional_organisms.length > 0
      ? pick(locale, "Polymicrobial", "혼합 균주")
      : pick(locale, "Single organism", "단일 균주");
  const organismCategorySummary = draft.culture_category
    ? translateOption(locale, "cultureCategory", draft.culture_category)
    : notAvailableLabel;
  const primaryOrganismLabel = primaryOrganismSummary || draft.culture_species || notAvailableLabel;
  const identityComplete = Boolean(draft.patient_id.trim() && draft.age.trim());
  const visitComplete = Boolean(draft.visit_status && draft.contact_lens_use);
  const organismComplete = Boolean(draft.culture_category && draft.culture_species.trim());
  const lockedPatientSummary = draft.patient_id.trim() || notAvailableLabel;
  const lockedVisitSummary = [
    resolvedVisitReferenceLabel,
    translateOption(locale, "visitStatus", draft.visit_status),
  ]
    .filter(Boolean)
    .join(" · ");
  const organismSummary = [organismCategorySummary, primaryOrganismLabel].join(" / ");
  const lockedOrganismSummary = primaryOrganismLabel;
  const patientIdLookupSummary = [
    patientIdLookup && patientIdLookup.normalized_patient_id !== draft.patient_id.trim()
      ? pick(locale, `normalized as ${patientIdLookup.normalized_patient_id}`, `${patientIdLookup.normalized_patient_id}로 정규화`)
      : null,
    patientIdLookup?.visit_count ? pick(locale, `${patientIdLookup.visit_count} visit(s)`, `${patientIdLookup.visit_count}회 방문`) : null,
    patientIdLookup?.image_count ? pick(locale, `${patientIdLookup.image_count} image(s)`, `이미지 ${patientIdLookup.image_count}장`) : null,
    patientIdLookup?.latest_visit_date
      ? pick(locale, `latest visit ${patientIdLookup.latest_visit_date}`, `최근 방문 ${patientIdLookup.latest_visit_date}`)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const followUpMatch = String(patientIdLookup?.latest_visit_date ?? "").trim().match(/^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i);
  const nextFollowUpReference =
    patientIdLookup?.exists && (patientIdLookup.visit_count ?? 0) > 0
      ? `FU #${String(followUpMatch ? (Number(followUpMatch[1]) || 0) + 1 : 1)}`
      : null;
  const patientIdFeedback = patientIdLookupBusy
    ? pick(locale, "Checking for an existing patient record in this hospital...", "이 병원에 같은 환자 ID가 있는지 확인하는 중입니다...")
    : patientIdLookupError
      ? patientIdLookupError
      : patientIdLookup?.exists
        ? pick(
            locale,
            `Existing patient record found. Saving will continue under the same patient${nextFollowUpReference ? ` as ${nextFollowUpReference}` : ""}.${patientIdLookupSummary ? ` ${patientIdLookupSummary}` : ""}`,
            `기존 환자 기록이 있습니다. 저장하면 같은 환자 아래의 ${nextFollowUpReference ?? "재진"}으로 이어집니다.${patientIdLookupSummary ? ` ${patientIdLookupSummary}` : ""}`
          )
        : "";
  const patientIdFeedbackClassName = patientIdLookupError
    ? "text-danger"
    : patientIdLookup?.exists
      ? "text-amber-700 dark:text-amber-300"
      : "text-muted";

  if (draft.intake_completed) {
    return (
      <section className={`${canvasBlockClass(false)} gap-3`}>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-8">
                <div className={canvasBlockEyebrowClass}>{pick(locale, "Intake summary", "입력 요약")}</div>
                <span className="text-[0.82rem] font-medium text-muted">
                  {draftStatusLabel ?? pick(locale, "Draft saved", "초안 저장")}
                </span>
              </div>
              <h3 className={canvasBlockTitleClass}>{pick(locale, "Case intake locked and ready for image work", "케이스 입력이 고정되었고 이미지 작업 준비가 되었습니다")}</h3>
              <p className={canvasBlockSummaryClass}>
                {pick(
                  locale,
                  "Review the saved structure below or reopen editing if the case context needs to change before submission.",
                  "아래 요약을 검토하고, 제출 전에 수정이 필요하면 편집 모드로 다시 여세요."
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className={canvasBlockStatusClass("complete")}>{pick(locale, "Locked", "고정됨")}</span>
              <Button size="sm" variant="ghost" type="button" onClick={() => setDraft((current) => ({ ...current, intake_completed: false }))}>
                {pick(locale, "Edit", "Edit")}
              </Button>
            </div>
          </div>
        </div>

        <div className={lockedSummaryBarClass}>
          <div className={lockedSummaryItemClass}>
            <span className={canvasPropertyLabelClass}>{pick(locale, "Patient", "환자")}</span>
            <span className={lockedSummaryValueClass} title={lockedPatientSummary}>
              {lockedPatientSummary}
            </span>
          </div>
          <div className={lockedSummaryItemClass}>
            <span className={canvasPropertyLabelClass}>{pick(locale, "Visit", "방문")}</span>
            <span className={lockedSummaryValueClass} title={lockedVisitSummary}>
              {lockedVisitSummary}
            </span>
          </div>
          <div className={lockedSummaryItemClass}>
            <span className={canvasPropertyLabelClass}>{pick(locale, "Organism", "원인균")}</span>
            <span className={lockedSummaryValueClass} title={lockedOrganismSummary}>
              {lockedOrganismSummary}
            </span>
          </div>
        </div>
        {draft.additional_organisms.length > 0 ? (
          <div className={organismChipRowClass}>
            {intakeOrganisms.slice(1).map((organism, index) => (
              <span
                key={`summary-organism-${organism.culture_category}-${organism.culture_species}-${index}`}
                className={`${organismChipClass} ${organismChipStaticClass}`}
              >
                {`${translateOption(locale, "cultureCategory", organism.culture_category)} / ${organism.culture_species}`}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="grid gap-5">
      <CanvasBlock
        eyebrow={pick(locale, "Patient", "환자")}
        title={pick(locale, "Start with patient information", "환자 정보 입력부터 가볍게 시작합니다")}
        headerInline
        statusLabel={identityComplete ? pick(locale, "Ready", "준비됨") : pick(locale, "Needs basics", "기본 정보 필요")}
        statusTone={identityComplete ? "complete" : "active"}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <label className={compactPatientFieldClassName}>
              <span className={compactPatientLabelClassName}>{pick(locale, "Patient ID", "환자 ID")}</span>
              <input
                aria-describedby={patientIdFeedback ? "patient-id-lookup-status" : undefined}
                className={compactPatientControlClassName}
                value={draft.patient_id}
                onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                placeholder="12345678"
                spellCheck={false}
              />
            </label>
            {patientIdFeedback ? (
              <p id="patient-id-lookup-status" role="status" className={`${supportHintClass} ${patientIdFeedbackClassName}`}>
                {patientIdFeedback}
              </p>
            ) : null}
          </div>
          <label className={compactPatientFieldClassName}>
            <span className={compactPatientLabelClassName}>{pick(locale, "Sex", "성별")}</span>
            <select
              className={compactPatientControlClassName}
              value={draft.sex}
              onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}
            >
              {sexOptions.map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "sex", option)}
                </option>
              ))}
            </select>
          </label>
          <label className={compactPatientFieldClassName}>
            <span className={compactPatientLabelClassName}>{pick(locale, "Age", "나이")}</span>
            <input
              className={compactPatientControlClassName}
              type="number"
              min={0}
              value={draft.age}
              onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
            />
          </label>
        </div>
      </CanvasBlock>

      <CanvasBlock
        eyebrow={pick(locale, "Visit", "방문")}
        title={pick(locale, "Set the visit context in one pass", "방문 맥락을 한 번에 정리합니다")}
        summary={pick(
          locale,
          "Phase, status, lens use, and risk factors should read as one state instead of scattered settings.",
          "방문 단계, 상태, 렌즈 사용, 선행 인자가 흩어진 설정이 아니라 하나의 상태로 읽히게 만듭니다."
        )}
        statusLabel={visitComplete ? pick(locale, "Context set", "맥락 설정됨") : pick(locale, "Visit context", "방문 맥락")}
        statusTone={visitComplete ? "complete" : "pending"}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field className={canvasPropertyCardClass} label={pick(locale, "Status", "상태")}>
            <select value={draft.visit_status} onChange={(event) => setDraft((current) => ({ ...current, visit_status: event.target.value }))}>
              {visitStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "visitStatus", option)}
                </option>
              ))}
            </select>
          </Field>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Contact lens", "콘택트렌즈")}>
            <select
              value={draft.contact_lens_use}
              onChange={(event) => setDraft((current) => ({ ...current, contact_lens_use: event.target.value }))}
            >
              {contactLensOptions.map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "contactLens", option)}
                </option>
              ))}
            </select>
          </Field>
          <div className={`${canvasPropertyCardClass} ${supportFieldClass}`}>
            <span className={supportLabelClass}>{pick(locale, "Predisposing factors", "선행 인자")}</span>
            <div className={factorListClass}>
              {predisposingFactorOptions.map((factor) => (
                <Button
                  key={factor}
                  className={predisposingFactorPillClass(draft.predisposing_factor.includes(factor))}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePredisposingFactor(factor)}
                >
                  {translateOption(locale, "predisposing", factor)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CanvasBlock>

      <CanvasBlock
        eyebrow={pick(locale, "Organism", "원인균")}
        title={pick(locale, "Choose the primary organism first", "기본 원인균부터 명확히 정합니다")}
        summary={pick(
          locale,
          "Start with one primary label. Add mixed organisms only when they meaningfully change the case.",
          "먼저 하나의 기본 라벨을 정하고, 혼합 균주는 케이스 해석이 실제로 달라질 때만 추가합니다."
        )}
        statusLabel={organismComplete ? organismToneCopy : pick(locale, "Choose organism", "원인균 선택")}
        statusTone={organismComplete ? "complete" : "active"}
      >
        <div className={canvasPropertyGridClass}>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Category", "분류")}>
            <select
              value={draft.culture_category}
              onChange={(event) => {
                updatePrimaryOrganism(event.target.value, "");
              }}
            >
              <option value="">{pick(locale, "Select category", "분류 선택")}</option>
              {Object.keys(cultureSpecies).map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "cultureCategory", option)}
                </option>
              ))}
            </select>
          </Field>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Species", "균종")}>
            <select
              value={draft.culture_species}
              disabled={!draft.culture_category}
              onChange={(event) => updatePrimaryOrganism(draft.culture_category, event.target.value)}
            >
              <option value="">{pick(locale, "Select species", "균종 선택")}</option>
              {speciesOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <div className={`${canvasPropertyCardClass} ${supportFieldClass}`}>
            <span className={supportLabelClass}>{pick(locale, "Mixed organisms", "혼합 균주")}</span>
            <Button
              className={showAdditionalOrganismForm ? "border-brand/20 bg-brand-soft text-brand" : ""}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowAdditionalOrganismForm((current) => !current)}
            >
              {showAdditionalOrganismForm ? pick(locale, "Hide mixed", "혼합 균주 닫기") : pick(locale, "Add mixed", "혼합 균주 추가")}
            </Button>
            <div className={supportHintClass}>
              {pick(
                locale,
                "Open this only when more than one organism should survive into review.",
                "둘 이상의 균주를 리뷰 단계까지 유지해야 할 때만 여세요."
              )}
            </div>
          </div>
        </div>

        {showAdditionalOrganismForm ? (
          <div className="grid gap-4 rounded-[18px] border border-border/70 bg-white/55 p-4 dark:bg-white/4">
            <div className={canvasPropertyGridClass}>
              <Field className={canvasPropertyCardClass} label={pick(locale, "Category", "분류")}>
                <select
                  value={pendingOrganism.culture_category}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    setPendingOrganism({
                      culture_category: nextCategory,
                      culture_species: (cultureSpecies[nextCategory] ?? [pendingOrganism.culture_species])[0],
                    });
                  }}
                >
                  {Object.keys(cultureSpecies).map((option) => (
                    <option key={`pending-${option}`} value={option}>
                      {translateOption(locale, "cultureCategory", option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field className={canvasPropertyCardClass} label={pick(locale, "Species", "균종")}>
                <select
                  value={pendingOrganism.culture_species}
                  onChange={(event) =>
                    setPendingOrganism((current) => ({
                      ...current,
                      culture_species: event.target.value,
                    }))
                  }
                >
                  {pendingSpeciesOptions.map((option) => (
                    <option key={`pending-species-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
              <div className={`${canvasPropertyCardClass} ${supportFieldClass}`}>
                <span className={supportLabelClass}>{pick(locale, "Action", "동작")}</span>
                <Button className={organismAddButtonClass} type="button" size="sm" variant="primary" onClick={addAdditionalOrganism}>
                  {pick(locale, "Add organism", "원인균 추가")}
                </Button>
                <div className={supportHintClass}>
                  {pick(
                    locale,
                    "Adds the pending organism below without changing the primary label.",
                    "기본 라벨은 유지한 채 아래 스택에 보조 균주를 추가합니다."
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className={organismChipRowClass}>
          {intakeOrganisms.map((organism, index) => (
            <div key={`${organism.culture_category}-${organism.culture_species}-${index}`} className={organismChipClass}>
              <div className={organismChipCopyClass}>
                <strong>{organism.culture_species}</strong>
                <span>
                  {index === 0
                    ? pick(locale, "Primary", "기본 라벨")
                    : translateOption(locale, "cultureCategory", organism.culture_category)}
                </span>
              </div>
              {index > 0 ? (
                <button
                  className={organismChipRemoveClass}
                  type="button"
                  onClick={() => removeAdditionalOrganism(organism)}
                  aria-label={pick(locale, "Remove organism", "원인균 제거")}
                >
                  {pick(locale, "Remove", "제거")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </CanvasBlock>

      <div className={canvasFooterClass}>
        <div className={canvasFooterCopyClass}>
          <strong className={canvasFooterTitleClass}>{pick(locale, "Lock the intake when the case feels clean", "케이스 구조가 정리되면 입력을 고정합니다")}</strong>
          <p className={canvasFooterBodyClass}>
            {pick(
              locale,
              "You can still refine details later, but locking the intake gives the case a stable shape before image review.",
              "이후에도 세부 정보는 다시 다듬을 수 있지만, 먼저 입력을 고정하면 이미지 리뷰 전에 케이스 구조가 안정됩니다."
            )}
          </p>
        </div>
        <Button className="min-w-[168px]" type="button" variant="primary" onClick={onCompleteIntake}>
          {pick(locale, "Lock intake", "입력 고정")}
        </Button>
      </div>
    </div>
  );
}
