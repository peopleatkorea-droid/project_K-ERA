"use client";

import { type ComponentProps, type ReactNode } from "react";

import { pick, type Locale } from "../../lib/i18n";
import { CaseWorkspaceAuthoringCanvas } from "./case-workspace-authoring-canvas";
import { ImageManagerPanel } from "./image-manager-panel";
import { MedsamArtifactBacklogPanel } from "./medsam-artifact-backlog-panel";
import { PatientListBoard } from "./patient-list-board";
import { PatientVisitForm } from "./patient-visit-form";
import { SavedCaseImageBoard } from "./saved-case-image-board";
import {
  SavedCaseOverview,
  SavedCaseSidebar,
} from "./saved-case-overview";
import { Button } from "../ui/button";
import { SectionHeader } from "../ui/section-header";
import {
  docSectionHeadClass,
  docSectionLabelClass,
  docSurfaceClass,
  emptySurfaceClass,
  workspacePanelClass,
} from "../ui/workspace-patterns";

type CaseWorkspacePatientListViewProps = {
  boardProps: ComponentProps<typeof PatientListBoard>;
  backlogProps: ComponentProps<typeof MedsamArtifactBacklogPanel>;
};

export function CaseWorkspacePatientListView({
  boardProps,
  backlogProps,
}: CaseWorkspacePatientListViewProps) {
  return (
    <>
      <div className="order-2 xl:order-1">
        <PatientListBoard {...boardProps} />
      </div>
      <aside
        className={`${workspacePanelClass} order-1 xl:order-2 xl:self-start`}
      >
        <MedsamArtifactBacklogPanel {...backlogProps} />
      </aside>
    </>
  );
}

type CaseWorkspaceSavedCaseViewProps = {
  overviewProps: ComponentProps<typeof SavedCaseOverview>;
  imageBoardProps: ComponentProps<typeof SavedCaseImageBoard>;
  analysisSectionContent?: ReactNode;
  sidebarProps: ComponentProps<typeof SavedCaseSidebar>;
};

export function CaseWorkspaceSavedCaseView({
  overviewProps,
  imageBoardProps,
  analysisSectionContent,
  sidebarProps,
}: CaseWorkspaceSavedCaseViewProps) {
  return (
    <>
      <section className={`${docSurfaceClass} gap-4 p-5 lg:gap-5 lg:p-5`}>
        <SavedCaseOverview {...overviewProps} />
        <SavedCaseImageBoard {...imageBoardProps} />
        {analysisSectionContent}
      </section>

      <SavedCaseSidebar {...sidebarProps} />
    </>
  );
}

type CaseWorkspaceSiteAccessPromptProps = {
  locale: Locale;
  onOpenHospitalAccessRequest?: () => void;
};

export function CaseWorkspaceSiteAccessPrompt({
  locale,
  onOpenHospitalAccessRequest,
}: CaseWorkspaceSiteAccessPromptProps) {
  return (
    <section className={`${docSurfaceClass} gap-4 p-5 lg:gap-5 lg:p-5`}>
      <SectionHeader
        className={docSectionHeadClass}
        eyebrow={
          <div className={docSectionLabelClass}>
            {pick(locale, "Hospital access", "병원 접근")}
          </div>
        }
        title={pick(
          locale,
          "Choose or request a hospital before creating a case",
          "케이스 생성 전에 병원을 선택하거나 요청하세요",
        )}
        titleAs="h4"
        description={pick(
          locale,
          "Case authoring is blocked until a hospital workspace is linked to this session.",
          "현재 세션에 병원 워크스페이스가 연결되기 전에는 케이스 작성을 막습니다.",
        )}
        aside={
          onOpenHospitalAccessRequest ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onOpenHospitalAccessRequest}
            >
              {pick(locale, "Open hospital request", "병원 요청 열기")}
            </Button>
          ) : null
        }
      />
      <div className={emptySurfaceClass}>
        {pick(
          locale,
          "Select an approved hospital or submit a hospital change request first. Patient, visit, and image authoring stay disabled until then.",
          "승인된 병원을 선택하거나 병원 변경 요청을 먼저 제출하세요. 그전까지는 환자, 방문, 이미지 작성이 비활성화됩니다.",
        )}
      </div>
    </section>
  );
}

type CaseWorkspaceDraftViewProps = {
  canvasProps: Omit<
    ComponentProps<typeof CaseWorkspaceAuthoringCanvas>,
    "patientVisitForm" | "imageManagerPanel"
  >;
  patientVisitFormProps: ComponentProps<typeof PatientVisitForm>;
  imageManagerPanelProps: ComponentProps<typeof ImageManagerPanel> | null;
};

export function CaseWorkspaceDraftView({
  canvasProps,
  patientVisitFormProps,
  imageManagerPanelProps,
}: CaseWorkspaceDraftViewProps) {
  return (
    <CaseWorkspaceAuthoringCanvas
      {...canvasProps}
      patientVisitForm={<PatientVisitForm {...patientVisitFormProps} />}
      imageManagerPanel={
        imageManagerPanelProps ? (
          <ImageManagerPanel {...imageManagerPanelProps} />
        ) : null
      }
    />
  );
}
