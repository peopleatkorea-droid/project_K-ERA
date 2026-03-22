"use client";

import type { DesktopAppConfigValues } from "../lib/desktop-app-config";
import type { DesktopSelfCheckItem } from "../lib/desktop-self-check";
import type { Locale } from "../lib/i18n";
import { pick, translateApiError } from "../lib/i18n";
import type { DesktopOnboardingStepId } from "../lib/desktop-onboarding";

import type { DesktopShellCopy } from "./shell-copy";

export function createEmptyDesktopConfigForm(controlPlaneBaseUrl = ""): DesktopAppConfigValues {
  return {
    storage_dir: "",
    control_plane_api_base_url: controlPlaneBaseUrl,
    control_plane_node_id: "",
    control_plane_node_token: "",
    control_plane_site_id: "",
    local_backend_python: "",
    local_backend_mode: "managed",
    ml_transport: "sidecar",
  };
}

export function onboardingStepContent(locale: Locale, stepId: DesktopOnboardingStepId) {
  switch (stepId) {
    case "storage":
      return {
        title: pick(locale, "Choose a data folder", "데이터 폴더 선택"),
        description: pick(
          locale,
          "Choose where this PC should store SQLite, images, models, and logs.",
          "이 PC의 SQLite, 이미지, 모델, 로그를 저장할 위치를 정합니다.",
        ),
      };
    case "controlPlane":
      return {
        title: pick(locale, "Enter the hospital connection", "병원 연결 정보 입력"),
        description: pick(
          locale,
          "Enter the hospital server URL, this PC ID, and the connection key.",
          "병원 서버 주소, 이 PC ID, 연결 키를 입력합니다.",
        ),
      };
    case "site":
      return {
        title: pick(locale, "Choose the default hospital", "기본 병원 선택"),
        description: pick(
          locale,
          "Set the hospital code that should open by default after sign-in.",
          "로그인 후 기본으로 열 병원 코드를 지정합니다.",
        ),
      };
    case "runtimeContract":
      return {
        title: pick(locale, "Check the installation", "설치 점검"),
        description: pick(
          locale,
          "The app checks that its bundled files are available before startup.",
          "앱이 시작하기 전에 필요한 번들 파일이 준비되어 있는지 확인합니다.",
        ),
      };
    case "runtimeServices":
      return {
        title: pick(locale, "Start app services", "앱 서비스 시작"),
        description: pick(
          locale,
          "Start the local app services and verify they are ready.",
          "로컬 앱 서비스를 시작하고 준비 상태를 확인합니다.",
        ),
      };
    case "signIn":
    default:
      return {
        title: pick(locale, "Sign in", "로그인"),
        description: pick(
          locale,
          "The app is ready. Continue with your approved local workspace account.",
          "앱 준비가 끝났습니다. 승인된 로컬 워크스페이스 계정으로 진행합니다.",
        ),
      };
  }
}

export function describeDesktopShellError(locale: Locale, nextError: unknown, fallback: string) {
  if (nextError instanceof Error) {
    return translateApiError(locale, nextError.message);
  }
  if (typeof nextError === "string" && nextError.trim()) {
    return translateApiError(locale, nextError.trim());
  }
  if (
    nextError &&
    typeof nextError === "object" &&
    "message" in nextError &&
    typeof (nextError as { message?: unknown }).message === "string"
  ) {
    return translateApiError(locale, String((nextError as { message: string }).message));
  }
  return fallback;
}

export function formatSelfCheckTone(
  copy: Pick<DesktopShellCopy, "passCheck" | "warnCheck" | "failCheck">,
  item: DesktopSelfCheckItem,
) {
  if (item.status === "pass") {
    return {
      badge: copy.passCheck,
      badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      detailClass: "text-ink",
    };
  }
  if (item.status === "warn") {
    return {
      badge: copy.warnCheck,
      badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      detailClass: "text-amber-700 dark:text-amber-300",
    };
  }
  return {
    badge: copy.failCheck,
    badgeClass: "border-danger/25 bg-danger/10 text-danger",
    detailClass: "text-danger",
  };
}

export function formatTransferSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${Math.round(value)} B`;
}
