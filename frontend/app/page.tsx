"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

const AdminWorkspace = dynamic(() =>
  import("../components/admin-workspace").then((m) => ({ default: m.AdminWorkspace })),
  { loading: () => null },
);
const CaseWorkspace = dynamic(() =>
  import("../components/case-workspace").then((m) => ({ default: m.CaseWorkspace })),
  { loading: () => null },
);
const LandingV4 = dynamic(() =>
  import("../components/public/landing-v4").then((m) => ({ default: m.LandingV4 })),
  { loading: () => null },
);
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { RuntimeErrorBoundary } from "../components/ui/runtime-error-boundary";
import { SectionHeader } from "../components/ui/section-header";
import {
  GOOGLE_CLIENT_ID,
  type OperationsSection,
  parseOperationsLaunchFromSearch,
  type RequestFormState,
  type WorkspaceMode,
} from "./home-page-auth-shared";
import { useApprovedWorkspaceState } from "./use-approved-workspace-state";
import { useHomeAuthBootstrap } from "./use-home-auth-bootstrap";
import { cn } from "../lib/cn";
import { canUseDesktopGoogleAuth } from "../lib/desktop-google-auth";
import { canUseDesktopTransport } from "../lib/desktop-transport";
import { LocaleToggle, pick, translateApiError, translateRole, translateStatus, useI18n } from "../lib/i18n";
import { getRequestedSiteLabel, getSiteDisplayName } from "../lib/site-labels";
import { useTheme } from "../lib/theme";
import { isOperatorUiEnabled } from "../lib/ui-mode";
import {
  claimDesktopReleaseDownload,
  createPatient,
  downloadManifest,
  fetchDesktopReleases,
  type DesktopReleaseRecord,
  type PublicInstitutionRecord,
  type SiteSummary,
  type AccessRequestRecord,
  type AuthState,
} from "../lib/api";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type HomeHistoryEntry = {
  scope: "home-page";
  version: 1;
  kind: "workspace" | "guard";
  workspace_mode: WorkspaceMode;
};

const INSTITUTION_SEARCH_ALIASES: Record<string, string[]> = {
  seoul: ["seoul", "서울"],
  "서울": ["seoul", "서울"],
  busan: ["busan", "부산"],
  "부산": ["busan", "부산"],
  daegu: ["daegu", "대구"],
  "대구": ["daegu", "대구"],
  incheon: ["incheon", "인천"],
  "인천": ["incheon", "인천"],
  gwangju: ["gwangju", "광주"],
  "광주": ["gwangju", "광주"],
  daejeon: ["daejeon", "대전"],
  "대전": ["daejeon", "대전"],
  ulsan: ["ulsan", "울산"],
  "울산": ["ulsan", "울산"],
  sejong: ["sejong", "세종"],
  "세종": ["sejong", "세종"],
  gyeonggi: ["gyeonggi", "경기", "경기도"],
  "경기": ["gyeonggi", "경기", "경기도"],
  gangwon: ["gangwon", "강원", "강원도"],
  "강원": ["gangwon", "강원", "강원도"],
  chungbuk: ["chungbuk", "충북", "충청북도"],
  "충북": ["chungbuk", "충북", "충청북도"],
  chungnam: ["chungnam", "충남", "충청남도"],
  "충남": ["chungnam", "충남", "충청남도"],
  jeonbuk: ["jeonbuk", "전북", "전라북도"],
  "전북": ["jeonbuk", "전북", "전라북도"],
  jeonnam: ["jeonnam", "전남", "전라남도"],
  "전남": ["jeonnam", "전남", "전라남도"],
  gyeongbuk: ["gyeongbuk", "경북", "경상북도"],
  "경북": ["gyeongbuk", "경북", "경상북도"],
  gyeongnam: ["gyeongnam", "경남", "경상남도"],
  "경남": ["gyeongnam", "경남", "경상남도"],
  jeju: ["jeju", "제주", "제주도", "제주특별자치도"],
  "제주": ["jeju", "제주", "제주도", "제주특별자치도"],
  hospital: ["hospital", "병원"],
  "병원": ["hospital", "병원"],
  university: ["university", "대학교", "대학"],
  "대학교": ["university", "대학교", "대학"],
  "대학": ["university", "대학교", "대학"],
  clinic: ["clinic", "클리닉", "의원", "안과"],
  "클리닉": ["clinic", "클리닉", "의원", "안과"],
  "의원": ["clinic", "클리닉", "의원", "안과"],
  eye: ["eye", "안과"],
  "안과": ["eye", "안과"],
};

const HOME_HISTORY_KEY = "__keraHomePage";

function buildHomeHistoryEntry(kind: HomeHistoryEntry["kind"], workspaceMode: WorkspaceMode): HomeHistoryEntry {
  return {
    scope: "home-page",
    version: 1,
    kind,
    workspace_mode: workspaceMode,
  };
}

function readHomeHistoryEntry(state: unknown): HomeHistoryEntry | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const rawEntry = (state as Record<string, unknown>)[HOME_HISTORY_KEY];
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }
  const entry = rawEntry as Record<string, unknown>;
  if (entry.scope !== "home-page" || entry.version !== 1) {
    return null;
  }
  if (entry.kind !== "workspace" && entry.kind !== "guard") {
    return null;
  }
  if (entry.workspace_mode !== "canvas" && entry.workspace_mode !== "operations") {
    return null;
  }
  return {
    scope: "home-page",
    version: 1,
    kind: entry.kind,
    workspace_mode: entry.workspace_mode,
  };
}

function isSameHomeHistoryEntry(left: HomeHistoryEntry | null, right: HomeHistoryEntry | null): boolean {
  return left?.kind === right?.kind && left?.workspace_mode === right?.workspace_mode;
}

function tokenizeInstitutionSearch(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣]+/)
    .filter(Boolean);
}

function expandInstitutionSearchToken(token: string): string[] {
  return Array.from(new Set(INSTITUTION_SEARCH_ALIASES[token] ?? [token]));
}

function matchesInstitutionSearch(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const tokens = tokenizeInstitutionSearch(query);
  if (!tokens.length) {
    return true;
  }
  const haystack = fields
    .map((field) => String(field ?? "").toLowerCase())
    .join(" ");
  return tokens.every((token) => expandInstitutionSearchToken(token).some((alias) => haystack.includes(alias)));
}

function writeHomeHistoryEntry(entry: HomeHistoryEntry, mode: "push" | "replace") {
  if (typeof window === "undefined") {
    return;
  }
  const nextState: Record<string, unknown> =
    window.history.state && typeof window.history.state === "object"
      ? { ...(window.history.state as Record<string, unknown>) }
      : {};
  nextState[HOME_HISTORY_KEY] = entry;
  if (mode === "push") {
    window.history.pushState(nextState, "");
    return;
  }
  window.history.replaceState(nextState, "");
}

function statusCopy(locale: "en" | "ko", status: AuthState): string {
  if (status === "pending") {
    return pick(locale, "Your institution request is pending review.", "기관 접근 요청이 검토 대기 중입니다.");
  }
  if (status === "rejected") {
    return pick(
      locale,
      "Your last institution request was rejected. Submit a revised request.",
      "이전 기관 접근 요청이 반려되었습니다. 수정 후 다시 제출해 주세요."
    );
  }
  if (status === "application_required") {
    return pick(locale, "Submit your institution and role request to continue.", "기관과 역할 요청을 제출해 주세요.");
  }
  return pick(locale, "Approved", "승인됨");
}

