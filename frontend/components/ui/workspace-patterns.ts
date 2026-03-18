import { cn } from "../../lib/cn";

export const workspaceShellClass =
  "relative min-h-screen bg-[linear-gradient(180deg,var(--bg-muted),var(--bg-canvas)_14%)] text-ink lg:grid lg:grid-cols-[312px_minmax(0,1fr)]";
export const workspaceNoiseClass = "hidden";
export const workspaceRailClass =
  "relative z-10 border-b border-border bg-surface px-5 py-7 lg:border-r lg:border-b-0 lg:px-5 lg:py-7";
export const workspaceMainClass = "relative z-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-8";
export const workspaceHeaderClass = "mb-7 flex items-start justify-between gap-4 max-[900px]:flex-col";
export const workspaceKickerClass =
  "text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const workspaceBrandClass = "mb-4 grid gap-4";
export const workspaceBrandCopyClass = "grid gap-1";
export const workspaceBrandTitleClass = "m-0 text-[1.85rem] font-semibold tracking-[-0.045em] text-ink";
export const workspaceBrandActionsClass = "flex flex-wrap gap-2";
export const workspaceCenterClass = "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]";
export const workspacePanelClass = "grid gap-4";
export const workspaceTitleRowClass = "grid gap-2";
export const workspaceTitleCopyClass = "text-sm leading-6 text-muted";

export const canvasDocumentClass = "mx-auto grid w-full max-w-[920px] gap-6 lg:gap-7";
export const canvasHeaderClass =
  "relative overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,252,247,0.8))] px-6 py-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(135deg,rgba(18,23,30,0.92),rgba(24,31,40,0.84))] lg:px-7 lg:py-7";
export const canvasHeaderGlowClass =
  "pointer-events-none absolute inset-x-[-12%] top-[-38%] h-[240px] bg-[radial-gradient(circle,rgba(48,88,255,0.12),transparent_62%)] dark:bg-[radial-gradient(circle,rgba(124,150,255,0.18),transparent_62%)]";
export const canvasHeaderContentClass = "relative z-10 grid gap-6";
export const canvasHeaderKickerClass =
  "inline-flex min-h-8 items-center rounded-full border border-border/70 bg-white/55 px-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted dark:bg-white/5";
export const canvasHeaderTitleClass =
  "m-0 max-w-3xl text-[clamp(2rem,4.6vw,3.35rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-ink";
export const canvasHeaderBodyClass = "m-0 max-w-2xl text-[0.98rem] leading-7 text-muted";
export const canvasHeaderMetaRowClass = "flex flex-wrap items-center gap-2";
export const canvasHeaderMetaChipClass =
  "inline-flex min-h-9 items-center rounded-full border border-border/70 bg-white/60 px-3.5 text-[0.8rem] font-medium text-muted dark:bg-white/6";
export const canvasSummaryGridClass = "grid gap-3 md:grid-cols-3";
export const canvasSummaryCardClass =
  "grid gap-1.5 rounded-[18px] border border-border/70 bg-white/58 px-4 py-4 backdrop-blur-sm dark:bg-white/4";
export const canvasSummaryLabelClass = "text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted";
export const canvasSummaryValueClass = "text-[1.05rem] font-semibold tracking-[-0.03em] text-ink";

export function canvasBlockClass(active = false) {
  return cn(
    "grid gap-5 rounded-[26px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(255,251,246,0.82))] p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(18,23,30,0.9),rgba(24,31,40,0.84))] lg:p-6",
    active && "border-brand/22 shadow-[0_20px_48px_rgba(48,88,255,0.1)]"
  );
}

export const canvasBlockHeadClass =
  "flex flex-wrap items-start justify-between gap-4 max-[900px]:flex-col max-[900px]:items-stretch";
