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
  activeView: "retrieval" | "cluster";
  aiClinicBusy: boolean;
  aiClinicExpandedBusy: boolean;
  canRunAiClinic: boolean;
  canExpandAiClinic: boolean;
  onRunAiClinic: (
    options?: CaseWorkspaceAiClinicRunOptions,
  ) => Promise<AiClinicPreviewResponse | null>;
  onExpandAiClinic: () => void;
  onSelectRetrievalView: () => void;
  onSelectClusterView: () => void;
  children: ReactNode;
};

function AiClinicPanelInner({
  locale,
  showStepActions = true,
  validationResult,
  activeView,
  aiClinicBusy,
  aiClinicExpandedBusy,
  canRunAiClinic,
  canExpandAiClinic,
  onRunAiClinic,
  onExpandAiClinic,
  onSelectRetrievalView,
  onSelectClusterView,
  children,
}: Props) {
  const tabButtonClass = (isActive: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${
      isActive
        ? "border-brand/24 bg-brand-soft text-brand"
        : "border-border bg-surface text-ink hover:border-brand/20 hover:text-brand"
    }`;
  return (
    <Card as="section" variant="panel" className="grid gap-4 p-5">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Step 3", "3단계")}</div>}
        title={pick(locale, "Image retrieval", "이미지 검색")}
        titleAs="h4"
        description={pick(
          locale,
          "Use this after Step 1. Retrieve similar images first, then load extra evidence and guidance only when needed.",
          "1단계 이후에 사용합니다. 먼저 유사 이미지를 찾고, 필요할 때만 추가 근거와 가이드를 불러옵니다."
        )}
        aside={
          showStepActions ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onRunAiClinic} disabled={aiClinicBusy || !canRunAiClinic}>
                {aiClinicBusy ? pick(locale, "Running image retrieval...", "이미지 검색 실행 중...") : pick(locale, "Run image retrieval", "이미지 검색 실행")}
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
        <button
          type="button"
          className={tabButtonClass(activeView === "retrieval")}
          onClick={onSelectRetrievalView}
          aria-pressed={activeView === "retrieval"}
        >
          {pick(locale, "Image retrieval", "이미지 검색")}
        </button>
        <button
          type="button"
          className={tabButtonClass(activeView === "cluster")}
          onClick={onSelectClusterView}
          aria-pressed={activeView === "cluster"}
        >
          {pick(locale, "3D cluster map", "3D 클러스터 맵")}
        </button>
      </div>

      {!validationResult ? (
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            "Run Step 1 first. Image retrieval uses the image-level analysis as its anchor, then adds extra evidence only when you ask for it.",
            "먼저 1단계를 실행하세요. 이미지 검색은 이미지 레벨 분석을 기준으로 시작하고, 추가 근거는 필요할 때만 이어서 불러옵니다."
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

export const AiClinicPanel = memo(AiClinicPanelInner);
