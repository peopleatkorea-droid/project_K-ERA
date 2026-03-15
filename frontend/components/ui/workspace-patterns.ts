import { cn } from "../../lib/cn";

export const workspaceShellClass =
  "relative min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.1),transparent_24%),linear-gradient(180deg,var(--bg-muted),var(--bg-canvas)_28%)] text-ink lg:grid lg:grid-cols-[312px_minmax(0,1fr)]";
export const workspaceNoiseClass = "hidden";
export const workspaceRailClass =
  "relative z-10 border-b border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.02))] px-5 py-7 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] lg:border-r lg:border-b-0 lg:px-5 lg:py-7";
export const workspaceMainClass = "relative z-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-8";
export const workspaceHeaderClass = "mb-7 flex items-start justify-between gap-4 max-[900px]:flex-col";
export const workspaceKickerClass =
  "text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted";
export const workspaceBrandClass = "mb-4 grid gap-4";
export const workspaceBrandCopyClass = "grid gap-2";
export const workspaceBrandActionsClass = "flex flex-wrap gap-2";
export const workspaceCenterClass = "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]";
export const workspacePanelClass = "grid gap-4";
export const workspaceTitleRowClass = "grid gap-2";
export const workspaceTitleCopyClass = "text-sm leading-6 text-muted";

export function workspaceToastClass(tone: "success" | "error") {
  return cn(
    "fixed bottom-5 right-5 z-50 grid min-w-[260px] gap-1 rounded-[22px] border px-4 py-3 shadow-panel backdrop-blur-xl",
    tone === "success"
      ? "border-emerald-300/40 bg-emerald-500/12 text-emerald-50"
      : "border-danger/30 bg-danger/12 text-ink"
  );
}

export const railSectionClass = "grid gap-4";
export const railSectionHeadClass = "flex items-center justify-between gap-3";
export const railLabelClass =
  "text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const railSiteListClass = "grid gap-2";
export function railSiteButtonClass(active = false) {
  return cn(
    "grid gap-1.5 rounded-[18px] border border-border bg-surface/80 px-4 py-3 text-left text-sm transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted/80",
    active && "border-brand/20 bg-brand-soft/70 shadow-card"
  );
}
export const railCopyClass = "m-0 text-sm leading-6 text-muted";
export const railMetricGridClass = "grid grid-cols-2 gap-3 max-[900px]:grid-cols-1";
export const railActivityItemClass =
  "grid gap-1 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted";
export const railActivityListClass = "grid gap-3";
export const momentumTrackClass = "h-2.5 overflow-hidden rounded-full bg-brand/10";
export const momentumFillClass = "h-full rounded-full bg-[linear-gradient(90deg,var(--accent-strong),var(--accent))]";
export const validationRailHeadClass = "items-start";
export const railRunButtonClass = "min-w-[168px] justify-center";

export const docSurfaceClass =
  "grid gap-6 rounded-[var(--radius-lg)] border border-border bg-surface/90 p-6 shadow-panel backdrop-blur-xl";
export const docSectionClass = "grid gap-4";
export const docTitleRowClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const docEyebrowClass =
  "inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const docTitleMetaClass = "flex flex-wrap items-center justify-end gap-2";
export const docBadgeRowClass = "flex flex-wrap items-center gap-2";
export const docSiteBadgeClass =
  "inline-flex min-h-9 items-center rounded-full border border-border bg-white/55 px-3 text-[0.78rem] font-medium text-muted dark:bg-white/4";
export const docSectionHeadClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const docSectionLabelClass =
  "inline-flex min-h-8 items-center rounded-full border border-brand/12 bg-brand-soft/70 px-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-brand";
export const docFooterClass = "flex items-center justify-between gap-4 max-[900px]:flex-col";

export const emptySurfaceClass =
  "rounded-[20px] border border-dashed border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted";

export const panelStackClass = "grid gap-4";
export const panelMetricGridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";
export const panelImageStackClass = "grid gap-4";
export const panelImageCardClass = "grid gap-3 rounded-[20px] border border-border bg-surface-muted/80 p-4";
export const panelImageCopyClass = "grid gap-1";
export const panelImageFallbackClass =
  "grid min-h-[240px] place-items-center rounded-[18px] border border-dashed border-border bg-surface-muted/60 px-4 py-5 text-center text-sm leading-6 text-muted";
