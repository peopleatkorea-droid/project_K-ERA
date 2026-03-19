import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import {
  canvasBlockClass,
  canvasBlockCopyClass,
  canvasBlockEyebrowClass,
  canvasBlockHeadClass,
  canvasBlockStatusClass,
  canvasBlockSummaryClass,
  canvasBlockTitleClass,
} from "./workspace-patterns";

type CanvasBlockStatusTone = "complete" | "active" | "pending";

export type CanvasBlockProps = {
  className?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  statusLabel?: ReactNode;
  statusTone?: CanvasBlockStatusTone;
  headerInline?: boolean;
  aside?: ReactNode;
  children: ReactNode;
};

export function CanvasBlock({
  className,
  eyebrow,
  title,
  summary,
  statusLabel,
  statusTone = "pending",
  headerInline = false,
  aside,
  children,
}: CanvasBlockProps) {
  return (
    <section className={cn(canvasBlockClass(statusTone === "active"), className)}>
      <div
        className={cn(
          canvasBlockHeadClass,
          headerInline && "items-center gap-3 max-[900px]:flex-row max-[900px]:items-center"
        )}
      >
        <div
          className={cn(
            canvasBlockCopyClass,
            headerInline && "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"
          )}
        >
          {eyebrow ? <div className={cn(canvasBlockEyebrowClass, headerInline && "whitespace-nowrap")}>{eyebrow}</div> : null}
          <h3 className={cn(canvasBlockTitleClass, headerInline && "leading-tight")}>{title}</h3>
          {summary ? <p className={canvasBlockSummaryClass}>{summary}</p> : null}
        </div>
        <div className={cn("flex flex-wrap items-center justify-end gap-2", headerInline && "shrink-0")}>
          {statusLabel ? <span className={canvasBlockStatusClass(statusTone)}>{statusLabel}</span> : null}
          {aside}
        </div>
      </div>
      {children}
    </section>
  );
}
