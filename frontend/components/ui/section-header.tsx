import type { ReactNode } from "react";

type HeadingTag = "h2" | "h3" | "h4";

export type SectionHeaderProps = {
  className?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  titleAs?: HeadingTag;
};

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

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
    <div className={joinClassNames("ds-section-header", className)}>
      <div className="ds-section-header__main">
        {eyebrow ? <div className="ds-section-header__eyebrow">{eyebrow}</div> : null}
        <TitleTag className="ds-section-header__title">{title}</TitleTag>
        {description ? <p className="ds-section-header__description">{description}</p> : null}
      </div>
      {aside ? <div className="ds-section-header__aside">{aside}</div> : null}
    </div>
  );
}
