"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { SiteRecord } from "../lib/api";
import { fetchPublicSites } from "../lib/auth";
import { openDesktopExternalUrl } from "../lib/desktop-app-config";
import { pick, useI18n } from "../lib/i18n";
import { LandingV4 } from "../components/public/landing-v4";

type DesktopLandingScreenProps = {
  authBusy: boolean;
  error: string | null;
  onGoogleLaunch: () => void;
  onAdminLaunch: () => void;
};

const PUBLIC_SITE_ROOT = "https://kera-bay.vercel.app";

export function DesktopLandingScreen(props: DesktopLandingScreenProps) {
  const { locale } = useI18n();
  const googleButtonRefs = useRef<HTMLDivElement[]>([]);
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicSites()
      .then((nextSites) => {
        if (!cancelled) {
          setPublicSites(nextSites);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function handleExternalLinkClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const rawHref = anchor.getAttribute("href")?.trim() ?? "";
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:")) {
      return;
    }

    if (rawHref === "/admin-login" || rawHref.startsWith("/admin-login?")) {
      event.preventDefault();
      props.onAdminLaunch();
      return;
    }

    let nextHref = rawHref;
    if (rawHref.startsWith("/")) {
      nextHref = `${PUBLIC_SITE_ROOT}${rawHref}`;
    }
    if (!nextHref.startsWith("http://") && !nextHref.startsWith("https://")) {
      return;
    }

    event.preventDefault();
    void openDesktopExternalUrl(nextHref).catch(() => undefined);
  }

  return (
    <div onClickCapture={handleExternalLinkClick}>
      <LandingV4
        locale={locale}
        authBusy={props.authBusy}
        error={props.error}
        googleClientId=""
        googleButtonRefs={googleButtonRefs}
        googleLaunchPulse={props.authBusy}
        onGoogleReady={() => undefined}
        onGoogleSlotsChange={() => undefined}
        onGoogleLaunch={props.onGoogleLaunch}
        connectingLabel={pick(locale, "Connecting...", "연결 중...")}
        googleLoginLabel={pick(locale, "Institution Google login", "기관 Google 로그인")}
        googleDisabledLabel={pick(
          locale,
          "Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or `NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID` is set.",
          "`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 또는 `NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID`가 설정되기 전까지 Google 로그인이 비활성화됩니다.",
        )}
        adminRecoveryOnlyLabel={pick(
          locale,
          "Password sign-in for admin and site admin",
          "admin 및 site admin 비밀번호 로그인",
        )}
        adminRecoveryLinkLabel={pick(locale, "Open operator password sign-in", "운영 계정 비밀번호 로그인 열기")}
        adminLaunchLinks={[
          {
            label: pick(locale, "Admin training", "관리자 학습"),
            href: `${PUBLIC_SITE_ROOT}/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dtraining`,
          },
          {
            label: pick(locale, "Admin cross-validation", "관리자 교차 검증"),
            href: `${PUBLIC_SITE_ROOT}/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dcross_validation`,
          },
          {
            label: pick(locale, "Admin hospital validation", "관리자 병원 검증"),
            href: `${PUBLIC_SITE_ROOT}/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Ddashboard`,
          },
        ]}
        publicSites={publicSites}
      />
    </div>
  );
}
