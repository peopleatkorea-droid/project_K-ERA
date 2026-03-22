"use client";

import Script from "next/script";
import { useEffect, useRef, type MutableRefObject } from "react";

import type { SiteRecord } from "../../lib/api";
import { useI18n, type Locale } from "../../lib/i18n";
import { EnglishLandingView } from "./landing-v4-en-view";
import { KoreanLandingView } from "./landing-v4-ko-view";

type LandingV4Props = {
  locale: Locale;
  authBusy: boolean;
  error: string | null;
  googleClientId: string;
  googleButtonRefs: MutableRefObject<HTMLDivElement[]>;
  googleLaunchPulse: boolean;
  onGoogleReady: () => void;
  onGoogleSlotsChange: () => void;
  onGoogleLaunch: () => void;
  connectingLabel: string;
  googleLoginLabel: string;
  googleDisabledLabel: string;
  adminRecoveryOnlyLabel: string;
  adminRecoveryLinkLabel: string;
  adminLaunchLinks: Array<{ label: string; href: string }>;
  publicSites: SiteRecord[];
};

export function LandingV4(props: LandingV4Props) {
  const { setLocale } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const googleSlots = Array.from(root.querySelectorAll<HTMLDivElement>("[data-google-slot]"));
    props.googleButtonRefs.current = googleSlots;
    props.onGoogleSlotsChange();

    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    revealTargets.forEach((element) => {
      const order = Number(element.dataset.revealOrder || "0");
      element.style.transitionDelay = `${Math.max(0, order) * 50}ms`;
    });

    let observer: IntersectionObserver | null = null;
    if (revealTargets.length > 0) {
      if (reducedMotion || typeof IntersectionObserver === "undefined") {
        revealTargets.forEach((element) => element.classList.add("is-visible"));
      } else {
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            });
          },
          { threshold: 0.08 },
        );

        revealTargets.forEach((element) => observer?.observe(element));
      }
    }

    return () => {
      observer?.disconnect();
      props.googleButtonRefs.current = [];
    };
  }, [props.googleButtonRefs, props.locale, props.onGoogleSlotsChange]);

  return (
    <>
      {props.googleClientId ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={props.onGoogleReady} />
      ) : null}
      {props.error ? (
        <div className="fixed inset-x-0 top-4 z-[70] mx-auto w-[min(calc(100%-2rem),42rem)] rounded-[18px] border border-danger/25 bg-danger/92 px-4 py-3 text-sm text-white shadow-[0_20px_50px_rgba(120,26,26,0.28)] backdrop-blur">
          {props.error}
        </div>
      ) : null}
      <div ref={rootRef}>
        {props.locale === "ko" ? (
          <KoreanLandingView
            authBusy={props.authBusy}
            googleLoginLabel={props.googleLoginLabel}
            connectingLabel={props.connectingLabel}
            googleLaunchPulse={props.googleLaunchPulse}
            publicSites={props.publicSites}
            onGoogleLaunch={props.onGoogleLaunch}
            onLocaleChange={(locale) => setLocale(locale)}
          />
        ) : (
          <EnglishLandingView
            authBusy={props.authBusy}
            googleLoginLabel={props.googleLoginLabel}
            connectingLabel={props.connectingLabel}
            googleLaunchPulse={props.googleLaunchPulse}
            publicSites={props.publicSites}
            onGoogleLaunch={props.onGoogleLaunch}
            onLocaleChange={(locale) => setLocale(locale)}
          />
        )}
      </div>
    </>
  );
}
