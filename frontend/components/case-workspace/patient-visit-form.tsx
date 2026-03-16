"use client";

import type { Dispatch, SetStateAction } from "react";

import type { OrganismRecord } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  completeIntakeButtonClass,
  docBadgeRowClass,
  docFooterClass,
  docSectionClass,
  docSectionHeadClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  draftIntakeCardClass,
  draftIntakeGridClass,
  draftIntakeNoteClass,
  factorListClass,
  intakeSummaryMetricCardClass,
  intakeSummaryMetricGridClass,
  organismAddButtonClass,
  organismChipClass,
  organismChipCopyClass,
  organismChipRemoveClass,
  organismChipRowClass,
  organismChipStaticClass,
  propertyChipClass,
  propertyHintClass,
  segmentedToggleClass,
  selectedCaseChipClass,
  selectedCaseChipStripClass,
  supportFieldClass,
  supportHintClass,
  supportLabelClass,
  summaryNoteClass,
  tagPillClass,
  togglePillClass,
  visitContextSelectClass,
  visitIntakeMetaClass,
  visitIntakeSummaryBadgeClass,
  visitTimingGridClass,
  visitTimingMetaClass,
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
  const contactLensSummary =
    draft.contact_lens_use !== "none"
      ? translateOption(locale, "contactLens", draft.contact_lens_use)
      : pick(locale, "No lens use", "렌즈 사용 없음");
  const predisposingSummary =
    draft.predisposing_factor.length > 0
      ? draft.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" / ")
      : pick(locale, "No predisposing factor selected", "선택된 선행 인자 없음");
  const organismToneCopy =
    draft.additional_organisms.length > 0
      ? pick(locale, "Polymicrobial", "다균종")
      : pick(locale, "Single organism", "단일 균종");
  const organismCategorySummary = draft.culture_category
    ? translateOption(locale, "cultureCategory", draft.culture_category)
    : notAvailableLabel;
  const primaryOrganismLabel = primaryOrganismSummary || draft.culture_species || notAvailableLabel;

  if (!draft.intake_completed) {
    return (
      <>
        <section className={docSectionClass}>
          <Card as="div" variant="nested" className={draftIntakeCardClass}>
            <SectionHeader
              className={docSectionHeadClass}
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Patient identity", "환자 기본 정보")}</div>}
              title={pick(locale, "Anchor the case with the patient basics", "환자 정보로 케이스 기준점 고정")}
              titleAs="h4"
              description={pick(
                locale,
                "Start with the chart-level identifiers. Image authoring opens after the intake is locked.",
                "차트 수준 기본 정보를 먼저 입력합니다. intake가 고정되면 이미지 작성 단계로 넘어갑니다."
              )}
              aside={
                <div className={`${docBadgeRowClass} ${visitIntakeMetaClass}`}>
                  <span className={docSiteBadgeClass}>{`${draftImagesCount} ${pick(locale, "image blocks", "이미지 블록")}`}</span>
                  <span className={docSiteBadgeClass}>{`${pick(locale, "Visit reference", "방문 기준")} / ${resolvedVisitReferenceLabel}`}</span>
                </div>
              }
            />
            <div className={draftIntakeGridClass}>
              <Field label={pick(locale, "Patient ID", "환자 ID")}>
                <input
                  value={draft.patient_id}
                  onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                  placeholder="17635992"
                  spellCheck={false}
                />
              </Field>
              <Field label={pick(locale, "Sex", "성별")}>
                <select value={draft.sex} onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}>
                  {sexOptions.map((option) => (
                    <option key={option} value={option}>
                      {translateOption(locale, "sex", option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={pick(locale, "Age", "나이")}>
                <input
                  type="number"
                  min={0}
                  value={draft.age}
                  onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
                />
              </Field>
              <div className={supportFieldClass}>
                <span className={supportLabelClass}>{pick(locale, "Draft scope", "초안 상태")}</span>
                <div className={selectedCaseChipStripClass}>
                  <div className={selectedCaseChipClass}>
                    <strong>{pick(locale, "Draft images", "초안 이미지")}</strong>
                    <span>{draftImagesCount}</span>
                  </div>
                  <div className={selectedCaseChipClass}>
                    <strong>{pick(locale, "Visit reference", "방문 기준")}</strong>
                    <span>{resolvedVisitReferenceLabel}</span>
                  </div>
                </div>
                <div className={supportHintClass}>
                  {pick(locale, "Counts local images before the visit is saved.", "방문 저장 전 이 탭에만 있는 이미지를 집계합니다.")}
                </div>
              </div>
            </div>
            <div className={`${propertyHintClass} -mt-1 whitespace-normal`}>
              {pick(
                locale,
                "Use the local chart or MRN-style ID used inside your institution. Patient names should not be entered here, and the central registry stores a case_reference_id instead of this raw value.",
                "기관 내부에서 쓰는 차트/MRN 형태 ID를 입력하세요. 환자 실명은 여기에 넣지 않으며, 중앙 registry에는 이 값 대신 case_reference_id가 저장됩니다."
              )}
            </div>
          </Card>
        </section>

        <section className={docSectionClass}>
          <Card as="div" variant="nested" className={draftIntakeCardClass}>
            <SectionHeader
              className={docSectionHeadClass}
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Visit context", "방문 맥락")}</div>}
              title={pick(locale, "Capture lens use, risk factors, and a short note", "렌즈 사용, 위험 인자, 메모 정리")}
              titleAs="h4"
              description={pick(
                locale,
                "This section frames the ocular surface context before you choose the organism and images.",
                "원인균과 이미지를 고르기 전에 안표면 맥락을 먼저 고정하는 구간입니다."
              )}
            />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
              <Field className={visitContextSelectClass} label={pick(locale, "Contact lens", "콘택트렌즈")}>
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
              <div className={supportFieldClass}>
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
                    "Select one or more risk factors. The summary card will reflect the active choices.",
                    "하나 이상 선택할 수 있고, 완료 후 요약 카드에 그대로 반영됩니다."
                  )}
                </div>
              </div>
            </div>
            <Field
              className={draftIntakeNoteClass}
              label={pick(locale, "Case note", "케이스 메모")}
              hint={pick(
                locale,
                "Use this for ocular surface context, referral history, or any procedural note that should survive into review.",
                "안표면 상태, 의뢰 경과, 시술 메모처럼 나중에 리뷰까지 남겨둘 내용을 적습니다."
              )}
            >
              <textarea
                rows={3}
                value={draft.other_history}
                onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
                placeholder={pick(
                  locale,
                  "Add concise clinical context for this visit.",
                  "이 방문에 필요한 임상 맥락을 간단히 적어두세요."
                )}
              />
            </Field>
          </Card>
        </section>

        <section className={docSectionClass}>
          <Card as="div" variant="nested" className={draftIntakeCardClass}>
            <SectionHeader
              className={docSectionHeadClass}
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Organism", "원인균")}</div>}
              title={pick(locale, "Define the primary label before image work begins", "이미지 작업 전 기본 원인균 라벨 고정")}
              titleAs="h4"
              description={pick(
                locale,
                "Pick the primary culture label first. Mixed organisms can be added as supporting labels.",
                "기본 배양 라벨을 먼저 정하고, 추가 균주는 보조 라벨로 이어서 붙입니다."
              )}
              aside={<span className={`${docSiteBadgeClass} ${visitIntakeSummaryBadgeClass}`}>{organismToneCopy}</span>}
            />
            <div className={draftIntakeGridClass}>
              <Field label={pick(locale, "Category", "분류")}>
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
              <Field label={pick(locale, "Species", "균종")}>
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
              <div className={supportFieldClass}>
                <span className={supportLabelClass}>{pick(locale, "Additional organisms", "추가 균주")}</span>
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
                  {pick(locale, "Open the mixed-culture form only when this visit includes more than one label.", "이 방문에 라벨이 둘 이상일 때만 추가 입력을 엽니다.")}
                </div>
              </div>
            </div>
            <div className={`${propertyHintClass} -mt-1 whitespace-normal`}>
              {pick(locale, "This primary organism becomes the main label for the case.", "여기서 고른 기본 균주가 케이스의 주 라벨이 됩니다.")}
            </div>
            {showAdditionalOrganismForm ? (
              <Card as="div" variant="nested" className="grid gap-4 border border-border/80 p-4">
                <div className="grid gap-4 md:grid-cols-2">
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
                  <Field label={pick(locale, "Species", "균종")}>
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
                  <div className={supportFieldClass}>
                    <span className={supportLabelClass}>{pick(locale, "Action", "실행")}</span>
                    <Button className={organismAddButtonClass} type="button" size="sm" variant="primary" onClick={addAdditionalOrganism}>
                      {pick(locale, "Add organism", "균주 추가")}
                    </Button>
                    <div className={supportHintClass}>
                      {pick(locale, "Adds the pending organism to the review summary below.", "아래 요약 영역에 보조 균주를 추가합니다.")}
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
          </Card>
        </section>

        {draft.additional_organisms.length > 0 ? (
          <section className={docSectionClass}>
            <Card as="div" variant="nested" className={draftIntakeCardClass}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Organism summary", "균주 요약")}</div>}
                title={pick(locale, "Review the mixed-culture label stack", "혼합 균주 라벨 스택 점검")}
                titleAs="h4"
                description={pick(
                  locale,
                  "The first chip remains the primary label. Additional chips stay removable until the intake is completed.",
                  "첫 칩은 기본 라벨로 유지되고, intake 완료 전까지는 추가 균주를 계속 제거할 수 있습니다."
                )}
                aside={<span className={docSiteBadgeClass}>{pick(locale, "Polymicrobial", "다균종")}</span>}
              />
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
                        aria-label={pick(locale, "Remove organism", "균주 제거")}
                      >
                        {pick(locale, "Remove", "제거")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className={propertyHintClass}>
                {pick(locale, "This visit will be saved as polymicrobial automatically.", "이 방문은 자동으로 다균종 케이스로 저장됩니다.")}
              </div>
            </Card>
          </section>
        ) : null}

        <div className={docFooterClass}>
          <div />
          <Button className={completeIntakeButtonClass} type="button" variant="primary" onClick={onCompleteIntake}>
            {pick(locale, "Complete", "완료")}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Card as="section" variant="nested" className="grid gap-5 p-5">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Core intake", "기본 intake")}</div>}
          title={pick(locale, "Intake locked and ready for image authoring", "intake 고정 완료, 이미지 작성 준비됨")}
          titleAs="h4"
          description={pick(
            locale,
            "The core intake is fixed for this draft. Review the summary below or reopen editing if the case details need adjustment.",
            "이 초안의 기본 intake는 고정되었습니다. 아래 요약을 확인하거나, 수정이 필요하면 편집으로 돌아가세요."
          )}
          aside={
            <Button size="sm" variant="ghost" type="button" onClick={() => setDraft((current) => ({ ...current, intake_completed: false }))}>
              {pick(locale, "Edit", "수정")}
            </Button>
          }
        />
        <MetricGrid columns={3} className={intakeSummaryMetricGridClass}>
          <MetricItem
            className={intakeSummaryMetricCardClass}
            value={draft.patient_id.trim() || notAvailableLabel}
            label={`${translateOption(locale, "sex", draft.sex)} / ${draft.age || notAvailableLabel}`}
          />
          <MetricItem
            className={intakeSummaryMetricCardClass}
            value={resolvedVisitReferenceLabel}
            label={`${pick(locale, "Calendar date", "실제 날짜")} / ${actualVisitDateLabel}`}
          />
          <MetricItem
            className={intakeSummaryMetricCardClass}
            value={`${organismCategorySummary} / ${primaryOrganismLabel}`}
            label={organismToneCopy}
          />
        </MetricGrid>
        <div className={selectedCaseChipStripClass}>
          <div className={selectedCaseChipClass}>
            <strong>{pick(locale, "Contact lens", "콘택트렌즈")}</strong>
            <span>{contactLensSummary}</span>
          </div>
          <div className={selectedCaseChipClass}>
            <strong>{pick(locale, "Predisposing factors", "선행 인자")}</strong>
            <span>{predisposingSummary}</span>
          </div>
          <div className={selectedCaseChipClass}>
            <strong>{pick(locale, "Visit status", "방문 상태")}</strong>
            <span>{translateOption(locale, "visitStatus", draft.visit_status)}</span>
          </div>
        </div>
        {draft.additional_organisms.length > 0 ? (
          <div className={organismChipRowClass}>
            {intakeOrganisms.slice(1).map((organism, index) => (
              <span key={`summary-organism-${organism.culture_category}-${organism.culture_species}-${index}`} className={`${organismChipClass} ${organismChipStaticClass}`}>
                {`${translateOption(locale, "cultureCategory", organism.culture_category)} / ${organism.culture_species}`}
              </span>
            ))}
          </div>
        ) : null}
        {draft.other_history.trim() ? <p className={summaryNoteClass}>{draft.other_history.trim()}</p> : null}
      </Card>

      <section className={docSectionClass}>
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Visit timing", "방문 시점")}</div>}
          title={pick(locale, "Choose initial or follow-up, then add the date if needed", "초진/재진 선택 후 필요하면 날짜 입력")}
          titleAs="h4"
          aside={
            <div className={`${docBadgeRowClass} ${visitTimingMetaClass}`}>
              <span className={docSiteBadgeClass}>
                {pick(locale, "Visit reference", "방문 기준")} / {resolvedVisitReferenceLabel}
              </span>
              <span className={docSiteBadgeClass}>
                {pick(locale, "Calendar date", "실제 날짜")} / {actualVisitDateLabel}
              </span>
            </div>
          }
        />
        <div className={visitTimingGridClass(!draft.is_initial_visit)}>
          <div className={propertyChipClass}>
            <span>{pick(locale, "Visit phase", "초진/재진")}</span>
            <div className={segmentedToggleClass} role="group" aria-label={pick(locale, "Visit phase", "초진/재진")}>
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
            <Field className={propertyChipClass} label={pick(locale, "FU number", "FU 번호")}>
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
            className={propertyChipClass}
            label={pick(locale, "Date (optional)", "날짜 (선택)")}
            hint={pick(
              locale,
              "Stored locally as YYYY-MM-DD only. The central registry uses the visit label instead of the exact calendar date.",
              "YYYY-MM-DD 형식으로 로컬에만 저장됩니다. 중앙 registry에는 실제 날짜 대신 방문 라벨만 사용합니다."
            )}
          >
            <input type="date" value={draft.actual_visit_date} onChange={(event) => setDraft((current) => ({ ...current, actual_visit_date: event.target.value }))} />
          </Field>
          <Field className={propertyChipClass} label={pick(locale, "Status", "상태")}>
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