export const panelImagePreviewClass =
  "aspect-[4/3] w-full rounded-[18px] border border-border/60 bg-surface object-cover";
export const panelPreviewGridClass = "grid gap-4 xl:grid-cols-3";

export const previewSectionHeadClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const previewSectionActionsClass = "flex flex-wrap items-center justify-end gap-2";
export const previewRunButtonClass = "min-w-[188px] justify-center";

export const researchLaunchStripClass =
  "grid gap-4 rounded-[20px] border border-border bg-surface-muted/80 p-5";
export const researchLaunchCopyClass = "grid gap-1.5";
export const researchLaunchActionsClass = "flex flex-wrap gap-2";

export const segmentedToggleClass =
  "inline-flex flex-wrap gap-2 rounded-full border border-border bg-surface-muted/70 p-1";
export function togglePillClass(active = false, compact = false) {
  return cn(
    "rounded-full border border-transparent px-4 text-sm font-semibold transition duration-150 ease-out",
    compact ? "min-h-9" : "min-h-10",
    active
      ? "bg-brand text-[var(--accent-contrast)] shadow-[0_10px_20px_rgba(48,88,255,0.18)]"
      : "bg-transparent text-muted hover:border-brand/15 hover:bg-surface"
  );
}

export const selectedCaseChipStripClass = "flex flex-wrap gap-3";
export const selectedCaseChipClass =
  "grid gap-1 rounded-[18px] border border-border bg-surface px-4 py-3";
export const organismChipRowClass = "flex flex-wrap gap-2";
export const organismChipClass =
  "inline-flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm";
export const organismChipStaticClass = "border-brand/12 bg-brand-soft/60";
export const organismChipCopyClass = "grid gap-0.5";
export const organismChipRemoveClass =
  "inline-flex min-h-8 items-center rounded-full border border-border bg-white/55 px-3 text-[0.76rem] font-medium text-muted transition hover:border-danger/30 hover:text-danger dark:bg-white/4";

export const summaryNoteClass = "m-0 text-sm leading-6 text-muted";
export const propertyHintClass = "text-sm leading-6 text-muted";
export const supportFieldClass = "grid gap-2.5";
export const supportLabelClass = "text-[0.82rem] font-medium text-muted";
export const supportHintClass = "text-[0.76rem] leading-6 text-muted";
export const factorListClass = "flex flex-wrap gap-2";
export const draftIntakeCardClass = "grid gap-5 border border-border/80 p-5";
export const draftIntakeGridClass = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
export const draftIntakeNoteClass = "grid gap-2";

export const patientVisitGalleryStackClass = "grid gap-3";
export function patientVisitGalleryCardClass(active = false) {
  return cn(
    "rounded-[20px] border border-border bg-surface-muted/80 p-4 text-left transition duration-150 ease-out hover:-translate-y-0.5",
    active && "border-brand/20 bg-brand-soft/60 shadow-card"
  );
}
export const patientVisitImageStripClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";
export const patientVisitImageCardClass = "grid gap-2 rounded-[18px] border border-border bg-surface px-3 py-3";
export const patientVisitImageThumbClass =
  "aspect-[4/3] w-full rounded-[16px] border border-border/60 object-cover";
export const patientVisitImageMetaClass = "grid gap-1 text-sm text-muted";

export const listBoardStackClass = "grid gap-3";
export function patientListRowClass(active = false) {
  return cn(
    "grid gap-4 rounded-[20px] border border-border bg-surface-muted/80 px-4 py-4 text-left transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20",
    active && "border-brand/20 bg-brand-soft/60 shadow-card"
  );
}
export const patientListRowMainClass = "grid gap-3";
export const patientListRowChipsClass = "flex flex-wrap gap-2";
export function patientListChipClass(strong = false) {
  return cn(
    "inline-flex min-h-8 items-center rounded-full border border-border bg-surface px-3 text-[0.78rem] text-muted",
    strong && "font-semibold text-ink"
  );
}
export const patientListRowMetaClass = "flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted";
export const patientListThumbnailsClass = "flex flex-wrap items-center gap-2";
export const patientListThumbClass =
  "grid h-14 w-14 place-items-center rounded-[14px] border border-border bg-surface object-cover text-[0.72rem] text-muted";
