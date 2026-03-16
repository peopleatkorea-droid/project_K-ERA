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
  googleButtonRef: MutableRefObject<HTMLDivElement | null>;
  googleLaunchPulse: boolean;
  onGoogleReady: () => void;
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

    const googleSlot = root.querySelector<HTMLDivElement>("[data-google-slot]");
    props.googleButtonRef.current = googleSlot;

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
      props.googleButtonRef.current = null;
    };
  }, [props.googleButtonRef, props.locale]);

  return (
    <>
      {props.googleClientId ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={props.onGoogleReady} />
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
