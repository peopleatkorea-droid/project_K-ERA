"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type LandingGoogleCtaProps = {
  buttonClassName: string;
  children: ReactNode;
  googleLaunchPulse?: boolean;
  onGoogleLaunch: () => void;
  pulseClassName?: string;
  slotClassName?: string;
  wrapperClassName?: string;
};

export function LandingGoogleCta({
  buttonClassName,
  children,
  googleLaunchPulse = false,
  onGoogleLaunch,
  pulseClassName,
  wrapperClassName,
}: LandingGoogleCtaProps) {
  return (
    <div className={cn("relative inline-flex", wrapperClassName)}>
      <div
        className={cn(buttonClassName, googleLaunchPulse && pulseClassName)}
        role="button"
        tabIndex={0}
        onClick={onGoogleLaunch}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          onGoogleLaunch();
        }}
      >
        <span className="pointer-events-none">{children}</span>
      </div>
    </div>
  );
}