export const canvasBlockCopyClass = "grid gap-1.5";
export const canvasBlockEyebrowClass = "text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const canvasBlockTitleClass = "m-0 text-[clamp(1.2rem,2vw,1.58rem)] font-semibold tracking-[-0.035em] text-ink";
export const canvasBlockSummaryClass = "m-0 max-w-2xl text-[0.95rem] leading-6 text-muted";
export function canvasBlockStatusClass(tone: "complete" | "active" | "pending" = "pending") {
  return cn(
    "inline-flex min-h-9 items-center rounded-full border px-3.5 py-1 text-[0.78rem] font-semibold tracking-[-0.01em] shadow-[0_6px_16px_rgba(15,23,42,0.04)]",
    tone === "complete" && "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    tone === "active" && "border-brand/20 bg-brand-soft text-brand",
    tone === "pending" && "border-border/70 bg-white/58 text-muted dark:bg-white/4"
  );
}

export const canvasPropertyGridClass = "grid gap-3 md:grid-cols-2 xl:grid-cols-3";
export const canvasPropertyCardClass =
  "grid min-h-full gap-1.5 rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.82))] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)] dark:bg-white/4";
export const canvasPropertyLabelClass = "text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted";
export const canvasPropertyValueClass = "text-sm font-medium leading-6 text-ink";
export const canvasFooterClass =
  "flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.8))] px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] dark:bg-white/4";
export const canvasFooterCopyClass = "grid gap-1";
export const canvasFooterTitleClass = "text-sm font-semibold text-ink";
export const canvasFooterBodyClass = "m-0 text-sm leading-6 text-muted";
export const canvasSidebarClass = "grid gap-4 xl:sticky xl:top-6 xl:self-start";
export const canvasSidebarCardClass =
  "grid gap-4 rounded-[20px] border border-border/70 bg-surface px-5 py-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]";
export const canvasSidebarSectionLabelClass =
  "text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const canvasSidebarMetricGridClass = "grid gap-3 sm:grid-cols-2";
export const canvasSidebarMetricCardClass =
  "grid gap-1 rounded-[16px] border border-border/70 bg-surface-muted/70 px-4 py-3";
export const canvasSidebarMetricValueClass = "text-[1.3rem] font-semibold tracking-[-0.04em] text-ink";
export const canvasSidebarMetricLabelClass = "text-[0.72rem] uppercase tracking-[0.12em] text-muted";
export const canvasSidebarListClass = "grid gap-2.5";
export const canvasSidebarItemClass =
  "rounded-[16px] border border-border/70 bg-[linear-gradient(180deg,rgba(246,248,252,0.92),rgba(240,244,249,0.8))] px-4 py-3 text-sm leading-6 text-muted";

export function workspaceToastClass(tone: "success" | "error") {
  return cn(
    "fixed bottom-5 right-5 z-50 grid min-w-[260px] gap-1 rounded-[12px] border px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.08)]",
    tone === "success"
      ? "border-emerald-300/40 bg-emerald-500/12 text-emerald-50"
      : "border-danger/30 bg-danger/12 text-ink"
  );
}

export const railSectionClass = "grid gap-4 p-5";
export const railSectionHeadClass =
  "flex flex-wrap items-start justify-between gap-3 max-[560px]:flex-col max-[560px]:items-stretch";
export const railLabelClass =
  "text-[0.68rem] leading-[1.25] font-semibold uppercase tracking-[0.14em] text-muted";
export const railSiteListClass = "grid gap-2";
export function railSiteButtonClass(active = false) {
  return cn(
    "grid gap-1.5 rounded-[12px] border border-border bg-surface px-4 py-3 text-left text-sm transition duration-150 ease-out hover:border-brand/20 hover:bg-surface-muted/70",
    active && "border-brand/20 bg-[rgba(48,88,255,0.05)]"
  );
}
export const railCopyClass = "m-0 text-sm leading-6 text-muted";
export const railMetricGridClass = "grid gap-3 sm:grid-cols-2";
export const railSummaryClass = "grid gap-0.5 text-right max-[560px]:text-left";
export const railSummaryValueClass = "text-[1.15rem] font-semibold tracking-[-0.04em] text-ink";
export const railSummaryMetaClass = "text-[0.76rem] text-muted";
export const railMetricCardClass =
  "grid gap-1 rounded-[12px] border border-border bg-surface px-4 py-3";
export const railMetricValueClass = "text-[1.55rem] font-semibold tracking-[-0.04em] text-ink";
export const railMetricLabelClass = "text-[0.72rem] uppercase tracking-[0.12em] text-muted";
export const railActivityItemClass =
  "grid gap-1 rounded-[12px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted";
