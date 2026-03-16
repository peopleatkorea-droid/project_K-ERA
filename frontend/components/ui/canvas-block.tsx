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
  aside,
  children,
}: CanvasBlockProps) {
  return (
    <section className={cn(canvasBlockClass(statusTone === "active"), className)}>
      <div className={canvasBlockHeadClass}>
        <div className={canvasBlockCopyClass}>
          {eyebrow ? <div className={canvasBlockEyebrowClass}>{eyebrow}</div> : null}
          <h3 className={canvasBlockTitleClass}>{title}</h3>
          {summary ? <p className={canvasBlockSummaryClass}>{summary}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {statusLabel ? <span className={canvasBlockStatusClass(statusTone)}>{statusLabel}</span> : null}
          {aside}
        </div>
      </div>
      {children}
    </section>
  );
}
