"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { SiteRecord } from "../lib/api";
import type { DesktopAppConfigState } from "../lib/desktop-app-config";
import { fetchPublicSites } from "../lib/auth";
import { openDesktopExternalUrl } from "../lib/desktop-app-config";
import { pick, useI18n } from "../lib/i18n";
import { isOperatorUiEnabled } from "../lib/ui-mode";
import { LandingV4 } from "../components/public/landing-v4";

type DesktopLandingScreenProps = {
  authBusy: boolean;
  error: string | null;
  config: DesktopAppConfigState | null;
  onGoogleLaunch: () => void;
  onAdminLaunch: () => void;
};

const PUBLIC_SITE_ROOT = "https://kera-bay.vercel.app";

function formatApproxGiB(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

export function DesktopLandingScreen(props: DesktopLandingScreenProps) {
  const { locale } = useI18n();
  const operatorUiEnabled = isOperatorUiEnabled();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);
  const diskNotice = props.config?.runtime_contract.disk_notice ?? null;
  const showDiskNotice =
    props.config?.runtime_contract.packaged_mode &&
    diskNotice &&
    (diskNotice.first_launch_runtime_pending || diskNotice.runtime_space_ok === false);
  const diskCopy = {
    title: pick(locale, "CPU desktop storage footprint", "CPU 데스크톱 저장 공간 안내"),
    body: pick(
      locale,
      "The installed CPU build uses about {total} total disk after first launch. The app already occupies about {install}, and first launch unpacks about {runtime} more under {runtimeDir}.",
      "설치된 CPU 배포본은 첫 실행 후 총 {total} 정도의 디스크를 사용합니다. 설치 직후 앱 자체가 약 {install}를 차지하고, 첫 실행 때 {runtimeDir} 아래로 약 {runtime}를 추가로 풉니다.",
    ),
    blocking: pick(
      locale,
      "The runtime drive currently has only {free} free. Free at least {required} on that drive before starting local services.",
      "현재 런타임 드라이브 여유 공간은 {free}뿐입니다. 로컬 서비스를 시작하기 전에 해당 드라이브에 최소 {required} 이상을 확보해야 합니다.",
    ),
    firstRunLabel: pick(locale, "First launch runtime folder", "첫 실행 런타임 폴더"),
  };
  const runtimeDir = props.config?.runtime_contract.runtime_dir ?? "";
  const diskBody = showDiskNotice
    ? diskCopy.body
        .replace("{total}", formatApproxGiB(diskNotice.estimated_total_after_first_launch_bytes))
        .replace("{install}", formatApproxGiB(diskNotice.estimated_install_footprint_bytes))
        .replace("{runtime}", formatApproxGiB(diskNotice.estimated_first_launch_runtime_bytes))
        .replace("{runtimeDir}", runtimeDir || "the desktop runtime folder")
    : null;
  const diskBlocking =
    showDiskNotice && diskNotice.runtime_space_ok === false && diskNotice.runtime_drive_free_bytes != null
      ? diskCopy.blocking
          .replace("{free}", formatApproxGiB(diskNotice.runtime_drive_free_bytes))
          .replace("{required}", formatApproxGiB(diskNotice.recommended_runtime_free_bytes))
      : null;

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
      {showDiskNotice ? (
        <div className="sticky top-0 z-[65] mx-auto w-[min(calc(100%-2rem),72rem)] pt-4">
          <div
            className={`rounded-[22px] border px-5 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur ${
              diskBlocking
                ? "border-danger/25 bg-[rgba(120,26,26,0.92)] text-white"
                : "border-[rgba(15,23,42,0.08)] bg-[rgba(255,250,235,0.96)] text-[#3b3218]"
            }`}
          >
            <div className="grid gap-2">
              <strong className="text-sm font-semibold">{diskCopy.title}</strong>
              {diskBody ? <p className="m-0 text-sm leading-6">{diskBody}</p> : null}
              {runtimeDir ? (
                <p className="m-0 text-[0.82rem] leading-6 opacity-90">
                  {diskCopy.firstRunLabel}: <code className="font-mono">{runtimeDir}</code>
                </p>
              ) : null}
              {diskBlocking ? <p className="m-0 text-sm leading-6 font-medium">{diskBlocking}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      <LandingV4
        locale={locale}
        authBusy={props.authBusy}
        error={props.error}
        googleClientId=""
        googleButtonRef={googleButtonRef}
        googleLaunchPulse={props.authBusy}
        onGoogleReady={() => undefined}
        onGoogleLaunch={props.onGoogleLaunch}
        connectingLabel={pick(locale, "Connecting...", "연결 중...")}
        googleLoginLabel={pick(locale, "Sign in with Google", "Google로 로그인")}
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
        adminRecoveryLinkLabel={operatorUiEnabled ? pick(locale, "Operations", "운영") : ""}
        adminLaunchLinks={[]}
        publicSites={publicSites}
      />
    </div>
  );
}
