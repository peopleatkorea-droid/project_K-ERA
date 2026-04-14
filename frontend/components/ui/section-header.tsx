import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type HeadingTag = "h2" | "h3" | "h4" | "h5";

export type SectionHeaderProps = {
  className?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  titleAs?: HeadingTag;
};

export function SectionHeader({
  className,
  eyebrow,
  title,
  description,
  aside,
  titleAs = "h3",
}: SectionHeaderProps) {
  const TitleTag = titleAs;
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-4 max-[900px]:flex-col", className)}>
      <div className="grid min-w-0 gap-2.5">
        {eyebrow ? <div className="w-fit">{eyebrow}</div> : null}
        <TitleTag className="min-w-0 break-words text-[clamp(1.3rem,1.7vw,1.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-ink [overflow-wrap:anywhere]">
          {title}
        </TitleTag>
        {description ? (
          <p className="m-0 max-w-3xl break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
      </div>
      {aside ? <div className="max-w-full shrink-0 self-start max-[900px]:w-full">{aside}</div> : null}
    </div>
  );
}