export const patientListThumbMoreClass =
  "inline-flex h-10 items-center rounded-full border border-border bg-surface px-3 text-[0.76rem] font-medium text-muted";

export const savedCaseImageToolbarClass =
  "grid gap-3 rounded-[20px] border border-border/80 bg-surface-muted/70 p-4";
export const savedCaseImageToolbarCopyClass = "text-sm leading-6 text-muted";
export const savedCaseImageBoardClass = "grid gap-4";
export const lesionEditorSurfaceClass =
  "grid gap-4 rounded-[20px] border border-border bg-surface-muted/80 p-4";
export const lesionEditorImageClass =
  "block max-h-[380px] w-full rounded-[18px] border border-border/60 object-contain";
export const lesionBoxOverlayClass =
  "pointer-events-none absolute rounded-[18px] border-2 border-danger/70 bg-danger/10";
export const annotationActionsClass = "grid gap-4";
export const liveCropCardClass = "grid gap-3";
export const liveCropToggleClass = "inline-flex items-center gap-2.5 text-sm font-semibold text-ink";
export const liveCropPreviewSectionClass = "pt-0";
export function liveCropCanvasClass(ready = false) {
  return cn(panelImagePreviewClass, ready ? "block" : "hidden", "bg-surface/60");
}
export function liveCropFallbackClass(ready = false) {
  return cn(panelImagePreviewClass, ready ? "hidden" : "block");
}
export function panelImageOverlayClass(ready = false) {
  return cn(panelImagePreviewClass, ready ? "block" : "hidden", "bg-surface/60");
}
export function panelImageOverlayFallbackClass(ready = false) {
  return cn(panelImagePreviewClass, ready ? "hidden" : "block");
}
export const panelImageAnnotationSurfaceClass = "m-4 mb-2.5";
export const panelImageAnnotationActionsClass = "flex flex-wrap gap-2 px-4 pb-2.5";
export const panelImageAnnotationMetaClass = "flex flex-wrap items-center gap-2 px-4 pb-2.5";
export const savedImageActionBarClass = "flex flex-wrap items-center gap-2.5";
export const savedImageMetricGridClass = "gap-3";
export const previewItemMetricGridClass = "mb-1";

export const trainingProgressSettingsClass = "grid gap-4 rounded-[18px] border border-border bg-surface px-4 py-4";

export const validationPanelHeadClass = "items-start";
export const validationPanelActionsClass = "ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2.5";
export const validationPanelIdClass = "truncate text-sm text-muted";
export const validationRunButtonClass = "whitespace-nowrap";

export const contributionPanelClass = "overflow-hidden";
export const contributionStatusCardClass = "p-4";
export const contributionNoteStackClass = "grid gap-2.5 p-4";
export const contributionNoteClass = "m-0 text-sm leading-7 text-muted";
export const contributionMetricGridClass = "gap-3";
export const historyPanelClass = "overflow-hidden";
export const historyPanelMetricGridClass = "gap-3";
export const historyPanelColumnsClass = "grid gap-4 lg:grid-cols-2";
export const historyColumnClass = "grid gap-4 p-4";
export const historyColumnHeadClass = "flex flex-wrap items-center justify-between gap-2.5";
export const historyPanelListClass = "grid gap-3";
export const historyEntryClass = "grid gap-2.5 border border-border p-4";
export const historyEntryHeadClass = "flex flex-wrap items-center justify-between gap-2.5";
export const historyEntryMetaClass = "flex flex-wrap items-center justify-between gap-2.5 text-[0.82rem] leading-6 text-muted";