export const railActivityListClass = "grid gap-3";
export const momentumTrackClass = "h-2.5 overflow-hidden rounded-full bg-brand/10";
export const momentumFillClass = "h-full rounded-full bg-[linear-gradient(90deg,var(--accent-strong),var(--accent))]";
export const validationRailHeadClass = "items-start";
export const railRunButtonClass = "min-w-[168px] justify-center max-[560px]:w-full";

export const docSurfaceClass =
  "grid gap-6 rounded-[16px] border border-border bg-surface p-6 shadow-[0_10px_32px_rgba(15,23,42,0.04)]";
export const docSectionClass = "grid gap-4";
export const docTitleRowClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const docEyebrowClass =
  "inline-flex min-h-8 items-center rounded-[10px] border border-border bg-surface-muted/80 px-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted";
export const docTitleMetaClass = "flex flex-wrap items-center justify-end gap-2";
export const docBadgeRowClass = "flex flex-wrap items-center gap-2";
export const docSiteBadgeClass =
  "inline-flex min-h-8 max-w-full items-center rounded-[10px] border border-border bg-surface px-3 py-1 text-left text-[0.76rem] font-medium text-muted whitespace-normal break-words [overflow-wrap:anywhere]";
export const docSectionHeadClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const docSectionLabelClass =
  "inline-flex min-h-7 items-center rounded-[10px] border border-border bg-surface-muted/70 px-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted";
export const docFooterClass = "flex items-center justify-between gap-4 max-[900px]:flex-col";

export const emptySurfaceClass =
  "rounded-[12px] border border-dashed border-border bg-surface-muted/45 px-4 py-4 text-sm leading-6 text-muted";

export const panelStackClass = "grid gap-4";
export const panelMetricGridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";
export const panelImageStackClass = "grid gap-4";
export const panelImageCardClass = "grid gap-3 rounded-[14px] border border-border bg-surface-muted/80 p-4";
export const panelImageCopyClass = "grid gap-1";
export const panelImageFallbackClass =
  "grid min-h-[240px] place-items-center rounded-[12px] border border-dashed border-border bg-surface-muted/60 px-4 py-5 text-center text-sm leading-6 text-muted";
export const panelImagePreviewClass =
  "aspect-[4/3] w-full rounded-[12px] border border-border/60 bg-surface object-contain";
export const panelPreviewGridClass = "grid gap-4 xl:grid-cols-3";

export const previewSectionHeadClass = "flex items-start justify-between gap-4 max-[900px]:flex-col";
export const previewSectionActionsClass = "flex flex-wrap items-center justify-end gap-2";
export const previewRunButtonClass = "min-w-[188px] justify-center";

export const researchLaunchStripClass =
  "grid gap-4 rounded-[12px] border border-border bg-surface-muted/55 p-5";
export const researchLaunchCopyClass = "grid gap-1.5";
export const researchLaunchActionsClass = "flex flex-wrap gap-2";

export const segmentedToggleClass =
  "inline-flex flex-wrap gap-2 rounded-[10px] border border-border bg-surface-muted/70 p-1";
export function togglePillClass(active = false, compact = false) {
  return cn(
    "rounded-[8px] border border-transparent px-4 text-sm font-semibold transition duration-150 ease-out",
    compact ? "min-h-9" : "min-h-10",
    active
      ? "border-brand/20 bg-[rgba(48,88,255,0.08)] text-brand"
      : "bg-transparent text-muted hover:border-brand/15 hover:bg-surface"
  );
}

export const selectedCaseChipStripClass = "flex flex-wrap gap-3";
export const selectedCaseChipClass =
  "grid gap-1 rounded-[12px] border border-border bg-surface px-4 py-3";
export const organismChipRowClass = "flex flex-wrap gap-2";
export const organismChipClass =
  "inline-flex items-center gap-3 rounded-[10px] border border-border bg-surface px-4 py-2 text-sm";
