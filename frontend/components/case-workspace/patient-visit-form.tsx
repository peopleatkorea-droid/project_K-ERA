"use client";

import type { Dispatch, SetStateAction } from "react";

import type { OrganismRecord } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { CanvasBlock } from "../ui/canvas-block";
import { Field } from "../ui/field";
import {
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
  segmentedToggleClass,
  supportFieldClass,
  supportHintClass,
  supportLabelClass,
  summaryNoteClass,
  tagPillClass,
  togglePillClass,
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
  draftImagesCount: number;
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
  value: string;
};

function SummaryProperty({ label, value }: SummaryPropertyProps) {
  return (
    <div className={canvasPropertyCardClass}>
      <span className={canvasPropertyLabelClass}>{label}</span>
      <span className={canvasPropertyValueClass}>{value}</span>
    </div>
  );
}

export function PatientVisitForm({
  locale,
  draft,
  draftImagesCount,
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
  const contactLensSummary =
    draft.contact_lens_use !== "none"
      ? translateOption(locale, "contactLens", draft.contact_lens_use)
      : pick(locale, "No lens use", "렌즈 사용 없음");
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
  const noteComplete = Boolean(draft.other_history.trim());
  const identitySummary = [
    draft.patient_id.trim() || pick(locale, "Untitled case", "제목 없는 케이스"),
    sexLabel,
    draft.age.trim() ? `${draft.age} ${pick(locale, "years", "세")}` : notAvailableLabel,
  ].join(" · ");
  const visitSummary = [
    resolvedVisitReferenceLabel,
    translateOption(locale, "visitStatus", draft.visit_status),
    contactLensSummary,
  ].join(" · ");
  const organismSummary = [organismCategorySummary, primaryOrganismLabel].join(" / ");

  if (draft.intake_completed) {
    return (
      <CanvasBlock
        eyebrow={pick(locale, "Intake summary", "입력 요약")}
        title={pick(locale, "Case intake locked and ready for image work", "케이스 입력이 고정되었고 이미지 작업 준비가 되었습니다")}
        summary={pick(
          locale,
          "Review the saved structure below or reopen editing if the case context needs to change before submission.",
          "아래 요약을 검토하고, 제출 전에 수정이 필요하면 편집 모드로 다시 여세요."
        )}
        statusLabel={pick(locale, "Locked", "고정됨")}
        statusTone="complete"
        aside={
          <Button size="sm" variant="ghost" type="button" onClick={() => setDraft((current) => ({ ...current, intake_completed: false }))}>
            {pick(locale, "Edit", "Edit")}
          </Button>
        }
      >
        <div className={canvasPropertyGridClass}>
          <SummaryProperty label={pick(locale, "Patient", "환자")} value={identitySummary} />
          <SummaryProperty label={pick(locale, "Visit", "방문")} value={`${visitSummary} · ${actualVisitDateLabel}`} />
          <SummaryProperty label={pick(locale, "Organism", "원인균")} value={`${organismSummary} · ${organismToneCopy}`} />
          <SummaryProperty label={pick(locale, "Predisposing", "선행 인자")} value={predisposingSummary} />
          <SummaryProperty label={pick(locale, "Draft images", "초안 이미지")} value={String(draftImagesCount)} />
          <SummaryProperty label={pick(locale, "Local case code", "로컬 케이스 코드")} value={draft.local_case_code.trim() || notAvailableLabel} />
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
        {draft.other_history.trim() ? <p className={summaryNoteClass}>{draft.other_history.trim()}</p> : null}
      </CanvasBlock>
    );
  }

  return (
    <div className="grid gap-5">
      <CanvasBlock
        eyebrow={pick(locale, "Patient", "환자")}
        title={pick(locale, "Start with a clean patient snapshot", "환자 스냅샷부터 가볍게 시작합니다")}
        summary={pick(
          locale,
          "Keep only the essentials here so the canvas opens like a clinical note, not a long admin form.",
          "여기에는 핵심만 남겨서, 이 캔버스가 긴 행정 폼이 아니라 짧은 임상 노트처럼 열리게 합니다."
        )}
        statusLabel={identityComplete ? pick(locale, "Ready", "준비됨") : pick(locale, "Needs basics", "기본 정보 필요")}
        statusTone={identityComplete ? "complete" : "active"}
      >
        <div className={canvasPropertyGridClass}>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Patient ID", "환자 ID")}>
            <input
              value={draft.patient_id}
              onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
              placeholder="17635992"
              spellCheck={false}
            />
          </Field>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Sex", "성별")}>
            <select value={draft.sex} onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}>
              {sexOptions.map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "sex", option)}
                </option>
              ))}
            </select>
          </Field>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Age", "나이")}>
            <input
              type="number"
              min={0}
              value={draft.age}
              onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
            />
          </Field>
          <Field className={canvasPropertyCardClass} label={pick(locale, "Local case code", "로컬 케이스 코드")}>
            <input
              value={draft.local_case_code}
              onChange={(event) => setDraft((current) => ({ ...current, local_case_code: event.target.value }))}
              placeholder={pick(locale, "Optional local label", "기관 내 라벨")}
              spellCheck={false}
            />
          </Field>
          <SummaryProperty label={pick(locale, "Visit reference", "방문 기준")} value={resolvedVisitReferenceLabel} />
          <SummaryProperty label={pick(locale, "Draft images", "초안 이미지")} value={String(draftImagesCount)} />
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
        <div className={canvasPropertyGridClass}>
          <div className={canvasPropertyCardClass}>
            <span className={canvasPropertyLabelClass}>{pick(locale, "Visit phase", "방문 단계")}</span>
            <div className={segmentedToggleClass} role="group" aria-label={pick(locale, "Visit phase", "방문 단계")}>
              <Button
                className={togglePillClass(draft.is_initial_visit)}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDraft((current) => ({ ...current, is_initial_visit: true }))}
              >
                {pick(locale, "Initial", "초진")}
              </Button>
              <Button
                className={togglePillClass(!draft.is_initial_visit)}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDraft((current) => ({ ...current, is_initial_visit: false }))}
              >
                {pick(locale, "Follow-up", "재진")}
              </Button>
            </div>
          </div>
          {!draft.is_initial_visit ? (
            <Field className={canvasPropertyCardClass} label={pick(locale, "FU number", "FU 번호")}>
              <select value={draft.follow_up_number} onChange={(event) => setDraft((current) => ({ ...current, follow_up_number: event.target.value }))}>
                {Array.from({ length: 15 }, (_, index) => String(index + 1)).map((option) => (
                  <option key={option} value={option}>
                    {`FU #${option}`}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            className={canvasPropertyCardClass}
            label={pick(locale, "Date", "날짜")}
            hint={pick(
              locale,
              "Optional. The canvas keeps the visit label even when a calendar date is not set.",
              "선택 사항입니다. 날짜가 없어도 방문 라벨은 유지됩니다."
            )}
          >
            <input type="date" value={draft.actual_visit_date} onChange={(event) => setDraft((current) => ({ ...current, actual_visit_date: event.target.value }))} />
          </Field>
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
                  className={tagPillClass(draft.predisposing_factor.includes(factor))}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePredisposingFactor(factor)}
                >
                  {translateOption(locale, "predisposing", factor)}
                </Button>
              ))}
            </div>
            <div className={supportHintClass}>
              {pick(
                locale,
                "Select only what matters for this visit. These tags flow straight into review.",
                "이 방문에 의미 있는 항목만 선택하세요. 선택한 태그는 이후 리뷰에 그대로 이어집니다."
              )}
            </div>
          </div>
          <SummaryProperty label={pick(locale, "Current summary", "현재 요약")} value={`${visitSummary} · ${actualVisitDateLabel}`} />
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

      <CanvasBlock
        eyebrow={pick(locale, "Clinical note", "임상 노트")}
        title={pick(locale, "Keep the note short and clinical", "노트는 짧고 임상적으로 유지합니다")}
        summary={pick(
          locale,
          "Use this for ocular surface context, referral history, or procedural notes worth keeping.",
          "안구 표면 맥락, 의뢰 경과, 시술 메모처럼 이후에도 남겨둘 만한 정보만 적으세요."
        )}
        statusLabel={noteComplete ? pick(locale, "Noted", "기록됨") : pick(locale, "Optional", "선택 사항")}
        statusTone={noteComplete ? "complete" : "pending"}
      >
        <Field
          label={pick(locale, "Case note", "케이스 노트")}
          hint={pick(
            locale,
            "Write this as something another clinician would want to read later.",
            "단순 입력 메모가 아니라, 다른 임상의가 나중에 다시 읽을 문장이라고 생각하고 작성하세요."
          )}
        >
          <textarea
            rows={4}
            value={draft.other_history}
            onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
            placeholder={pick(
              locale,
              "Referral context, ocular surface status, procedural notes...",
              "의뢰 맥락, 안구 표면 상태, 시술 메모..."
            )}
          />
        </Field>
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