export const propertyGridClass = "my-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3";
export function visitTimingGridClass(followUp = false) {
  return cn(
    propertyGridClass,
    followUp && "xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.82fr)_minmax(0,1.15fr)_minmax(0,0.98fr)]"
  );
}
export const propertyChipClass = "grid gap-2.5 rounded-[20px] border border-border bg-surface-muted/70 p-4";
export function tagPillClass(active = false) {
  return cn(
    "min-h-10 rounded-full border px-4 text-sm font-semibold transition duration-150 ease-out",
    active
      ? "border-brand/20 bg-brand-soft text-brand"
      : "border-border bg-surface text-muted hover:border-brand/15 hover:bg-surface-muted/80 hover:text-ink"
  );
}
export const visitContextSelectClass = "grid gap-2.5";
export const visitIntakeMetaClass = "justify-end";
export const visitIntakeSummaryBadgeClass = "self-start";
export const visitTimingMetaClass = "justify-end";
export const intakeSummaryMetricGridClass = "gap-3";
export const intakeSummaryMetricCardClass = "min-h-full";
export const completeIntakeButtonClass = "shadow-[0_10px_24px_rgba(20,184,166,0.16)]";
export const organismAddButtonClass = "min-w-[144px] justify-center";

export function imageGridClass(single = false) {
  return cn("mt-4 grid gap-4 md:grid-cols-2", single && "md:grid-cols-1");
}
export const draftLesionSurfaceClass =
  "cursor-crosshair select-none touch-none relative aspect-[4/3] overflow-hidden rounded-[18px] border border-border bg-surface-elevated";
export const imagePreviewCoverClass = "block h-full w-full object-cover";

export const patientListThumbEmptyClass =
  "grid h-14 min-w-[5.5rem] place-items-center rounded-[14px] border border-border bg-surface px-3 text-[0.72rem] text-muted";

export const listBoardSearchClass = "max-w-[420px]";
export const workspaceUserBadgeClass =
  "inline-flex min-h-10 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold text-ink";
export function savedCaseActionButtonClass(active = false) {
  return cn(
    "border-brand/20 bg-brand-soft/70 text-ink shadow-card",
    active && "border-amber-300/45 bg-[linear-gradient(135deg,rgba(244,201,120,0.24),rgba(48,88,255,0.14))] text-amber-800 dark:text-amber-200"
  );
}

export const semanticPromptReviewClass =
  "grid gap-3 rounded-[20px] border border-border bg-surface-muted/70 p-4";
export const semanticPromptReviewHeadClass = "flex flex-wrap items-start justify-between gap-3";
export const semanticPromptGridClass = "grid gap-3 xl:grid-cols-3";
export const semanticPromptLayerClass = "grid gap-3 rounded-[18px] border border-border bg-surface px-3 py-3";
export const semanticPromptLayerHeadClass = "flex items-start justify-between gap-3";
export const semanticPromptMatchListClass = "grid gap-2";
export const semanticPromptMatchClass =
  "flex items-start justify-between gap-3 rounded-[16px] border border-border bg-surface-muted/60 px-3 py-3";
export const semanticPromptRankClass = "min-w-6 text-[0.84rem] font-bold text-brand";
export const semanticPromptScoreClass = "text-[0.84rem] font-bold text-ink";
export const semanticPromptCopyClass = "grid min-w-0 flex-1 gap-1";

export const adminMenuClass = "relative";
export function adminMenuTriggerClass(open = false) {
  return cn(
    "inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-ink transition duration-150 ease-out hover:border-brand/20 hover:bg-surface-muted/80",
    open && "border-brand/20 bg-brand-soft/70 text-brand"
  );
}
export function adminMenuCaretClass(open = false) {
  return cn(
    "inline-block h-2.5 w-2.5 rotate-45 border-r-2 border-b-2 border-current transition-transform duration-150 ease-out",
    open && "translate-y-[-1px] rotate-[225deg]"
  );
}
export const adminMenuDropdownClass =
  "absolute right-0 top-[calc(100%+0.5rem)] z-40 grid min-w-[220px] gap-1 rounded-[20px] border border-border bg-surface p-2 shadow-panel";
export const adminMenuItemClass =
  "rounded-[14px] px-3 py-2 text-sm text-ink transition duration-150 ease-out hover:bg-surface-muted/80";