function formatBinarySize(locale: "en" | "ko", sizeBytes: number | null | undefined): string {
  if (!Number.isFinite(sizeBytes) || !sizeBytes || sizeBytes <= 0) {
    return pick(locale, "Size unavailable", "파일 크기 정보 없음");
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

export default function HomePage() {
  const { locale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const operatorUiEnabled = isOperatorUiEnabled();
  const [nativeDesktopGoogleAuth, setNativeDesktopGoogleAuth] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(360);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const workspaceHistoryReadyRef = useRef(false);
  const workspaceModeRef = useRef<WorkspaceMode>("canvas");
  const [requestForm, setRequestForm] = useState<RequestFormState>({
    requested_site_id: "",
    requested_site_label: "",
    requested_role: "researcher",
    message: "",
  });
  const [accessRequestMode, setAccessRequestMode] = useState(false);
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("canvas");
  const [operationsSection, setOperationsSection] = useState<OperationsSection>("management");
  const [desktopReleases, setDesktopReleases] = useState<DesktopReleaseRecord[]>([]);
  const [desktopReleaseBusy, setDesktopReleaseBusy] = useState(false);
  const [desktopReleaseError, setDesktopReleaseError] = useState<string | null>(null);
  const [desktopDownloadBusy, setDesktopDownloadBusy] = useState(false);
  const deferredInstitutionQuery = useDeferredValue(institutionQuery);

  useEffect(() => {
    setNativeDesktopGoogleAuth(canUseDesktopGoogleAuth());
  }, []);

  const copy = {
    unableLoadInstitutions: pick(locale, "Unable to load institutions.", "湲곌? 紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    failedConnect: pick(locale, "Failed to connect.", "?곌껐???ㅽ뙣?덉뒿?덈떎."),
    failedLoadSiteData: pick(locale, "Failed to load hospital data.", "蹂묒썝 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    failedLoadApprovalQueue: pick(locale, "Failed to load approval queue.", "?뱀씤 ?湲곗뿴??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    googleNoCredential: pick(locale, "Google login did not return a credential.", "Google 濡쒓렇???먭꺽 ?뺣낫媛 諛섑솚?섏? ?딆븯?듬땲??"),
    googleLoginFailed: pick(locale, "Google login failed.", "Google 濡쒓렇?몄뿉 ?ㅽ뙣?덉뒿?덈떎."),
    googlePreparing: pick(locale, "Google login is still loading. Try again in a moment.", "Google 濡쒓렇?몄쓣 遺덈윭?ㅻ뒗 以묒엯?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??"),
    loginFailed: pick(locale, "Login failed.", "濡쒓렇?몄뿉 ?ㅽ뙣?덉뒿?덈떎."),
    requestSubmissionFailed: pick(locale, "Request submission failed.", "?붿껌 ?쒖텧???ㅽ뙣?덉뒿?덈떎."),
    workspaceServicesChecking: pick(
      locale,
      "Checking whether this web deployment can open the patient workspace.",
      "이 웹 배포본에서 환자 워크스페이스를 열 수 있는지 확인하는 중입니다."
    ),
    workspaceServicesUnavailableTitle: pick(
      locale,
      "Patient workspace is unavailable on this web deployment",
      "이 웹 배포본에서는 환자 워크스페이스를 열 수 없습니다"
    ),
    workspaceServicesUnavailableBody: pick(
      locale,
      "Google sign-in succeeded, but this site is only connected to the central control plane. Patient uploads, image review, and case authoring require a reachable data-plane backend or the desktop app.",
      "Google 로그인은 성공했지만, 현재 이 사이트는 중앙 control plane에만 연결되어 있습니다. 환자 업로드, 이미지 검토, 케이스 작성은 연결 가능한 data-plane backend 또는 데스크톱 앱이 필요합니다."
    ),
    workspaceServicesUnavailableHint: pick(
      locale,
      "If this deployment should host the full workspace, connect `/api/*` to a reachable backend before exposing the patient UI.",
      "이 배포본에서 전체 워크스페이스를 제공해야 한다면, 환자 UI를 열기 전에 `/api/*`가 실제 backend에 연결되어 있어야 합니다."
    ),
    desktopDownloadTitle: pick(locale, "Download the desktop app", "데스크톱 앱 다운로드"),
    desktopDownloadBody: pick(
      locale,
      "Use the Windows CPU installer when this web deployment is connected to the control plane only.",
      "이 웹 배포본이 control plane에만 연결되어 있을 때는 Windows CPU 설치본을 사용하세요.",
    ),
    desktopDownloadBusy: pick(locale, "Loading desktop release...", "데스크톱 설치본 정보를 불러오는 중입니다."),
    desktopDownloadButton: pick(locale, "Download CPU installer", "CPU 설치본 다운로드"),
    desktopDownloadPreparing: pick(locale, "Preparing download...", "다운로드 링크를 준비하는 중입니다."),
    desktopDownloadUnavailable: pick(
      locale,
      "No desktop installer is published for this environment yet.",
      "이 환경에는 아직 게시된 데스크톱 설치본이 없습니다.",
    ),
    desktopDownloadExternalHint: pick(
      locale,
      "The installer opens from an external OneDrive link. Keep the shared URL private.",
      "설치본은 외부 OneDrive 링크로 열립니다. 공유 URL은 외부로 퍼지지 않게 관리하세요.",
    ),
    desktopSelectedHospital: pick(locale, "Hospital for this download", "이 다운로드에 기록할 병원"),
    desktopVersionLabel: pick(locale, "Version", "버전"),
    desktopSizeLabel: pick(locale, "Size", "크기"),
    desktopShaLabel: pick(locale, "SHA256", "SHA256"),
    desktopFolderLink: pick(locale, "Open release folder", "배포 폴더 열기"),
    connecting: pick(locale, "Connecting...", "?곌껐 以?.."),
    submitting: pick(locale, "Submitting...", "?쒖텧 以?.."),
    heroEyebrow: pick(locale, "Clinical Research Workspace", "?꾩긽 ?곌뎄 ?뚰겕?ㅽ럹?댁뒪"),
    heroBody: pick(
      locale,
      "Sign in with your institution account, request the right hospital once, and move directly into a document-style case canvas after approval.",
      "湲곌? 怨꾩젙?쇰줈 濡쒓렇?명븯怨???踰덈쭔 蹂묒썝 ?묎렐???붿껌?섎㈃, ?뱀씤 ??臾몄꽌??耳?댁뒪 罹붾쾭?ㅻ줈 諛붾줈 ?대룞?????덉뒿?덈떎."
    ),
    signIn: pick(locale, "Sign In", "로그인"),
    enterWorkspace: pick(locale, "Enter the case workspace", "耳?댁뒪 ?뚰겕?ㅽ럹?댁뒪 ?낆옣"),
    signInBody: pick(
      locale,
      "Google is the default path for researchers. Admin and site admin accounts use password sign-in separately.",
      "연구자는 Google 로그인을 기본 경로로 사용하고, admin 및 site admin 계정은 비밀번호 로그인으로 별도 진입합니다."
    ),
    googleLogin: pick(locale, "Sign in with Google", "Google로 로그인"),
    googleDisabled: pick(
      locale,
      "Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or `NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID` is set.",
      "`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 또는 `NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID`가 설정되기 전까지 Google 로그인이 비활성화됩니다."
    ),
    adminRecoveryOnly: pick(locale, "Password sign-in for admin and site admin", "admin 및 site admin 비밀번호 로그인"),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "鍮꾨?踰덊샇"),
    enterAdminRecovery: pick(locale, "Open operator sign-in", "운영 계정 로그인 열기"),
    approvalRequired: pick(locale, "Approval Required", "?뱀씤 ?꾩슂"),
    institutionAccessRequest: pick(locale, "Institution access request", "湲곌? ?묎렐 ?붿껌"),
    signedInAs: (name: string, username: string) =>
      pick(locale, `Signed in as ${name} (${username})`, `${name} (${username}) 怨꾩젙?쇰줈 濡쒓렇?몃맖`),
    currentStatus: pick(locale, "Current Status", "?꾩옱 ?곹깭"),
    approvedBody: pick(
      locale,
      "Approved accounts receive hospital access and enter the clinician console automatically.",
      "?뱀씤??怨꾩젙? 蹂묒썝 ?묎렐 沅뚰븳??諛쏄퀬 諛붾줈 ?꾩긽 肄섏넄???ㅼ뼱媛묐땲??"
    ),
    noInstitutionRequest: pick(locale, "No institution request submitted yet.", "?꾩쭅 湲곌? ?묎렐 ?붿껌???쒖텧?섏? ?딆븯?듬땲??"),
    reviewerLabel: pick(locale, "Reviewer", "寃?좎옄"),
    requestAccess: pick(locale, "Request Access", "?묎렐 ?붿껌"),
    chooseInstitutionRole: pick(locale, "Choose your institution and role", "湲곌?怨???븷 ?좏깮"),
    officialInstitutionSearch: pick(locale, "Official institution search (HIRA)", "공식 기관 검색 (HIRA)"),
    officialInstitutionHint: pick(
      locale,
      "Search the synced Korean ophthalmology directory first. Existing K-ERA institutions remain available below as a fallback.",
      "동기화된 국내 안과 기관 목록을 먼저 검색하세요. 기존 K-ERA 기관 선택은 아래에서 대체 경로로 계속 사용할 수 있습니다."
    ),
    officialInstitutionSearching: pick(locale, "Searching institutions...", "기관 검색 중..."),
    officialInstitutionEmpty: pick(locale, "No synced institution matched this search yet.", "동기화된 기관 목록에서 일치하는 결과가 없습니다."),
    selectedInstitution: pick(locale, "Selected institution", "선택한 기관"),
    existingInstitutionFallback: pick(locale, "Existing K-ERA institution", "기존 K-ERA 기관"),
    existingInstitutionEmpty: pick(locale, "No existing K-ERA institution matched this search.", "기존 K-ERA 기관에서도 일치하는 결과가 없습니다."),
    hospital: pick(locale, "Hospital", "蹂묒썝"),
    requestedRole: pick(locale, "Requested role", "?붿껌 ??븷"),
    requestedRoleHelp: pick(
      locale,
      "Research access requests are fixed to researcher. Admin and site admin accounts are issued separately with passwords.",
      "일반 접근 요청은 researcher로 고정됩니다. admin과 site admin 계정은 비밀번호 기반으로 별도 발급합니다."
    ),
    noteForReviewer: pick(locale, "Note for reviewer", "寃?좎옄 硫붾え"),
    requestPlaceholder: pick(
      locale,
      "Department, study role, or context for this request.",
      "?뚯냽 遺?? ?곌뎄 ??븷, ?붿껌 諛곌꼍???곸뼱二쇱꽭??"
    ),
    submitInstitutionRequest: pick(locale, "Submit institution request", "湲곌? ?묎렐 ?붿껌 ?쒖텧"),
    logOut: pick(locale, "Log Out", "濡쒓렇?꾩썐"),
    highlightGoogleTitle: pick(locale, "Google Sign-In", "Google 로그인"),
    highlightGoogleBody: pick(
      locale,
      "Researchers can onboard with an institution-linked Google account.",
      "?곌뎄?먮뒗 湲곌????곌껐??Google 怨꾩젙?쇰줈 ?⑤낫?⑺븷 ???덉뒿?덈떎."
    ),
    highlightApprovalTitle: pick(locale, "Approval Queue", "승인 대기"),
    highlightApprovalBody: pick(
      locale,
      "Admins review institution and role requests before hospital access opens.",
      "愿由ъ옄媛 湲곌?怨???븷 ?붿껌??寃?좏븳 ??蹂묒썝 ?묎렐???대┰?덈떎."
    ),
    highlightCanvasTitle: pick(locale, "Case Authoring", "利앸? ?묒꽦"),
    highlightCanvasBody: pick(
      locale,
      "Create, validate, and contribute cases from one workspace.",
      "?섎굹???묒뾽怨듦컙?먯꽌 利앸? ?묒꽦, 寃利? 湲곗뿬瑜?泥섎━?⑸땲??"
    ),
    highlightRecoveryTitle: pick(locale, "Operator Sign-In", "운영 계정 로그인"),
    highlightRecoveryBody: pick(
      locale,
      "Local password sign-in remains available for admin and site admin accounts.",
      "admin 및 site admin 계정은 로컬 비밀번호 로그인 경로를 계속 사용합니다."
    ),
    landingBadge: pick(locale, "Corneal Research Network", "媛먯뿼??媛곷쭑???곌뎄 ?ㅽ듃?뚰겕"),
    landingScene: pick(
      locale,
      "After clinic ends, the image is still asking for one more look.",
      "?몃옒媛 ?앸궃 ?ㅼ뿉?? ?대?吏????踰????ㅼ뿬?ㅻ킄 ?щ씪怨?留먰빀?덈떎."
    ),
    landingTitle: pick(locale, "A softer entrance into the research workspace.", "議곌툑 ??媛먯꽦?곸씤 ?곌뎄 ?뚰겕?ㅽ럹?댁뒪???낃뎄"),
    landingBody: pick(
      locale,
      "Upload case images, review model evidence, and contribute cleaned cases from a single workspace that feels less like an admin gate and more like a quiet place to study.",
      "利앸? ?대?吏瑜??щ━怨? 紐⑤뜽 洹쇨굅瑜?寃?좏븯怨? ?뺣━??耳?댁뒪瑜?湲곗뿬?섎뒗 ?먮쫫???섎굹???붾㈃???댁븯?듬땲?? 愿由?肄섏넄???낃뎄蹂대떎, 李⑤텇?섍쾶 ?곌뎄瑜??쒖옉?섎뒗 ?μ냼??媛源앷쾶 援ъ꽦?덉뒿?덈떎."
    ),
    landingPrimaryCta: pick(locale, "Start with Google", "Google濡??곌뎄 ?쒖옉?섍린"),
    landingSecondaryCta: pick(locale, "See how it flows", "?대뼸寃??댁뼱吏?붿? 蹂닿린"),
    landingCtaNote: pick(
      locale,
      "Google sign-in is the primary researcher path. Admin and site admin accounts sign in separately with passwords.",
      "Google 로그인이 연구자 기본 경로이며, admin 및 site admin 계정은 비밀번호로 별도 로그인합니다."
    ),
    landingAuthEyebrow: pick(locale, "Research access", "?곌뎄 ?묎렐"),
    landingAuthTitle: pick(locale, "Move into the workspace with your institution account", "기관 계정으로 워크스페이스에 들어가기"),
    landingAuthBody: pick(
      locale,
      "The custom call-to-action leads here. The official Google button remains visible for a stable sign-in flow.",
      "?덉뼱濡?CTA?????곸뿭?쇰줈 ?곌껐?섍퀬, ?ㅼ젣 濡쒓렇?몄? ?덉젙?깆쓣 ?꾪빐 怨듭떇 Google 踰꾪듉?쇰줈 ?댁뼱吏묐땲??"
    ),
    landingAuthHint: pick(locale, "Use a hospital or institution-linked Google account.", "蹂묒썝 ?먮뒗 ?곌뎄湲곌????곌껐??Google 怨꾩젙???ъ슜?섏꽭??"),
    landingStoryEyebrow: pick(locale, "Why this tone", "??遺꾩쐞湲곌? ?꾩슂???댁쑀"),
    landingStoryTitle: pick(locale, "Research usually starts after the formal work is over.", "?곌뎄???媛?怨듭떇 ?낅Т媛 ?앸궃 ?ㅼ뿉 ?쒖옉?⑸땲??"),
    landingStoryBody: pick(
      locale,
      "Keratitis cases often need a second pass: a cleaner crop, a calmer review, a better note, and a decision about whether the case is solid enough to contribute.",
      "媛먯뿼??媛곷쭑??利앸????媛???踰덉㎏ 寃?좉? ?꾩슂?⑸땲?? ???뺣룉??crop, ??李⑤텇???먮룆, ???섏? 硫붾え, 洹몃━怨??ㅼ젣濡?湲곗뿬??留뚰겮 異⑸텇???⑤떒??利앸??몄???????먮떒???ㅻ뵲由낅땲??"
    ),
    landingStoryQuote: pick(
      locale,
      "Not every useful research tool needs to feel like a control room. Sometimes it should feel like a desk lamp, a document, and one more careful question.",
      "?좎슜???곌뎄 ?꾧뎄媛 ??긽 愿?쒖떎泥섎읆 ?먭뺨吏??꾩슂???놁뒿?덈떎. ?뚮줈???ㅽ깲??議곕챸 ?꾨옒??臾몄꽌?, ??踰???議곗떖?ㅻ읇寃??섏???吏덈Ц??媛源뚯썙???⑸땲??"
    ),
    landingWorkflowEyebrow: pick(locale, "Workflow", "워크플로"),
    landingWorkflowTitle: pick(locale, "One path from raw image to reusable case.", "?먮낯 ?대?吏?먯꽌 ?ㅼ떆 ?????덈뒗 利앸?源뚯?, ??以꾩쓽 ?먮쫫?쇰줈"),
    landingWorkflowBody: pick(
      locale,
      "The pre-login page should already explain the rhythm of the product: collect, review, and contribute under the same institutional context.",
      "濡쒓렇?????붾㈃?먯꽌???쒗뭹??由щ벉??蹂댁뿬???⑸땲?? 媛숈? 湲곌? 留λ씫 ?덉뿉???섏쭛?섍퀬, 寃?좏븯怨? 湲곗뿬?섎뒗 ?먮쫫??諛붾줈 ?쏀????⑸땲??"
    ),
    landingTrustEyebrow: pick(locale, "Research guardrails", "연구 가드레일"),
    landingTrustTitle: pick(locale, "Built to stay careful, not just fast.", "鍮좊Ⅴ湲곕쭔 ???꾧뎄媛 ?꾨땲?? 議곗떖?ㅻ읇寃??⑤뒗 ?꾧뎄"),
    landingTrustBody: pick(
      locale,
      "Institution approval, case-level review, and contribution history still anchor the system even when the surface feels warmer.",
      "?쒕㈃??遺꾩쐞湲곌? 議곌툑 ??遺?쒕윭?뚯졇?? 湲곌? ?뱀씤怨?耳?댁뒪 ?⑥쐞 寃?? 湲곗뿬 ?대젰?대씪???듭떖 洹쒖쑉? 洹몃?濡??좎??⑸땲??"
    ),
    landingFinalTitle: pick(locale, "When you are ready, start with the same account your team already trusts.", "以鍮꾧? ?섎㈃, ????대? ?좊ː?섎뒗 媛숈? 怨꾩젙?쇰줈 ?쒖옉?섎㈃ ?⑸땲??"),
    landingFinalBody: pick(
      locale,
      "Google sign-in opens the same approval flow as before. Only the first impression changes.",
      "Google 濡쒓렇???댄썑???뱀씤 ?먮쫫? 湲곗〈怨?媛숈뒿?덈떎. 諛붾뚮뒗 寃껋? 泥レ씤?곷퓧?낅땲??"
    ),
    landingFinalCta: pick(locale, "Open Google sign-in", "Google 濡쒓렇???닿린"),
  };
  const landing = {
    navStory: pick(locale, "Origin", "시작 이야기"),
    navAbout: pick(locale, "What It Is", "K-ERA?"),
    navFeatures: pick(locale, "Features", "湲곕뒫"),
    navPrivacy: pick(locale, "Privacy", "蹂댁븞"),
    navJoin: pick(locale, "Join", "李몄뿬"),
    navFaq: pick(locale, "FAQ", "FAQ"),
    heroBadge: pick(locale, "Infectious Keratitis AI Research Platform", "감염성 각막염 AI 연구 플랫폼"),
    heroScene: pick(
      locale,
      "After clinic, the room turns quiet. A few corneal images are still open on the screen.",
      "?몃옒媛 ?앸궃 ?? 議곗슜?댁쭊 吏꾨즺?? 媛곷쭑 ?ъ쭊 紐??μ씠 ?붾㈃?????덉뒿?덈떎."
    ),
    heroLineOne: pick(locale, "Is this bacterial,", "\"?닿굔 ?멸퇏?깆씪源?"),
    heroLineTwo: pick(locale, "or fungal...", "아니면 진균성일까..."),
    heroEmphasis: pick(locale, "A moment to ask AI", "AI?먭쾶 臾쇱뼱蹂대뒗 ?쒓컙"),
    heroBody: pick(
      locale,
      "No Python setup, no Excel manifest, no manual annotation marathon. Upload today's images and let K-ERA think with you.",
      "?뚯씠?щ룄, ?묒? manifest?? ?섎룞 annotation???꾩슂 ?놁뒿?덈떎. ?ㅻ뒛 李띿? ?ъ쭊???щ━硫? K-ERA媛 ?④퍡 怨좊??⑸땲??"
    ),
    heroPrimary: pick(locale, "Start Research with Google", "Google濡??곌뎄 ?쒖옉?섍린"),
    heroSecondary: pick(locale, "How does it work?", "어떻게 작동하나요?"),
    heroScroll: pick(locale, "scroll", "scroll"),
    accessEyebrow: pick(locale, "Research Access", "?곌뎄 李몄뿬"),
    accessTitle: pick(locale, "Continue with your institution Google account", "湲곌? Google 怨꾩젙?쇰줈 諛붾줈 ?쒖옉?섍린"),
    accessBody: pick(
      locale,
      "Researchers use Google as the main path. The official Google button stays here for researcher sign-in, while admin and site admin accounts use password sign-in separately.",
      "연구자는 Google 로그인을 기본 경로로 사용합니다. 아래의 공식 Google 버튼은 researcher 로그인에 사용하고, admin 및 site admin 계정은 비밀번호 로그인으로 별도 진입합니다."
    ),
    accessGoogleHint: pick(locale, "Use a hospital or institution-linked Google account.", "蹂묒썝 ?먮뒗 ?곌뎄湲곌????곌껐??Google 怨꾩젙???ъ슜?섏꽭??"),
    accessRecruiting: pick(locale, "Hospitals can request onboarding separately.", "蹂묒썝 ?⑥쐞 李몄뿬??蹂꾨룄 臾몄쓽濡??쒖옉?⑸땲??"),
    accessMailCta: pick(locale, "Apply as a hospital", "蹂묒썝 李몄뿬 ?좎껌?섍린"),
    originLabel: pick(locale, "AI research was too punishing to do alone", "혼자 하기엔 너무 가혹했던 AI 연구"),
    originTitle: pick(locale, "It was a harsher process than it should have been.", "필요 이상으로 거친 과정이었습니다."),
    originStory: pick(
      locale,
      "When we first tried to start AI research, the hardest part was not the deep learning model.\n\nIt was the Python environment, the image cleanup, and drawing ROI boxes one by one until the work itself began to ask a harder question.\n\n\"Is this really a study I can do on my own?\"\n\nThen came the emptiness of spending months on a model that failed on another hospital's data.\n\nAnd above all, the reality that privacy could keep all that effort from reaching actual care.",
      "泥섏쓬 AI ?곌뎄瑜??쒖옉???? 媛???섎뱺 嫄??λ윭??紐⑤뜽???꾨땲?덉뒿?덈떎.\n\n?뚯씠???섍꼍??留욎텛怨? ?대?吏瑜??뺣━?섍퀬, ROI瑜??섎굹?섎굹 洹몃━??蹂대㈃ ?대뒓 ?쒓컙 ?대젃寃??앷컖?섍쾶 ?⑸땲??\n\n\"?닿구 ?뺣쭚 ?닿? ?????덈뒗 ?곌뎄?쇨퉴?\"\n\n紐??ъ쓣 ?잛븘遺??留뚮뱺 紐⑤뜽???ㅻⅨ 蹂묒썝?먯꽌???뺥렪?녿뒗 ?깆쟻??蹂댁씪 ?뚯쓽 ?덊깉??\n\n洹몃━怨?臾댁뾿蹂대떎, ?꾨씪?대쾭??臾몄젣濡?洹?紐⑤뱺 ?몃젰??寃곗떎???ㅼ젣 吏꾨즺?먯꽌 ?????녿떎??寃?"
    ),
    originSignature: pick(locale, "K-ERA developer note, Department of Ophthalmology", "K-ERA 媛쒕컻???명듃, ?쒖＜??숆탳蹂묒썝 ?덇낵"),
    aboutLabel: pick(locale, "What is K-ERA", "K-ERA?"),
    aboutTitleLead: pick(locale, "Turn AI research from", "AI 연구를"),
    aboutTitleAccent: pick(locale, '"coding"', '"코딩"이 아니라'),
    aboutTitleTail: pick(locale, "into a clinical workflow", "임상 워크플로로"),
    aboutBodyOne: pick(
      locale,
      "K-ERA is a research platform designed so clinicians can train, validate, and share keratitis AI without writing code. With a Google account, image upload and AI analysis stay inside one browser workflow.",
      "K-ERA???꾩긽 ?덇낵?섏궗媛 肄붾뱶 ?놁씠 媛곷쭑??AI瑜??숈뒿, 寃利? 怨듭쑀?????덈룄濡??ㅺ퀎???곌뎄 ?뚮옯?쇱엯?덈떎. Google 怨꾩젙?쇰줈 濡쒓렇?명븯硫??ъ쭊 ?낅줈?쒕???AI 遺꾩꽍源뚯? ??釉뚮씪?곗? ?섎굹濡?泥섎━?⑸땲??"
    ),
    aboutBodyTwo: pick(
      locale,
      "The moment you register today's patient, the case starts becoming research data. As more hospitals join, the model learns from wider clinical environments while raw data never leaves the institution.",
      "?ㅻ뒛 吏꾨즺???섏옄瑜??깅줉?섎뒗 ?쒓컙, 洹?耳?댁뒪媛 ?곌뎄 ?곗씠?곌? ?⑸땲?? 李몄뿬 蹂묒썝???섏뼱?좎닔濡?AI?????ㅼ뼇???꾩긽 ?섍꼍???숈뒿?섍퀬, ?먮낯 ?곗씠?곕뒗 蹂묒썝 諛뽰쑝濡??덈? ?섍?吏 ?딆뒿?덈떎."
    ),
    featuresLabel: pick(locale, "Core features", "?듭떖 湲곕뒫"),
    featuresTitle: pick(locale, "Hours of manual work, reduced to a few guided clicks.", "수시간의 수작업을 몇 번의 안내된 클릭으로 줄입니다."),
    featuresDesc: pick(
      locale,
      "K-ERA takes the repetitive and mechanical parts so the clinician can stay focused on interpretation.",
      "諛섎났?곸씠怨?湲곌퀎?곸씤 ?묒뾽? K-ERA媛 泥섎━?⑸땲?? ?꾩긽?섎뒗 ?먮떒?먮쭔 吏묒쨷?섎㈃ ?⑸땲??"
    ),
    federatedLabel: pick(locale, "Data privacy", "데이터 프라이버시"),
    federatedTitle: pick(locale, "Keep data inside the hospital. Share the model's learning outside it.", "?곗씠?곕뒗 蹂묒썝 ?덉뿉. 吏?앹? 紐⑤몢? ?④퍡."),
    federatedBodyOne: pick(
      locale,
      "The biggest barrier in multi-center AI research was always the same: hospitals cannot simply export data. K-ERA uses a different route.",
      "湲곗〈 ?ㅺ린愿 AI ?곌뎄??媛????踰쎌? ?곗씠???먯껜瑜?爰쇰궪 ???녿떎???먯씠?덉뒿?덈떎. K-ERA???ㅻⅨ 諛⑸쾿???좏깮?덉뒿?덈떎."
    ),
    federatedBodyTwo: pick(
      locale,
      "Each hospital trains locally and shares only encrypted weight deltas with hashes. The original images, patient identifiers, and full-size crops remain inside the institution.",
      "媛?蹂묒썝???먯껜 ?섍꼍?먯꽌 紐⑤뜽???숈뒿?섍퀬, ?숈뒿 寃곌낵??weight delta留??댁떆? ?④퍡 ?뷀샇?뷀빐 ?꾩넚?⑸땲?? ?먮낯 ?대?吏, ?섏옄 ID, full-size crop? 蹂묒썝 ?대????⑥뒿?덈떎."
    ),
    dreamLabel: pick(locale, "The scene we want", "?곕━媛 洹몃━???λ㈃"),
    dreamTitle: pick(locale, "After clinic ends, with one cup of coffee.", "?몃옒媛 ?뺣━???? 而ㅽ뵾 ???붽낵 ?④퍡"),
    dreamBox: pick(
      locale,
      "You close the final chart of the day and sit back down.\nA few corneal images remain on the screen.\n\nWhite, fluorescein, slit.\nYou look at the visit as a whole.\nDraw one box, and MedSAM catches the lesion.\n\nA moment later, AI replies:\n\"This visit pattern matches fungal keratitis at 76%.\nWould you like to review similar cases?\"\n\nThe decision still belongs to the doctor.\nBut now, the doctor does not have to reason alone.\nAnd one careful case can make someone else's model a little stronger.",
      "?ㅻ뒛 留덉?留??섏옄??李⑦듃瑜??リ퀬, ?먮━???됱뒿?덈떎.\n而댄벂???붾㈃?먮뒗 媛곷쭑 ?ъ쭊 紐??μ씠 ???덉뒿?덈떎.\n\nWhite, Fluorescein, Slit.\n???μ쓽 ?ъ쭊???④퍡 遊낅땲??\n蹂묐???box瑜?洹몃━硫? MedSAM??ROI瑜??≪븘?낅땲??\n\n?좎떆 ?? AI媛 留먰빀?덈떎.\n\"??諛⑸Ц???⑦꽩? Fungal keratitis? 76% ?쇱튂?⑸땲??\n?좎궗??耳?댁뒪瑜??④퍡 蹂댁떆寃좎뼱??\"\n\n?먮떒? ?ъ쟾???섏궗媛 ?⑸땲??\n?ㅻ쭔 ?댁젣?? ?쇱옄 ?먮떒?섏? ?딆븘???⑸땲??\n洹몃━怨?洹?耳?댁뒪 ?섎굹媛 ?ㅻⅨ ?꾧뎔媛??AI瑜?議곌툑 ??媛뺥븯寃?留뚮벊?덈떎."
    ),
    dreamCta: pick(locale, "Join this scene", "???λ㈃???④퍡?섍린"),
    statsLabel: pick(locale, "So far", "吏湲덇퉴吏"),
    statsTitle: pick(locale, "Starting in Jeju, aiming for a national research network.", "제주에서 시작해 전국 연구 네트워크를 목표로 합니다."),
    collectiveLabel: pick(locale, "Participating hospitals", "참여 병원"),
    collectiveTitle: pick(locale, "An experiment in collective intelligence.", "吏묐떒 吏?깆쓣 誘우뼱蹂대뒗 ?ㅽ뿕"),
    collectiveBody: pick(
      locale,
      "Every case contributed by a clinician becomes both research material and real-world external validation. Even without coding or manuscript writing, participation itself becomes research.",
      "?쒓뎅???덇낵?섏궗?ㅼ씠 媛곸옄??耳?댁뒪瑜?湲곗뿬???뚮쭏?? 洹멸쾬? ?숈떆???ㅼ젣 ?꾩긽 ?섍꼍?먯꽌??external validation???⑸땲?? ?쇰Ц???곗? ?딆븘?? 肄붾뵫??紐곕씪?? 李몄뿬 ?먯껜媛 ?곌뎄?낅땲??"
    ),
    collectiveUserCta: pick(locale, "Sign in and start", "濡쒓렇?명븯怨??쒖옉?섍린"),
    collectiveHospitalNote: pick(locale, "Any clinician can start with one Google account.", "?꾩긽 ?덇낵?섏궗?쇰㈃ ?꾧뎄?? Google 怨꾩젙 1媛쒕줈 ?쒖옉"),
    faqLabel: pick(locale, "FAQ", "?먯＜ 臾삳뒗 吏덈Ц"),
    faqTitle: pick(locale, "Questions you may already have.", "沅곴툑???먯씠 ?덉쑝?좉???"),
    finalTitleLead: pick(locale, "Research does not have to begin as a giant project.", "?곌뎄??嫄곕????꾨줈?앺듃媛 ?꾨떃?덈떎"),
    finalBodyOne: pick(locale, "A single case from today's clinic can be enough.", "?ㅻ뒛 吏꾨즺????耳?댁뒪, 洹??ъ쭊 紐??μ씠硫?異⑸텇?⑸땲??"),
    finalBodyTwo: pick(
      locale,
      "After clinic, with a cup of coffee, ask AI what it thinks. K-ERA begins with that question.",
      "?몃옒媛 ?앸궃 ?? 而ㅽ뵾 ???붿쓣 ?ㅺ퀬 AI?먭쾶 臾쇱뼱蹂댁꽭?? \"?덈뒗 ?대뼸寃??앷컖??\" K-ERA??洹?吏덈Ц?먯꽌 ?쒖옉?⑸땲??"
    ),
    finalCta: pick(locale, "Open Google sign-in", "Google 濡쒓렇???닿린"),
    finalNote: pick(locale, "One careful case is where the network starts.", "한 케이스로 시작하고, 여러 병원이 검증합니다."),
    footerCopyright: pick(
      locale,
      "짤 2026 K-ERA Project 쨌 TinyStar Labs",
      "짤 2026 K-ERA Project 쨌 TinyStar Labs"
    ),
    footerPrivacy: pick(locale, "Privacy Policy", "媛쒖씤?뺣낫泥섎━諛⑹묠"),
    footerTerms: pick(locale, "Terms", "?댁슜?쎄?"),
    footerContact: pick(locale, "Contact", "臾몄쓽"),
    viewLabelWhite: pick(locale, "White", "White"),
    viewLabelFluorescein: pick(locale, "Fluorescein", "Fluorescein"),
    viewLabelSlit: pick(locale, "Slit", "Slit"),
    viewVisitChip: pick(locale, "Sample Visit", "Sample Visit"),
    viewVisitArrow: pick(locale, "Visit-level integrated review", "Visit ?⑥쐞 醫낇빀 ?먮룆"),
    viewVisitResult: pick(locale, "Fungal Keratitis 쨌 76% probability", "Fungal Keratitis 쨌 76% ?뺣쪧"),
    viewVisitSub: pick(locale, "MedSAM ROI extraction 쨌 Ensemble model", "MedSAM ROI ?먮룞 異붿텧 쨌 Ensemble 紐⑤뜽"),
    fedTopLabel: pick(locale, "Central Control Plane", "以묒븰 Control Plane"),
    fedTopTitle: pick(locale, "Model versioning 쨌 FedAvg aggregation", "紐⑤뜽 踰꾩쟾 愿由?쨌 FedAvg 吏묎퀎"),
    fedMid: pick(locale, "Only encrypted weight deltas move upward. Raw data never does.", "Weight Delta留??뷀샇???꾩넚 쨌 ?먮낯 ?곗씠?곕뒗 ?대룞?섏? ?딆뒿?덈떎."),
    fedBottom: pick(locale, "Raw images, patient IDs, and full-size crops never leave the hospital.", "?먮낯 ?대?吏 쨌 ?섏옄 ID 쨌 full-size crop? 蹂묒썝 諛뽰쑝濡??섍?吏 ?딆뒿?덈떎."),
  };
  const landingPainPoints = [
    {
      icon: "python",
      title: pick(locale, "Everything started with environment setup again.", "모든 일은 또다시 환경 설정부터 시작됐습니다."),
      body: pick(
        locale,
        "Anaconda, conflicting libraries, terminal errors. Too many clinicians stop before the study itself begins.",
        "Anaconda, ?쇱씠釉뚮윭由?異⑸룎, ?곕????먮윭. ??怨쇱젙?먯꽌 ?ш린?섎뒗 ?꾩긽?섍? ?덈Т 留롮뒿?덈떎."
      ),
    },
    {
      icon: "roi",
      title: pick(locale, "Thousands of images, all manually annotated.", "?대?吏 ?섏쿇 ?? ?섎룞 annotation"),
      body: pick(
        locale,
        "Drawing lesion ROI one image at a time turns a few hundred cases into hundreds of hours.",
        "留덉슦?ㅻ줈 蹂묐? ROI瑜??섎굹??洹몃━???묒뾽? ?섎갚 ?λ쭔 ?섏뼱???섎갚 ?쒓컙?쇰줈 遺덉뼱?⑸땲??"
      ),
    },
    {
      icon: "single",
      title: pick(locale, "Single-center data hits a hard wall.", "단일 기관 데이터는 분명한 한계에 부딪힙니다."),
      body: pick(
        locale,
        "If data cannot leave the hospital, external validation becomes the hardest part of proving the model.",
        "?곗씠?곕? 蹂묒썝 諛뽰쑝濡?爰쇰궪 ???녾린 ?뚮Ц?? ?섎뱾寃?留뚮뱺 AI??external validation??諛쏄린 ?대졄?듬땲??"
      ),
    },
    {
      icon: "privacy",
      title: pick(locale, "Too many models end as papers only.", "?쇰Ц留??곌퀬 ?곗? 紐삵븯??AI"),
      body: pick(
        locale,
        "Research stays disconnected from care when privacy and deployment are treated as afterthoughts.",
        "?ㅼ젣 吏꾨즺?먯꽌 ?쒖슜?섏? 紐삵븯???곌뎄, ?곌뎄? ?꾩긽 ?ъ씠??媛꾧레??怨꾩냽 ?⑥뒿?덈떎."
      ),
    },
  ];
  const landingFeatureCards = [
    {
      number: "01",
      eyebrow: pick(locale, "Meta AI MedSAM 쨌 2024", "Meta AI MedSAM 쨌 2024"),
      title: pick(locale, "Semi-automatic lesion segmentation with MedSAM", "MedSAM 湲곕컲 諛섏옄??蹂묐? 遺꾪븷"),
      body: pick(
        locale,
        "Upload an image and draw a loose box around the lesion. MedSAM creates a precise ROI mask in seconds, and Grad-CAM helps reveal why the model is attending there.",
        "?대?吏瑜??щ━怨?蹂묐? 二쇰???box留?洹몃━硫? MedSAM???뺣???ROI segmentation???먮룞 ?앹꽦?⑸땲?? Grad-CAM?쇰줈 AI???먮떒 洹쇨굅???④퍡 ?뺤씤?????덉뒿?덈떎."
      ),
    },
    {
      number: "02",
      eyebrow: pick(locale, "Visit-level ensemble", "Visit-level Ensemble"),
      title: pick(locale, "Integrated review across White, Fluorescein, and Slit views", "Visit ?⑥쐞 硫?곕え??醫낇빀 ?먮룆"),
      body: pick(
        locale,
        "Instead of trusting a single photo, K-ERA reads the visit as a unit. Multiple views and ensemble logic reduce sensitivity to one noisy capture.",
        "?ㅼ젣 吏꾨즺泥섎읆 White, Fluorescein, Slit ??媛吏 view瑜??④퍡 遊낅땲?? ??諛⑸Ц???대?吏瑜??듯빀???먮떒?섎?濡??ъ쭊 ???μ쓽 ?≪쓬?????붾뱾由쎈땲??"
      ),
    },
    {
      number: "03",
      eyebrow: pick(locale, "Privacy-preserving", "Privacy-preserving"),
      title: pick(locale, "Federated learning for multi-center collaboration", "Federated Learning ?ㅺ린愿 ?묐젰"),
      body: pick(
        locale,
        "Each hospital trains locally and shares only model deltas. Aggregated models return to all participants without exporting raw clinical images.",
        "媛?蹂묒썝???먯껜 ?섍꼍?먯꽌 ?숈뒿 ??weight delta留??꾨떖?⑸땲?? FedAvg濡?吏묎퀎??紐⑤뜽? 李몄뿬 蹂묒썝 紐⑤몢??諛고룷?섍퀬, ?먮낯 ?대?吏??蹂묒썝 諛뽰쑝濡??섍?吏 ?딆뒿?덈떎."
      ),
    },
  ];
  const landingFederatedPoints = [
    {
      title: pick(locale, "What reaches the center", "중앙으로 올라오는 것"),
      body: pick(
        locale,
        "Encrypted weight deltas and only lightweight review assets when policy allows them.",
        "?뷀샇?붾맂 weight delta?, ?뺤콉???덉슜??寃쎌슦???쒗빐 媛踰쇱슫 寃?좎슜 ?먯궛留??꾨떖?⑸땲??"
      ),
    },
    {
      title: pick(locale, "What stays inside the hospital", "병원 안에 남는 것"),
      body: pick(
        locale,
        "Original images, patient identifiers, full-size crops, and detailed clinical records.",
        "?먮낯 ?대?吏, ?섏옄 ID, full-size crop, ?곸꽭 ?꾩긽 湲곕줉."
      ),
    },
    {
      title: pick(locale, "What happens as more hospitals join", "병원이 더 참여할수록 생기는 일"),
      body: pick(
        locale,
        "New sites naturally become broader external validation environments for the shared model.",
        "?덈줈??蹂묒썝???⑸쪟 ?먯껜媛 ???볦? external validation ?섍꼍?쇰줈 ?댁뼱吏묐땲??"
      ),
    },
  ];
  const landingStats = [
    {
      value: "101",
      label: pick(locale, "Founding single-center patients", "단일기관 시작 코호트 환자 수"),
    },
    {
      value: "258",
      label: pick(locale, "Culture-confirmed visits", "Culture-confirmed 방문 수"),
    },
    {
      value: "658",
      label: pick(locale, "White-light benchmark images", "White-light benchmark 이미지 수"),
    },
    {
      value: "0.677",
      label: pick(locale, "Best visit-level AUROC", "Best visit-level AUROC"),
    },
  ];
  const landingFaqItems = [
    {
      question: pick(locale, "Does K-ERA write the AI model for me?", "K-ERA??AI 紐⑤뜽?????留뚮뱾??二쇰굹??"),
      answer: pick(
        locale,
        "No. K-ERA automates repetitive steps such as case registration, lesion segmentation, and training execution, but clinical judgment still belongs to the researcher.",
        "?꾨땲?? K-ERA???먯튃? ?泥닿? ?꾨땲??蹂댁“?낅땲?? 耳?댁뒪 ?깅줉, 蹂묐? 遺꾪븷, ?숈뒿 ?ㅽ뻾 媛숈? 諛섎났 ?묒뾽???먮룞?뷀븯吏留??먮떒? ?몄젣???꾩긽?섍? ?⑸땲??"
      ),
    },
    {
      question: pick(locale, "Can I use it without coding?", "肄붾뵫???꾪? 紐곕씪???????덈굹??"),
      answer: pick(
        locale,
        "Yes. Python setup, CSV manifests, and most repetitive preparation steps are hidden behind the web workflow and Google sign-in.",
        "臾쇰줎?낅땲?? Python ?ㅼ튂?? CSV ?묒꽦???꾩슂 ?놁뒿?덈떎. Google 怨꾩젙?쇰줈 濡쒓렇?명븳 ????UI?먯꽌 二쇱슂 湲곕뒫???ъ슜?????덈룄濡??ㅺ퀎?덉뒿?덈떎."
      ),
    },
    {
      question: pick(locale, "Does patient data leave the hospital?", "?섏옄 ?곗씠?곌? ?몃?濡??좎텧?섏? ?딅굹??"),
      answer: pick(
        locale,
        "Original images and patient identifiers remain inside the hospital. The federated path is designed around local training and lightweight model updates.",
        "?먮낯 ?대?吏? ?섏옄 ?뺣낫??蹂묒썝 ?대??먮쭔 議댁옱?⑸땲?? ?고빀?숈뒿 寃쎈줈??濡쒖뺄 ?숈뒿怨?寃쎈웾 紐⑤뜽 ?낅뜲?댄듃 ?꾩넚???꾩젣濡??ㅺ퀎?섏뼱 ?덉뒿?덈떎."
      ),
    },
    {
      question: pick(locale, "What do participating hospitals gain?", "李몄뿬?섎㈃ ?대뼡 ?댁젏???덈굹??"),
      answer: pick(
        locale,
        "Each contributed case becomes both research material and a wider validation environment, and participating sites benefit from the aggregated global model.",
        "李몄뿬 湲곌???耳?댁뒪???꾧뎅 洹쒕え AI??external validation ?곗씠?곌? ?섍퀬, 吏묎퀎??湲濡쒕쾶 紐⑤뜽???쒗깮???④퍡 怨듭쑀諛쏄쾶 ?⑸땲??"
      ),
    },
    {
      question: pick(locale, "Which architectures are currently supported?", "?대뼡 紐⑤뜽 ?꾪궎?띿쿂瑜?吏?먰븯?섏슂?"),
      answer: pick(
        locale,
        "Current initial training supports DenseNet121, ConvNeXt-Tiny, ViT-B/16, Swin-T, and EfficientNetV2-S with official pretrained backbones.",
        "?꾩옱 珥덇린 ?숈뒿? DenseNet121, ConvNeXt-Tiny, ViT-B/16, Swin-T, EfficientNetV2-S瑜?official pretrained backbone 湲곗??쇰줈 吏?먰빀?덈떎."
      ),
    },
    {
      question: pick(locale, "Does hospital IT need heavy infrastructure?", "蹂묒썝 IT ?명봽?쇨? 蹂듭옟?댁빞 ?섎굹??"),
      answer: pick(
        locale,
        "No. The local node is intended to run on a hospital-side workstation or server without requiring a large deployment footprint.",
        "?꾨떃?덈떎. Local Node??蹂묒썝 ?대? ?뚰겕?ㅽ뀒?댁뀡 ?먮뒗 ?쒕쾭 ????먯꽌???댁쁺?????덈룄濡??ㅺ퀎?섏뼱 ?덉뒿?덈떎."
      ),
    },
  ];
  const adminRecoveryLinkLabel = operatorUiEnabled
    ? pick(locale, "Open operator password sign-in", "운영 계정 비밀번호 로그인 열기")
    : "";
  const adminLaunchLinks = operatorUiEnabled
    ? [
        {
          label: pick(locale, "Admin training", "관리자 학습"),
          href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dtraining",
        },
        {
          label: pick(locale, "Admin cross-validation", "관리자 교차 검증"),
          href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dcross_validation",
        },
        {
          label: pick(locale, "Admin hospital validation", "관리자 병원 검증"),
          href: "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Ddashboard",
        },
      ]
    : [];
  function describeUnknownError(nextError: unknown, fallback: string): string {
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
  const describeError = useCallback(
    (nextError: unknown, fallback: string) => describeUnknownError(nextError, fallback),
    [locale],
  );
  const {
    approved,
    authBusy,
    bootstrapBusy,
    error,
    googleLaunchPulse,
    handleGoogleLaunch,
    handleLogout,
    handleRequestAccess,
    institutionSearchBusy,
    launchTarget,
    myRequests,
    publicInstitutions,
    publicSites,
    requestBusy,
    refreshApprovedSites,
    refreshSiteData,
    selectedSiteId,
    setSelectedSiteId,
    siteError,
    sites,
    summary,
    token,
    user,
    workspaceDataPlaneState,
  } = useHomeAuthBootstrap({
    copy: {
      failedConnect: copy.failedConnect,
      failedLoadSiteData: copy.failedLoadSiteData,
      googleDisabled: copy.googleDisabled,
      googleLoginFailed: copy.googleLoginFailed,
      googleNoCredential: copy.googleNoCredential,
      googlePreparing: copy.googlePreparing,
      requestSubmissionFailed: copy.requestSubmissionFailed,
      unableLoadInstitutions: copy.unableLoadInstitutions,
    },
    deferredInstitutionQuery,
    describeError,
    googleButtonRef,
    googleButtonWidth,
    googleReady,
    requestForm,
    setRequestForm,
  });
  const canOpenOperations = Boolean(operatorUiEnabled && approved && user && ["admin", "site_admin"].includes(user.role));
  const desktopWorkspaceRuntime = canUseDesktopTransport();
  const errorMessage = siteError ?? error;
  const hasAuthenticatedSession = Boolean(token || user);
  const effectiveToken = token ?? "";
  const optimisticApprovedBootstrap = Boolean(!token && user && approved && bootstrapBusy);
  const filteredExistingSites = publicSites.filter((site) =>
    matchesInstitutionSearch(institutionQuery, site.site_id, site.display_name, site.hospital_name),
  );
  const selectedExistingSite =
    publicSites.find((site) => site.site_id === requestForm.requested_site_id) ?? null;
  const visibleExistingSites =
    selectedExistingSite && !filteredExistingSites.some((site) => site.site_id === selectedExistingSite.site_id)
      ? [selectedExistingSite, ...filteredExistingSites]
      : filteredExistingSites;
  const approvedButUnassigned = Boolean(hasAuthenticatedSession && user && approved && sites.length === 0);
  const showAccessRequestScreen = Boolean(hasAuthenticatedSession && user && (!approved || accessRequestMode || approvedButUnassigned));
  const accessRequestEyebrow = approved
    ? pick(locale, approvedButUnassigned ? "Hospital setup" : "Hospital change", approvedButUnassigned ? "병원 연결" : "병원 변경")
    : copy.approvalRequired;
  const accessRequestTitle = approved
    ? pick(
        locale,
        approvedButUnassigned ? "Connect your hospital workspace" : "Request a hospital change",
        approvedButUnassigned ? "병원 워크스페이스 연결" : "병원 변경 요청",
      )
    : copy.institutionAccessRequest;
  const accessRequestDescription = approved
    ? pick(
        locale,
        approvedButUnassigned
          ? "Your account is approved, but no hospital is linked yet. Choose the hospital you need before entering the case workspace."
          : "Choose the hospital you want next. When this request is approved, your current hospital access will be replaced with the new one.",
        approvedButUnassigned
          ? "계정은 승인되었지만 아직 연결된 병원이 없습니다. 케이스 워크스페이스에 들어가기 전에 필요한 병원을 선택하세요."
          : "다음에 사용할 병원을 선택하세요. 이 요청이 승인되면 현재 병원 접근 권한은 새 병원으로 교체됩니다.",
      )
    : copy.signedInAs(user?.full_name ?? "", user?.username ?? "");
  const accessRequestStatusBody = approved
    ? pick(
        locale,
        approvedButUnassigned
          ? "Hospital access is required before case authoring, uploads, and review can open."
          : "Only one hospital can stay linked to this account. Approval switches the workspace to the newly assigned hospital.",
        approvedButUnassigned
          ? "병원 접근이 연결되기 전에는 케이스 작성, 업로드, 검토를 열 수 없습니다."
          : "이 계정에는 병원 1곳만 연결할 수 있습니다. 승인되면 워크스페이스가 새로 배정된 병원으로 전환됩니다.",
      )
    : copy.approvedBody;
  const primaryDesktopRelease = desktopReleases[0] ?? null;
  const selectedDownloadSite =
    (selectedSiteId ? sites.find((site) => site.site_id === selectedSiteId) : null) ?? sites[0] ?? null;
  const selectedDownloadSiteLabel = selectedDownloadSite ? getSiteDisplayName(selectedDownloadSite) : null;

  useEffect(() => {
    if (
      desktopWorkspaceRuntime ||
      workspaceDataPlaneState !== "unavailable" ||
      !user ||
      (!approved && user.role !== "admin" && user.role !== "site_admin")
    ) {
      setDesktopReleases([]);
      setDesktopReleaseBusy(false);
      setDesktopReleaseError(null);
      return;
    }
    let cancelled = false;
    setDesktopReleaseBusy(true);
    setDesktopReleaseError(null);
    void fetchDesktopReleases(token ?? undefined)
      .then((releases) => {
        if (cancelled) {
          return;
        }
        setDesktopReleases(releases);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setDesktopReleases([]);
        setDesktopReleaseError(describeError(nextError, copy.failedConnect));
      })
      .finally(() => {
        if (!cancelled) {
          setDesktopReleaseBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [approved, copy.failedConnect, describeError, desktopWorkspaceRuntime, token, user, workspaceDataPlaneState]);

  const handleDesktopInstallerDownload = useCallback(async () => {
    if (!primaryDesktopRelease) {
      return;
    }
    setDesktopDownloadBusy(true);
    setDesktopReleaseError(null);
    try {
      const claimed = await claimDesktopReleaseDownload(token ?? undefined, primaryDesktopRelease.release_id, {
        site_id: selectedSiteId ?? selectedDownloadSite?.site_id ?? null,
      });
      window.open(claimed.redirect_url, "_blank", "noopener,noreferrer");
    } catch (nextError) {
      setDesktopReleaseError(describeError(nextError, copy.failedConnect));
    } finally {
      setDesktopDownloadBusy(false);
    }
  }, [
    copy.failedConnect,
    describeError,
    primaryDesktopRelease,
    selectedDownloadSite?.site_id,
    selectedSiteId,
    token,
  ]);

  useEffect(() => {
    function syncGoogleButtonWidth() {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 560) {
        setGoogleButtonWidth(Math.max(220, viewportWidth - 92));
        return;
      }
      if (viewportWidth <= 980) {
        setGoogleButtonWidth(Math.min(360, viewportWidth - 140));
        return;
      }
      setGoogleButtonWidth(360);
    }

    syncGoogleButtonWidth();
    window.addEventListener("resize", syncGoogleButtonWidth);
    return () => {
      window.removeEventListener("resize", syncGoogleButtonWidth);
    };
  }, []);

  useEffect(() => {
    if (!approved || !canOpenOperations || !launchTarget || launchTarget.mode !== "operations") {
      return;
    }
    setOperationsSection(launchTarget.section);
    setWorkspaceMode("operations");
  }, [approved, canOpenOperations, launchTarget]);

  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);

  useEffect(() => {
    if (hasAuthenticatedSession && user && approved) {
      return;
    }
    workspaceHistoryReadyRef.current = false;
  }, [approved, hasAuthenticatedSession, user]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasAuthenticatedSession || !user || !approved) {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const historyEntry = readHomeHistoryEntry(event.state);
      if (historyEntry?.kind === "workspace") {
        workspaceHistoryReadyRef.current = true;
        return;
      }

      const nextWorkspaceEntry = buildHomeHistoryEntry("workspace", workspaceModeRef.current);
      workspaceHistoryReadyRef.current = true;
      writeHomeHistoryEntry(nextWorkspaceEntry, "push");
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [approved, hasAuthenticatedSession, user]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasAuthenticatedSession || !user || !approved) {
      return;
    }

    const guardEntry = buildHomeHistoryEntry("guard", workspaceMode);
    const workspaceEntry = buildHomeHistoryEntry("workspace", workspaceMode);
    const browserEntry = readHomeHistoryEntry(window.history.state);

    if (!workspaceHistoryReadyRef.current) {
      workspaceHistoryReadyRef.current = true;
      if (browserEntry?.kind === "guard") {
        if (!isSameHomeHistoryEntry(browserEntry, guardEntry)) {
          writeHomeHistoryEntry(guardEntry, "replace");
        }
        writeHomeHistoryEntry(workspaceEntry, "push");
        return;
      }
      if (browserEntry?.kind === "workspace") {
        if (!isSameHomeHistoryEntry(browserEntry, workspaceEntry)) {
          writeHomeHistoryEntry(workspaceEntry, "replace");
        }
        return;
      }
      writeHomeHistoryEntry(guardEntry, "replace");
      writeHomeHistoryEntry(workspaceEntry, "push");
      return;
    }

    if (browserEntry?.kind === "workspace" && !isSameHomeHistoryEntry(browserEntry, workspaceEntry)) {
      writeHomeHistoryEntry(workspaceEntry, "replace");
      return;
    }
    if (browserEntry?.kind === "guard" && !isSameHomeHistoryEntry(browserEntry, guardEntry)) {
      writeHomeHistoryEntry(guardEntry, "replace");
    }
  }, [approved, hasAuthenticatedSession, user, workspaceMode]);

  async function handleManifestDownload() {
    if (!hasAuthenticatedSession || !selectedSiteId) {
      return;
    }
    const blob = await downloadManifest(selectedSiteId, effectiveToken);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedSiteId}_dataset_manifest.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function handleWorkspaceLogout() {
    handleLogout();
    setAccessRequestMode(false);
    setWorkspaceMode("canvas");
    setOperationsSection("management");
  }

  const caseWorkspaceCrashCopy = {
    eyebrow: pick(locale, "Case Workspace Recovery", "케이스 워크스페이스 복구"),
    title: pick(locale, "The case workspace hit an unexpected error.", "케이스 워크스페이스에서 예기치 않은 오류가 발생했습니다."),
    description: pick(
      locale,
      "Retry this workspace view, reload the page, or sign out and reopen the session.",
      "이 화면을 다시 시도하거나 페이지를 새로고침하거나, 로그아웃 후 다시 열 수 있습니다."
    ),
    retryLabel: pick(locale, "Retry workspace", "워크스페이스 다시 시도"),
    reloadLabel: pick(locale, "Reload page", "페이지 새로고침"),
    exitLabel: copy.logOut,
    devDetailsLabel: pick(locale, "Developer details", "개발자 상세 정보"),
  };

  const adminWorkspaceCrashCopy = {
    eyebrow: pick(locale, "Operations Recovery", "운영 워크스페이스 복구"),
    title: pick(locale, "The operations workspace hit an unexpected error.", "운영 워크스페이스에서 예기치 않은 오류가 발생했습니다."),
    description: pick(
      locale,
      "Retry this operations view, reload the page, or sign out and reopen the session.",
      "이 운영 화면을 다시 시도하거나 페이지를 새로고침하거나, 로그아웃 후 다시 열 수 있습니다."
    ),
    retryLabel: pick(locale, "Retry operations", "운영 화면 다시 시도"),
    reloadLabel: pick(locale, "Reload page", "페이지 새로고침"),
    exitLabel: copy.logOut,
    devDetailsLabel: pick(locale, "Developer details", "개발자 상세 정보"),
  };

  const landingHospitalChips = [
    ...publicSites.slice(0, 5).map((site) => ({ label: getSiteDisplayName(site), active: true })),
    ...Array.from({ length: Math.max(0, 5 - publicSites.slice(0, 5).length) }, () => ({
      label: pick(locale, "Recruiting", "참여 모집 중"),
      active: false,
    })),
  ];

  if (hasAuthenticatedSession && !user) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_34%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <LocaleToggle />
        </div>
        <section className="mx-auto mt-6 grid w-full max-w-3xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {pick(locale, "Operator Session", "운영 세션")}
                </span>
              }
              title={pick(locale, "Opening your workspace", "워크스페이스를 여는 중입니다")}
              description={pick(
                locale,
                "Your session token was detected. Waiting for the workspace profile and permissions to load.",
                "세션 토큰을 확인했습니다. 워크스페이스 프로필과 권한 정보를 불러오는 중입니다."
              )}
            />
            {errorMessage ? (
              <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
                {errorMessage}
              </div>
            ) : null}
            <div className="rounded-[20px] border border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted">
              {bootstrapBusy
                ? pick(locale, "Loading authenticated workspace state...", "인증된 워크스페이스 상태를 불러오는 중입니다...")
                : pick(locale, "Preparing your authenticated session...", "인증 세션을 준비하는 중입니다...")}
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (!hasAuthenticatedSession || !user) {
    return (
      <LandingV4
        locale={locale}
        authBusy={authBusy}
        error={errorMessage}
        googleClientId={nativeDesktopGoogleAuth ? "" : GOOGLE_CLIENT_ID}
        googleButtonRef={googleButtonRef}
        googleLaunchPulse={googleLaunchPulse}
        onGoogleReady={() => setGoogleReady(true)}
        onGoogleLaunch={handleGoogleLaunch}
        connectingLabel={copy.connecting}
        googleLoginLabel={copy.googleLogin}
        googleDisabledLabel={copy.googleDisabled}
        adminRecoveryOnlyLabel={copy.adminRecoveryOnly}
        adminRecoveryLinkLabel={adminRecoveryLinkLabel}
        adminLaunchLinks={adminLaunchLinks}
        publicSites={publicSites}
      />
    );
  }

  if (showAccessRequestScreen) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_34%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <LocaleToggle />
        </div>
        <section className="mx-auto mt-6 grid w-full max-w-6xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {accessRequestEyebrow}
                </span>
              }
              title={accessRequestTitle}
              description={accessRequestDescription}
              aside={
                <div className="flex items-center gap-2">
                  {approved && accessRequestMode && sites.length > 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAccessRequestMode(false)}>
                      {pick(locale, "Back to workspace", "워크스페이스로 돌아가기")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="sm" onClick={handleWorkspaceLogout}>
                    {copy.logOut}
                  </Button>
                </div>
              }
            />

            {errorMessage ? (
              <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
                {errorMessage}
              </div>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card as="article" variant="panel" className="grid gap-5 p-5 sm:p-6">
                <SectionHeader
                  titleAs="h4"
                  title={copy.currentStatus}
                  description={approved ? accessRequestStatusBody : statusCopy(locale, user.approval_status)}
                  aside={
                    <span
                      className={cn(
                        "inline-flex min-h-9 items-center rounded-full border px-3 text-[0.78rem] font-semibold",
                        user.approval_status === "approved" &&
                          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        user.approval_status === "pending" &&
                          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        user.approval_status === "rejected" &&
                          "border-danger/25 bg-danger/10 text-danger",
                        user.approval_status === "application_required" &&
                          "border-border bg-white/55 text-muted dark:bg-white/4"
                      )}
                    >
                      {translateStatus(locale, user.approval_status)}
                    </span>
                  }
                />
                <p className="m-0 text-sm leading-6 text-muted">{accessRequestStatusBody}</p>
                {myRequests.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted">
                    {copy.noInstitutionRequest}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {myRequests.map((request) => (
                      <Card key={request.request_id} as="article" variant="nested" className="grid gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <strong className="text-sm font-semibold text-ink">{getRequestedSiteLabel(request)}</strong>
                          <span className="rounded-full border border-border bg-white/55 px-3 py-1 text-[0.76rem] font-medium text-muted dark:bg-white/4">
                            {translateStatus(locale, request.status)}
                          </span>
                        </div>
                        <p className="m-0 text-sm leading-6 text-muted">
                          {translateRole(locale, request.requested_role)}
                        </p>
                        {request.message ? <p className="m-0 text-sm leading-6 text-muted">{request.message}</p> : null}
                        {request.reviewer_notes ? (
                          <p className="m-0 text-sm leading-6 text-muted">
                            {copy.reviewerLabel}: {request.reviewer_notes}
                          </p>
                        ) : null}
                      </Card>
                    ))}
                  </div>
                )}
              </Card>

              <Card as="article" variant="panel" className="grid gap-5 p-5 sm:p-6">
                <SectionHeader
                  titleAs="h4"
                  title={copy.chooseInstitutionRole}
                  description={copy.requestAccess}
                />
                <form className="grid gap-4" onSubmit={handleRequestAccess}>
                  <Field as="div" label={copy.officialInstitutionSearch} hint={copy.officialInstitutionHint}>
                    <input
                      id="official_institution_search"
                      value={institutionQuery}
                      onChange={(event) => setInstitutionQuery(event.target.value)}
                      placeholder="Seoul, Asan, Kim's Eye..."
                    />
                  </Field>
                  {deferredInstitutionQuery.trim().length >= 2 ? (
                    institutionSearchBusy ? (
                      <div className="rounded-[18px] border border-border/80 bg-surface-muted/80 px-4 py-3 text-sm text-muted">
                        {copy.officialInstitutionSearching}
                      </div>
                    ) : publicInstitutions.length > 0 ? (
                      <div className="grid gap-2">
                        {publicInstitutions.map((institution) => (
                          <button
                            key={institution.institution_id}
                            type="button"
                            className={cn(
                              "rounded-[18px] border px-4 py-3 text-left transition duration-150 ease-out hover:-translate-y-0.5",
                              requestForm.requested_site_id === institution.institution_id
                                ? "border-brand/35 bg-brand-soft/70"
                                : "border-border/80 bg-surface-muted/80",
                            )}
                            onClick={() =>
                              setRequestForm((current) => ({
                                ...current,
                                requested_site_id: institution.institution_id,
                                requested_site_label: institution.name,
                              }))
                            }
                          >
                            <div className="text-sm font-semibold text-ink">{institution.name}</div>
                            <div className="text-xs text-muted">
                              {[institution.institution_type_name, institution.address].filter(Boolean).join(" / ")}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-border/80 bg-surface-muted/80 px-4 py-3 text-sm text-muted">
                        {copy.officialInstitutionEmpty}
                      </div>
                    )
                  ) : null}
                  {requestForm.requested_site_label ? (
                    <div className="rounded-[18px] border border-brand/20 bg-brand-soft/60 px-4 py-3 text-sm text-ink">
                      <strong>{copy.selectedInstitution}:</strong> {requestForm.requested_site_label}
                    </div>
                  ) : null}
                  <Field as="div" label={copy.existingInstitutionFallback}>
                    <select
                      id="requested_site_id"
                      value={visibleExistingSites.some((site) => site.site_id === requestForm.requested_site_id) ? requestForm.requested_site_id : ""}
                      onChange={(event) => {
                        const nextSiteId = event.target.value;
                        const nextSite = visibleExistingSites.find((site) => site.site_id === nextSiteId) ?? null;
                        setRequestForm((current) => ({
                          ...current,
                          requested_site_id: nextSiteId,
                          requested_site_label: nextSite ? getSiteDisplayName(nextSite) : current.requested_site_label,
                        }));
                      }}
                    >
                      <option value="">{pick(locale, "No existing site selected", "기존 site 미선택")}</option>
                      {visibleExistingSites.map((site) => (
                        <option key={site.site_id} value={site.site_id}>
                          {getSiteDisplayName(site)}
                        </option>
                      ))}
                    </select>
                    {institutionQuery.trim().length >= 2 && visibleExistingSites.length === 0 ? (
                      <div className="mt-2 rounded-[18px] border border-border/80 bg-surface-muted/80 px-4 py-3 text-sm text-muted">
                        {copy.existingInstitutionEmpty}
                      </div>
                    ) : null}
                  </Field>
                  <Field as="div" label={copy.requestedRole}>
                    <div className="rounded-[18px] border border-border bg-white/55 px-4 py-3 text-sm font-semibold text-ink dark:bg-white/4">
                      {translateRole(locale, "researcher")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted">{copy.requestedRoleHelp}</div>
                  </Field>
                  <Field as="div" label={copy.noteForReviewer}>
                    <textarea
                      id="message"
                      rows={4}
                      value={requestForm.message}
                      onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))}
                      placeholder={copy.requestPlaceholder}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={requestBusy || !requestForm.requested_site_id}
                  >
                    {requestBusy ? copy.submitting : copy.submitInstitutionRequest}
                  </Button>
                </form>
              </Card>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (
    !desktopWorkspaceRuntime &&
    !optimisticApprovedBootstrap &&
    (workspaceDataPlaneState === "idle" || workspaceDataPlaneState === "checking")
  ) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_34%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <LocaleToggle />
        </div>
        <section className="mx-auto mt-6 grid w-full max-w-3xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {pick(locale, "Workspace Services", "워크스페이스 서비스")}
                </span>
              }
              title={pick(locale, "Verifying the workspace connection", "워크스페이스 연결을 확인하는 중입니다")}
              description={copy.workspaceServicesChecking}
              aside={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  onClick={handleWorkspaceLogout}
                >
                  {copy.logOut}
                </Button>
              }
            />
            <div className="rounded-[20px] border border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted">
              {copy.workspaceServicesChecking}
            </div>
          </Card>
        </section>
      </main>
    );
  }

  if (!desktopWorkspaceRuntime && workspaceDataPlaneState === "unavailable") {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_34%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl justify-end">
          <LocaleToggle />
        </div>
        <section className="mx-auto mt-6 grid w-full max-w-3xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {pick(locale, "Control Plane Only", "Control Plane 전용")}
                </span>
              }
              title={copy.workspaceServicesUnavailableTitle}
              description={copy.workspaceServicesUnavailableBody}
              aside={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  onClick={handleWorkspaceLogout}
                >
                  {copy.logOut}
                </Button>
              }
            />
            <div className="rounded-[20px] border border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted">
              {copy.workspaceServicesUnavailableHint}
            </div>
            <Card as="section" variant="surface" className="grid gap-4 rounded-[22px] border border-border/80 bg-surface-muted/70 p-5">
              <SectionHeader
                title={copy.desktopDownloadTitle}
                description={copy.desktopDownloadBody}
              />
              {sites.length > 1 ? (
                <Field
                  htmlFor="desktop_download_site_id"
                  label={copy.desktopSelectedHospital}
                  hint={pick(
                    locale,
                    "The selected hospital is written into the download log before the OneDrive redirect opens.",
                    "선택한 병원은 OneDrive 다운로드로 이동하기 전에 다운로드 로그에 함께 기록됩니다.",
                  )}
                >
                  <select
                    id="desktop_download_site_id"
                    value={selectedSiteId ?? ""}
                    onChange={(event) => setSelectedSiteId(event.target.value || null)}
                  >
                    {sites.map((site) => (
                      <option key={site.site_id} value={site.site_id}>
                        {getSiteDisplayName(site)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : selectedDownloadSiteLabel ? (
                <div className="rounded-[18px] border border-border/70 bg-surface px-4 py-3 text-sm text-ink">
                  <div className="text-[0.74rem] uppercase tracking-[0.14em] text-muted">
                    {copy.desktopSelectedHospital}
                  </div>
                  <div className="mt-1 font-medium">{selectedDownloadSiteLabel}</div>
                </div>
              ) : null}
              {desktopReleaseBusy ? (
                <div className="rounded-[18px] border border-dashed border-border px-4 py-4 text-sm text-muted">
                  {copy.desktopDownloadBusy}
                </div>
              ) : primaryDesktopRelease ? (
                <div className="grid gap-3 rounded-[18px] border border-border/70 bg-surface px-4 py-4 text-sm text-ink">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-[0.74rem] uppercase tracking-[0.14em] text-muted">{copy.desktopVersionLabel}</div>
                      <div className="mt-1 font-medium">{primaryDesktopRelease.version}</div>
                    </div>
                    <div>
                      <div className="text-[0.74rem] uppercase tracking-[0.14em] text-muted">{copy.desktopSizeLabel}</div>
                      <div className="mt-1 font-medium">
                        {formatBinarySize(locale, primaryDesktopRelease.size_bytes)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[0.74rem] uppercase tracking-[0.14em] text-muted">{copy.desktopShaLabel}</div>
                      <div className="mt-1 break-all font-mono text-[0.72rem]">
                        {primaryDesktopRelease.sha256 || pick(locale, "Unavailable", "없음")}
                      </div>
                    </div>
                  </div>
                  {primaryDesktopRelease.notes ? (
                    <div className="rounded-[14px] bg-surface-muted/70 px-3 py-2 text-sm text-muted">
                      {primaryDesktopRelease.notes}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => {
                        void handleDesktopInstallerDownload();
                      }}
                      disabled={desktopDownloadBusy || (!selectedSiteId && sites.length > 0 && user?.role !== "admin")}
                    >
                      {desktopDownloadBusy ? copy.desktopDownloadPreparing : copy.desktopDownloadButton}
                    </Button>
                    {primaryDesktopRelease.folder_url ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => window.open(primaryDesktopRelease.folder_url ?? "", "_blank", "noopener,noreferrer")}
                      >
                        {copy.desktopFolderLink}
                      </Button>
                    ) : null}
                  </div>
                  <div className="text-[0.76rem] leading-6 text-muted">{copy.desktopDownloadExternalHint}</div>
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-border px-4 py-4 text-sm text-muted">
                  {copy.desktopDownloadUnavailable}
                </div>
              )}
              {desktopReleaseError ? (
                <div className="rounded-[18px] border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  {desktopReleaseError}
                </div>
              ) : null}
            </Card>
          </Card>
        </section>
      </main>
    );
  }
  if (workspaceMode === "canvas" || !canOpenOperations) {
    return (
      <RuntimeErrorBoundary
        copy={caseWorkspaceCrashCopy}
        scope="case-workspace"
        resetKey={`${workspaceMode}:${selectedSiteId}:${resolvedTheme}:${user.user_id}`}
        onExit={handleWorkspaceLogout}
      >
        <CaseWorkspace
          token={effectiveToken}
          user={user}
          sites={sites}
          selectedSiteId={selectedSiteId}
          summary={summary}
          canOpenOperations={canOpenOperations}
          onSelectSite={setSelectedSiteId}
          onExportManifest={handleManifestDownload}
          onLogout={handleWorkspaceLogout}
          onOpenHospitalAccessRequest={() => setAccessRequestMode(true)}
          onOpenOperations={(section) => {
            setOperationsSection(section ?? "management");
            setWorkspaceMode("operations");
          }}
          onSiteDataChanged={async (siteId) => {
            await refreshSiteData(siteId, effectiveToken);
          }}
          theme={resolvedTheme}
          onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        />
      </RuntimeErrorBoundary>
    );
  }

  if (workspaceMode === "operations" && canOpenOperations) {
    return (
      <RuntimeErrorBoundary
        copy={adminWorkspaceCrashCopy}
        scope="admin-workspace"
        resetKey={`${workspaceMode}:${selectedSiteId}:${operationsSection}:${resolvedTheme}:${user.user_id}`}
        onExit={handleWorkspaceLogout}
      >
        <AdminWorkspace
          token={effectiveToken}
          user={user}
          sites={sites}
          sitesBusy={bootstrapBusy && sites.length === 0}
          selectedSiteId={selectedSiteId}
          summary={summary}
          initialSection={operationsSection}
          onSelectSite={setSelectedSiteId}
          onOpenCanvas={() => setWorkspaceMode("canvas")}
          onLogout={handleWorkspaceLogout}
          onRefreshSites={async () => {
            await refreshApprovedSites(effectiveToken);
          }}
          onSiteDataChanged={async (siteId) => {
            await refreshSiteData(siteId, effectiveToken);
          }}
          theme={resolvedTheme}
          onToggleTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        />
      </RuntimeErrorBoundary>
    );
  }

  return null;
}
