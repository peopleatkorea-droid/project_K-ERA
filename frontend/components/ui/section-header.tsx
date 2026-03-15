import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type HeadingTag = "h2" | "h3" | "h4";

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
    <div className={cn("flex items-start justify-between gap-4 max-[900px]:flex-col", className)}>
      <div className="grid min-w-0 gap-2.5">
        {eyebrow ? <div className="w-fit">{eyebrow}</div> : null}
        <TitleTag className="font-serif text-[clamp(1.45rem,2vw,2.1rem)] leading-[1.02] tracking-[-0.04em] text-ink">
          {title}
        </TitleTag>
        {description ? <p className="m-0 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {aside ? <div className="shrink-0 max-[900px]:w-full">{aside}</div> : null}
    </div>
  );
}
