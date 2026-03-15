"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Field } from "../ui/field";
import type { OrganismRecord } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";

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
  if (!draft.intake_completed) {
    return (
      <>
        <section className="doc-section">
          <div className="patient-inline-header">
            <div className="doc-section-label">{pick(locale, "Patient identity", "환자 정보")}</div>
            <label className="patient-inline-item patient-inline-item-id">
              <strong>{pick(locale, "Patient ID", "환자 ID")}</strong>
              <input
                value={draft.patient_id}
                onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                placeholder="KERA-2026-001"
              />
            </label>
            <label className="patient-inline-item">
              <strong>{pick(locale, "Sex", "성별")}</strong>
              <select value={draft.sex} onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}>
                {sexOptions.map((option) => (
                  <option key={option} value={option}>
                    {translateOption(locale, "sex", option)}
                  </option>
                ))}
              </select>
            </label>
            <label className="patient-inline-item patient-inline-item-age">
              <strong>{pick(locale, "Age", "나이")}</strong>
              <input
                type="number"
                min={0}
                value={draft.age}
                onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
              />
            </label>
            <span className="patient-inline-count">
              {draftImagesCount} {pick(locale, "image blocks", "이미지 블록")}
            </span>
          </div>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <div className="visit-context-headline">
              <div className="doc-section-label">{pick(locale, "Visit context", "방문 맥락")}</div>
              <div className="property-hint visit-context-hint">
                {pick(locale, "Select one or more risk factors below using the toggles.", "아래 위험 인자를 토글로 하나 이상 선택할 수 있습니다.")}
              </div>
            </div>
          </div>
          <div className="visit-context-inline">
            <Field className="visit-context-select" label={pick(locale, "Contact lens", "콘택트렌즈")}>
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
            <div className="tag-cloud visit-context-tags">
              {predisposingFactorOptions.map((factor) => (
                <button
                  key={factor}
                  className={`tag-pill ${draft.predisposing_factor.includes(factor) ? "active" : ""}`}
                  type="button"
                  onClick={() => togglePredisposingFactor(factor)}
                >
                  {translateOption(locale, "predisposing", factor)}
                </button>
              ))}
            </div>
          </div>
          <Field
            className="notes-field"
            label={pick(locale, "Case note", "케이스 메모")}
            hint={pick(
              locale,
              "Freeform note space for ocular surface context, referral history, or procedural remarks.",
              "안구 표면 상태, 전원 이력, 시술 관련 메모 등을 자유롭게 적을 수 있습니다."
            )}
          >
            <textarea
              rows={1}
              value={draft.other_history}
              onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
              placeholder={pick(
                locale,
                "Freeform note space for ocular surface context, referral history, or procedural remarks.",
                "안구 표면 상태, 전원 이력, 시술 관련 메모 등을 자유롭게 적을 수 있습니다."
              )}
            />
          </Field>
        </section>

        <section className="doc-section">
          <div className="organism-inline-header">
            <div className="organism-inline-meta">
              <div className="doc-section-label">{pick(locale, "Organism", "균종")}</div>
              <span className="organism-inline-state">
                {draft.additional_organisms.length > 0 ? pick(locale, "Polymicrobial", "다균종") : pick(locale, "Single organism", "단일 균종")}
              </span>
            </div>
            <label className="organism-inline-item">
              <strong>{pick(locale, "Category", "분류")}</strong>
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
            </label>
            <label className="organism-inline-item organism-inline-item-species">
              <strong>{pick(locale, "Species", "세부 균종")}</strong>
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
            </label>
            <div className="organism-inline-item organism-inline-item-action">
              <strong>{pick(locale, "Additional organisms", "추가 균종")}</strong>
              <button className={`ghost-button ${showAdditionalOrganismForm ? "active" : ""}`} type="button" onClick={() => setShowAdditionalOrganismForm((current) => !current)}>
                {showAdditionalOrganismForm ? pick(locale, "Hide mixed", "다균종 입력 닫기") : pick(locale, "Add mixed", "다균종 입력")}
              </button>
            </div>
          </div>
          <div className="property-hint organism-primary-hint">
            {pick(locale, "This is the primary organism label for the case.", "이 값이 케이스의 주 균종 라벨로 저장됩니다.")}
          </div>
          {showAdditionalOrganismForm ? (
            <div className="organism-add-grid">
              <Field label={pick(locale, "Category", "분류")}>
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
              <Field label={pick(locale, "Species", "세부 균종")}>
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
              <Button className="ghost-button organism-add-button" type="button" variant="ghost" onClick={addAdditionalOrganism}>
                {pick(locale, "Add organism", "균종 추가")}
              </Button>
            </div>
          ) : null}
        </section>

        {draft.additional_organisms.length > 0 ? (
          <section className="doc-section">
            <div className="doc-section-head">
              <div>
                <div className="doc-section-label">{pick(locale, "Organism summary", "균종 요약")}</div>
              </div>
              <span>{pick(locale, "Polymicrobial", "다균종")}</span>
            </div>
            <div className="organism-chip-row">
              {intakeOrganisms.map((organism, index) => (
                <div key={`${organism.culture_category}-${organism.culture_species}-${index}`} className="organism-chip">
                  <div className="organism-chip-copy">
                    <strong>{organism.culture_species}</strong>
                    <span>{index === 0 ? pick(locale, "Primary", "대표 균종") : translateOption(locale, "cultureCategory", organism.culture_category)}</span>
                  </div>
                  {index > 0 ? (
                    <button className="organism-chip-remove" type="button" onClick={() => removeAdditionalOrganism(organism)} aria-label={pick(locale, "Remove organism", "균종 제거")}>
                      {pick(locale, "Remove", "제거")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="property-hint">
              {pick(locale, "This visit will be saved as polymicrobial automatically.", "이 방문은 저장 시 자동으로 다균종으로 처리됩니다.")}
            </div>
          </section>
        ) : null}

        <div className="doc-footer">
          <div />
          <Button className="primary-workspace-button complete-intake-button" type="button" variant="primary" onClick={onCompleteIntake}>
            {pick(locale, "Complete", "완료")}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="doc-section intake-summary-card">
        <div className="doc-section-head">
          <div>
            <div className="doc-section-label">{pick(locale, "Core intake", "기본 입력")}</div>
          </div>
          <button className="ghost-button" type="button" onClick={() => setDraft((current) => ({ ...current, intake_completed: false }))}>
            {pick(locale, "Edit", "수정")}
          </button>
        </div>
        <div className="intake-summary-grid">
          <div className="intake-summary-block">
            <div className="intake-summary-inline">
              <strong>{draft.patient_id.trim() || notAvailableLabel}</strong>
              <p>{`${translateOption(locale, "sex", draft.sex)} · ${draft.age || notAvailableLabel}`}</p>
            </div>
          </div>
          <div className="intake-summary-block">
            <div className="intake-summary-inline">
              {draft.contact_lens_use !== "none" ? <strong>{translateOption(locale, "contactLens", draft.contact_lens_use)}</strong> : null}
              <p>
                {draft.predisposing_factor.length > 0
                  ? draft.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" · ")
                  : pick(locale, "No predisposing factor selected", "선택된 선행 인자 없음")}
              </p>
            </div>
          </div>
          <div className="intake-summary-block intake-summary-block-wide">
            <div className="intake-summary-inline intake-summary-inline-organism">
              <strong>{`${translateOption(locale, "cultureCategory", draft.culture_category)} · ${primaryOrganismSummary}`}</strong>
              {draft.additional_organisms.length > 0 ? (
                <div className="organism-chip-row">
                  {intakeOrganisms.slice(1).map((organism, index) => (
                    <span key={`summary-organism-${organism.culture_category}-${organism.culture_species}-${index}`} className="organism-chip static">
                      {`${translateOption(locale, "cultureCategory", organism.culture_category)} · ${organism.culture_species}`}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {draft.other_history.trim() ? <p className="intake-summary-note">{draft.other_history.trim()}</p> : null}
          </div>
        </div>
      </section>

      <section className="doc-section">
        <div className="doc-section-head">
          <div>
            <div className="doc-section-label">{pick(locale, "Visit timing", "방문 시점")}</div>
            <h4>{pick(locale, "Choose initial or follow-up, then add the date if needed", "초진/재진 선택 후 필요하면 날짜 입력")}</h4>
          </div>
          <div className="doc-badge-row visit-timing-meta">
            <span className="doc-site-badge">
              {pick(locale, "Visit reference", "방문 기준값")} · {resolvedVisitReferenceLabel}
            </span>
            <span className="doc-site-badge">
              {pick(locale, "Calendar date", "실제 날짜")} · {actualVisitDateLabel}
            </span>
          </div>
        </div>
        <div className={`property-grid visit-timing-grid ${!draft.is_initial_visit ? "visit-timing-grid-follow-up" : ""}`}>
          <div className="property-chip">
            <span>{pick(locale, "Visit phase", "초진/재진")}</span>
            <div className="segmented-toggle" role="group" aria-label={pick(locale, "Visit phase", "초진/재진")}>
              <button className={`toggle-pill phase-pill phase-initial ${draft.is_initial_visit ? "active" : ""}`} type="button" onClick={() => setDraft((current) => ({ ...current, is_initial_visit: true }))}>
                {pick(locale, "Initial", "초진")}
              </button>
              <button className={`toggle-pill phase-pill phase-followup ${!draft.is_initial_visit ? "active" : ""}`} type="button" onClick={() => setDraft((current) => ({ ...current, is_initial_visit: false }))}>
                {pick(locale, "Follow-up", "재진")}
              </button>
            </div>
          </div>
          {!draft.is_initial_visit ? (
            <Field className="property-chip" label={pick(locale, "FU number", "FU 번호")}>
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
            className="property-chip"
            label={pick(locale, "Date (optional)", "날짜 (선택)")}
            hint={pick(locale, "This uses the same date format as before and is stored separately from the visit reference.", "이전과 같은 날짜 형식을 사용하며 방문 기준값과 별도로 저장됩니다.")}
          >
            <input type="date" value={draft.actual_visit_date} onChange={(event) => setDraft((current) => ({ ...current, actual_visit_date: event.target.value }))} />
          </Field>
          <Field className="property-chip" label={pick(locale, "Status", "상태")}>
            <select value={draft.visit_status} onChange={(event) => setDraft((current) => ({ ...current, visit_status: event.target.value }))}>
              {visitStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {translateOption(locale, "visitStatus", option)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
    </>
  );
}
