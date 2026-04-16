"use client";

import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { SectionHeader } from "../components/ui/section-header";
import type { SiteRecord } from "../lib/api";
import { fetchPublicSites } from "../lib/auth";
import type { DesktopAppConfigState } from "../lib/desktop-app-config";
import { openDesktopExternalUrl } from "../lib/desktop-app-config";
import { LocaleToggle, pick, useI18n } from "../lib/i18n";
import { getSiteDisplayName } from "../lib/site-labels";
import { isOperatorUiEnabled } from "../lib/ui-mode";

type DesktopLandingScreenProps = {
  authBusy: boolean;
  error: string | null;
  config: DesktopAppConfigState | null;
  onGoogleLaunch: () => void;
  onAdminLaunch: () => void;
};

const PUBLIC_SITE_ROOT = "https://k-era.org";

function formatApproxGiB(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

export function DesktopLandingScreen(props: DesktopLandingScreenProps) {
  const { locale } = useI18n();
  const operatorUiEnabled = isOperatorUiEnabled();
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);

  const diskNotice = props.config?.runtime_contract.disk_notice ?? null;
  const showDiskNotice =
    props.config?.runtime_contract.packaged_mode &&
    diskNotice &&
    (diskNotice.first_launch_runtime_pending || diskNotice.runtime_space_ok === false);
  const runtimeDir = props.config?.runtime_contract.runtime_dir ?? "";
  const storageDir = props.config?.values.storage_dir?.trim() ?? "";

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

  const activeSiteLabels = publicSites
    .slice(0, 6)
    .map((site) => getSiteDisplayName(site))
    .filter(Boolean);

  return (
    <main className="min-h-screen bg-[#0d0f14] px-4 py-8 text-[#e4e8f5] sm:px-6 lg:px-8">
      {showDiskNotice ? (
        <div className="mx-auto mb-5 w-full max-w-6xl">
          <div
            className={`rounded-[22px] border px-5 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur ${
              diskBlocking
                ? "border-danger/25 bg-[rgba(120,26,26,0.92)] text-white"
                : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,250,235,0.96)] text-[#3b3218]"
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
              {diskBlocking ? <p className="m-0 text-sm font-medium leading-6">{diskBlocking}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-5">
        {props.error ? (
          <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
            {props.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#8fa4e6]">
              {pick(locale, "K-ERA Desktop", "K-ERA Desktop")}
            </div>
            <div className="text-[1.8rem] font-semibold tracking-[-0.04em] text-white">
              {pick(locale, "Local case workspace", "로컬 케이스 워크스페이스")}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LocaleToggle className="bg-[rgba(255,255,255,0.06)]" />
            {operatorUiEnabled ? (
              <button
                type="button"
                onClick={props.onAdminLaunch}
                disabled={props.authBusy}
                className="inline-flex min-h-9 items-center rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3.5 text-xs font-medium text-[#808aa3] opacity-78 transition hover:border-[rgba(255,255,255,0.16)] hover:text-[#aab4cc] hover:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)] disabled:pointer-events-none disabled:opacity-45"
              >
                {pick(locale, "Admin sign-in", "관리자 로그인")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.72fr)]">
          <Card as="section" variant="panel" className="grid min-w-0 gap-6 p-6 lg:p-7">
            <SectionHeader
              title={pick(
                locale,
                "Sign in and start real hospital case work",
                "로그인 후 바로 실제 병원 케이스 작업을 시작합니다",
              )}
              description={pick(
                locale,
                "Approved sites sign in here to open the local case workspace on this hospital PC.",
                "승인된 사이트는 여기서 로그인해 이 병원 PC의 로컬 케이스 워크스페이스를 엽니다.",
              )}
            />

            <div className="grid max-w-[460px] gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={props.onGoogleLaunch}
                disabled={props.authBusy}
                className="min-h-14 justify-center px-6 text-base font-semibold"
              >
                {props.authBusy
                  ? pick(locale, "Connecting...", "연결 중...")
                  : pick(locale, "Sign in with approved Google account", "승인된 Google 계정으로 로그인")}
              </Button>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void openDesktopExternalUrl(PUBLIC_SITE_ROOT)}
                  disabled={props.authBusy}
                >
                  {pick(locale, "Open portal for approval help", "승인/안내용 웹 포털 열기")}
                </Button>
              </div>
            </div>

            <details className="group max-w-[560px] rounded-[16px] border border-[rgba(61,92,193,0.12)] bg-[rgba(61,92,193,0.04)] px-4 py-3">
              <summary className="cursor-pointer list-none text-sm font-semibold text-[#1f2a44] marker:content-none">
                <span className="inline-flex items-center gap-2">
                  <span>{pick(locale, "Local desktop details", "로컬 데스크톱 정보")}</span>
                  <span className="text-xs font-medium text-[#58637c] group-open:hidden">
                    {pick(locale, "Show", "보기")}
                  </span>
                  <span className="hidden text-xs font-medium text-[#58637c] group-open:inline">
                    {pick(locale, "Hide", "숨기기")}
                  </span>
                </span>
              </summary>
              <div className="grid gap-3 pt-3 text-sm leading-6 text-[#58637c]">
                <p className="m-0">
                  {pick(
                    locale,
                    "Use the web portal for account approval, release downloads, and central administration.",
                    "웹 포털은 계정 승인, 설치본 안내, 중앙 운영 관리에 사용합니다.",
                  )}
                </p>
                <div className="min-w-0 rounded-[14px] border border-[rgba(61,92,193,0.14)] bg-white/65 px-4 py-3 text-sm leading-6 text-[#495773]">
                  <strong className="mr-2 text-[#1f2a44]">{pick(locale, "Current data folder", "현재 데이터 폴더")}</strong>
                  <span className="break-all">
                    {storageDir || pick(locale, "Default local folder", "기본 로컬 폴더")}
                  </span>
                </div>
              </div>
            </details>
          </Card>

          <Card as="section" variant="panel" className="grid self-start gap-4 p-6">
            <SectionHeader
              title={pick(locale, "Approved sites", "승인된 사이트")}
              description={pick(
                locale,
                "This desktop workspace is for approved hospital sites.",
                "이 데스크톱 워크스페이스는 승인된 병원 사이트용입니다.",
              )}
            />
            {activeSiteLabels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {activeSiteLabels.map((siteLabel) => (
                  <span
                    key={siteLabel}
                    className="inline-flex min-h-10 items-center rounded-full border border-[rgba(61,92,193,0.14)] bg-[rgba(61,92,193,0.05)] px-4 text-sm font-semibold text-[#2d3c63]"
                  >
                    {siteLabel}
                  </span>
                ))}
              </div>
            ) : (
              <div className="rounded-[16px] border border-[rgba(61,92,193,0.14)] bg-[rgba(61,92,193,0.05)] px-4 py-3 text-sm leading-6 text-[#58637c]">
                {pick(
                  locale,
                  "The public site catalog is not loaded yet. You can still sign in if your account is already approved.",
                  "공개 사이트 목록을 아직 불러오지 못했습니다. 이미 승인된 계정이면 바로 로그인할 수 있습니다.",
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