export const organismChipStaticClass = "border-brand/12 bg-brand-soft/60";
export const predisposingChipClass =
  "inline-flex min-h-8 max-w-full items-center rounded-full border border-[rgba(194,166,133,0.46)] bg-[rgba(255,251,246,0.96)] px-3 py-1 text-[0.78rem] font-medium tracking-[-0.01em] text-[rgb(110,78,52)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] whitespace-nowrap dark:border-[rgba(232,190,132,0.22)] dark:bg-[rgba(93,63,31,0.2)] dark:text-[rgba(255,236,214,0.9)]";
export const organismChipCopyClass = "grid gap-0.5";
export const organismChipRemoveClass =
  "inline-flex min-h-8 items-center rounded-[8px] border border-border bg-white/55 px-3 text-[0.76rem] font-medium text-muted transition hover:border-danger/30 hover:text-danger dark:bg-white/4";

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
    "rounded-[12px] border border-border bg-surface p-4 text-left transition duration-150 ease-out hover:border-brand/20",
    active && "border-brand/24 bg-[rgba(48,88,255,0.04)]"
  );
}
export const patientVisitImageStripClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";
export const patientVisitImageCardClass = "grid gap-2 rounded-[12px] border border-border bg-surface px-3 py-3";
export const patientVisitImageThumbClass =
  "aspect-[4/3] w-full rounded-[16px] border border-border/60 object-cover";
export const patientVisitImageMetaClass = "grid gap-1 text-sm text-muted";
export const representativeImageTagClass =
  "inline-flex min-h-5 items-center rounded-[8px] border border-brand/18 bg-brand-soft/85 px-2 py-0.5 text-[0.72rem] font-medium leading-none text-brand dark:border-brand/22 dark:bg-brand-soft/70 dark:text-brand";

export const listBoardStackClass = "grid gap-3";
export function patientListRowClass(active = false) {
  return cn(
    "group relative overflow-hidden grid gap-4 rounded-[14px] border border-[rgba(218,225,240,0.92)] bg-[rgba(248,250,254,0.96)] px-4 py-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.03)] transition duration-150 ease-out hover:-translate-y-[1px] hover:border-brand/30 hover:bg-[rgba(240,245,255,0.97)] hover:shadow-[0_16px_32px_rgba(48,88,255,0.14)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.16)] dark:border-[rgba(148,163,184,0.2)] dark:bg-[rgba(24,31,40,0.92)] dark:hover:border-[rgba(96,165,250,0.26)] dark:hover:bg-[rgba(29,39,58,0.96)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
    active &&
      "border-brand/34 bg-[rgba(232,239,255,0.98)] shadow-[0_18px_36px_rgba(48,88,255,0.16)] ring-1 ring-brand/14 dark:border-[rgba(110,146,255,0.3)] dark:bg-[rgba(31,43,68,0.96)] dark:ring-[rgba(96,132,255,0.14)]"
  );
}
export const patientListRowMainClass = "grid min-w-0 gap-3";
export const patientListRowChipsClass = "flex flex-wrap gap-2";
export function patientListChipClass(strong = false) {
  return cn(
    "inline-flex min-h-8 items-center rounded-[8px] border border-border bg-surface px-3 text-[0.78rem] text-muted transition duration-150 ease-out group-hover:border-brand/18 group-hover:bg-brand-soft/78 group-hover:text-ink dark:group-hover:border-brand/22 dark:group-hover:bg-brand-soft/60",
    strong && "font-semibold text-ink group-hover:text-brand"
  );
}
export const patientListRowMetaClass = "flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted";
export const patientListThumbnailsClass = "flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end";
export const patientListThumbClass =
  "grid h-14 w-14 place-items-center rounded-[14px] border border-border bg-surface object-cover text-[0.72rem] text-muted shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition duration-150 ease-out group-hover:border-brand/22 group-hover:shadow-[0_10px_20px_rgba(48,88,255,0.12)]";
export const patientListThumbMoreClass =
  "inline-flex h-10 items-center rounded-[8px] border border-border bg-surface px-3 text-[0.76rem] font-medium text-muted transition duration-150 ease-out group-hover:border-brand/22 group-hover:bg-brand-soft/80 group-hover:text-brand";

export const savedCaseImageToolbarClass =
  "grid gap-3 rounded-[14px] border border-border/80 bg-surface-muted/70 p-4";
export const savedCaseImageToolbarCopyClass = "text-sm leading-6 text-muted";
export const savedCaseImageBoardClass = "grid gap-4";
export const lesionEditorSurfaceClass =
  "grid gap-4 rounded-[12px] border border-border bg-surface-muted/55 p-4";
export const lesionEditorImageClass =
  "block max-h-[380px] w-full rounded-[14px] border border-border/60 object-contain";
export const lesionBoxOverlayClass =
  "pointer-events-none absolute rounded-[10px] border-2 border-danger/70 bg-danger/10";
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

export const trainingProgressSettingsClass = "grid gap-4 rounded-[12px] border border-border bg-surface px-4 py-4";

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
export const propertyChipClass = "grid gap-2.5 rounded-[14px] border border-border bg-surface-muted/70 p-4";
export function tagPillClass(active = false) {
  return cn(
    "min-h-10 rounded-[10px] border px-4 text-sm font-semibold transition duration-150 ease-out",
    active
      ? "border-amber-300/70 bg-[linear-gradient(180deg,rgba(255,244,214,1),rgba(255,226,156,0.97))] text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.58),0_10px_22px_rgba(245,158,11,0.15)] ring-1 ring-amber-200/75 dark:border-amber-300/35 dark:bg-[linear-gradient(180deg,rgba(120,53,15,0.5),rgba(146,64,14,0.32))] dark:text-amber-100 dark:ring-amber-300/20"
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
  "cursor-crosshair select-none touch-none relative aspect-[4/3] overflow-hidden rounded-[12px] border border-border bg-surface-elevated";
export const imagePreviewCoverClass = "block h-full w-full object-cover";

export const patientListThumbEmptyClass =
  "grid h-14 min-w-[5.5rem] place-items-center rounded-[14px] border border-border bg-surface px-3 text-[0.72rem] text-muted transition duration-150 ease-out group-hover:border-brand/20 group-hover:bg-brand-soft/72 group-hover:text-ink";

export const listBoardSearchClass = "max-w-[420px]";
export const workspaceUserBadgeClass =
  "inline-flex min-h-10 items-center rounded-[10px] border border-border bg-surface px-4 text-sm font-semibold text-ink";
export function savedCaseActionButtonClass(active = false) {
  return cn(
    "border-brand/20 bg-[rgba(48,88,255,0.06)] text-brand",
    active && "border-amber-300/45 bg-[rgba(244,201,120,0.18)] text-amber-800 dark:text-amber-200"
  );
}

export const semanticPromptReviewClass =
  "grid gap-3 rounded-[12px] border border-border bg-surface-muted/55 p-4";
export const semanticPromptReviewHeadClass = "flex flex-wrap items-start justify-between gap-3";
export const semanticPromptGridClass = "grid gap-3 xl:grid-cols-3";
export const semanticPromptLayerClass = "grid gap-3 rounded-[12px] border border-border bg-surface px-3 py-3";
export const semanticPromptLayerHeadClass = "flex items-start justify-between gap-3";
export const semanticPromptMatchListClass = "grid gap-2";
export const semanticPromptMatchClass =
  "flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-muted/60 px-3 py-3";
export const semanticPromptRankClass = "min-w-6 text-[0.84rem] font-bold text-brand";
export const semanticPromptScoreClass = "text-[0.84rem] font-bold text-ink";
export const semanticPromptCopyClass = "grid min-w-0 flex-1 gap-1";

export const adminMenuClass = "relative";
export function adminMenuTriggerClass(open = false) {
  return cn(
    "inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-border bg-surface px-4 text-sm font-semibold text-ink transition duration-150 ease-out hover:border-brand/20 hover:bg-surface-muted/80",
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
  "absolute right-0 top-[calc(100%+0.5rem)] z-40 grid min-w-[220px] gap-1 rounded-[12px] border border-border bg-surface p-2 shadow-[0_10px_24px_rgba(15,23,42,0.08)]";
export const adminMenuItemClass =
  "rounded-[8px] px-3 py-2 text-sm text-ink transition duration-150 ease-out hover:bg-surface-muted/80";
