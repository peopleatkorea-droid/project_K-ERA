"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { AdminWorkspace } from "../components/admin-workspace";
import { CaseWorkspace } from "../components/case-workspace";
import { LandingV4 } from "../components/public/landing-v4";
import { LocaleToggle, pick, translateApiError, translateRole, translateStatus, useI18n } from "../lib/i18n";
import {
  createPatient,
  downloadManifest,
  fetchAccessRequests,
  fetchMe,
  fetchMyAccessRequests,
  fetchPatients,
  fetchPublicSites,
  type PatientRecord,
  type SiteSummary,
  fetchSiteSummary,
  fetchSites,
  googleLogin,
  reviewAccessRequest,
  submitAccessRequest,
  type AccessRequestRecord,
  type AuthState,
  type AuthUser,
  type SiteRecord,
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

type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

const TOKEN_KEY = "kera_web_token";
const WORKSPACE_THEME_KEY = "kera_workspace_theme";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
type OperationsSection = "dashboard" | "training" | "cross_validation";

function parseOperationsLaunchFromSearch(): { mode: "canvas" | "operations"; section: OperationsSection } | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("workspace") !== "operations") {
    return null;
  }
  const section = params.get("section");
  if (section === "training" || section === "cross_validation" || section === "dashboard") {
    return { mode: "operations", section };
  }
  return { mode: "operations", section: "dashboard" };
}

function readJwtExpiration(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const payload = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const exp = readJwtExpiration(token);
  if (exp === null) {
    return false;
  }
  return exp <= Math.floor(Date.now() / 1000);
}

function isAuthBootstrapError(message: string): boolean {
  return ["Invalid token.", "Missing bearer token.", "User no longer exists."].includes(message);
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
    return pick(locale, "Submit your institution and role request to continue.", "계속하려면 기관과 역할 요청을 제출해 주세요.");
  }
  return pick(locale, "Approved", "승인됨");
}

export default function HomePage() {
  const { locale } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [publicSites, setPublicSites] = useState<SiteRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [myRequests, setMyRequests] = useState<AccessRequestRecord[]>([]);
  const [adminRequests, setAdminRequests] = useState<AccessRequestRecord[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [googleReady, setGoogleReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [patientBusy, setPatientBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [reviewBusyById, setReviewBusyById] = useState<Record<string, boolean>>({});
  const [googleLaunchPulse, setGoogleLaunchPulse] = useState(false);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(360);
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [patientForm, setPatientForm] = useState({
    patient_id: "",
    sex: "female",
    age: "65",
    chart_alias: "",
    local_case_code: "",
  });
  const [requestForm, setRequestForm] = useState({
    requested_site_id: "",
    requested_role: "researcher",
    message: "",
  });
  const [workspaceMode, setWorkspaceMode] = useState<"canvas" | "operations">("canvas");
  const [operationsSection, setOperationsSection] = useState<OperationsSection>("dashboard");
  const [workspaceTheme, setWorkspaceTheme] = useState<"dark" | "light">("dark");
  const [launchTarget, setLaunchTarget] = useState<{ mode: "canvas" | "operations"; section: OperationsSection } | null>(null);

  const approved = user?.approval_status === "approved";
  const canReview = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));
  const canOpenOperations = Boolean(approved && user && ["admin", "site_admin"].includes(user.role));
  const copy = {
    unableLoadInstitutions: pick(locale, "Unable to load institutions.", "기관 목록을 불러오지 못했습니다."),
    failedConnect: pick(locale, "Failed to connect.", "연결에 실패했습니다."),
    failedLoadSiteData: pick(locale, "Failed to load hospital data.", "병원 데이터를 불러오지 못했습니다."),
    failedLoadApprovalQueue: pick(locale, "Failed to load approval queue.", "승인 대기열을 불러오지 못했습니다."),
    googleNoCredential: pick(locale, "Google login did not return a credential.", "Google 로그인 자격 정보가 반환되지 않았습니다."),
    googleLoginFailed: pick(locale, "Google login failed.", "Google 로그인에 실패했습니다."),
    googlePreparing: pick(locale, "Google login is still loading. Try again in a moment.", "Google 로그인을 불러오는 중입니다. 잠시 후 다시 시도해 주세요."),
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    requestSubmissionFailed: pick(locale, "Request submission failed.", "요청 제출에 실패했습니다."),
    connecting: pick(locale, "Connecting...", "연결 중..."),
    submitting: pick(locale, "Submitting...", "제출 중..."),
    heroEyebrow: pick(locale, "Clinical Research Workspace", "임상 연구 워크스페이스"),
    heroBody: pick(
      locale,
      "Sign in with your institution account, request the right hospital once, and move directly into a document-style case canvas after approval.",
      "기관 계정으로 로그인하고 한 번만 병원 접근을 요청하면, 승인 후 문서형 케이스 캔버스로 바로 이동할 수 있습니다."
    ),
    signIn: pick(locale, "Sign In", "로그인"),
    enterWorkspace: pick(locale, "Enter the case workspace", "케이스 워크스페이스 입장"),
    signInBody: pick(
      locale,
      "Google is the default path for researchers. Local username/password stays admin-only for recovery.",
      "연구자는 Google 로그인이 기본 경로이며, 로컬 아이디/비밀번호는 관리자 복구용으로만 유지됩니다."
    ),
    googleLogin: pick(locale, "Institution Google login", "기관 Google 로그인"),
    googleDisabled: pick(
      locale,
      "Google login is disabled until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set.",
      "`NEXT_PUBLIC_GOOGLE_CLIENT_ID`가 설정되기 전까지 Google 로그인이 비활성화됩니다."
    ),
    adminRecoveryOnly: pick(locale, "Administrator recovery only", "관리자 복구 전용"),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "비밀번호"),
    enterAdminRecovery: pick(locale, "Enter admin recovery", "관리자 복구로 입장"),
    approvalRequired: pick(locale, "Approval Required", "승인 필요"),
    institutionAccessRequest: pick(locale, "Institution access request", "기관 접근 요청"),
    signedInAs: (name: string, username: string) =>
      pick(locale, `Signed in as ${name} (${username})`, `${name} (${username}) 계정으로 로그인됨`),
    currentStatus: pick(locale, "Current Status", "현재 상태"),
    approvedBody: pick(
      locale,
      "Approved accounts receive hospital access and enter the clinician console automatically.",
      "승인된 계정은 병원 접근 권한을 받고 바로 임상 콘솔에 들어갑니다."
    ),
    noInstitutionRequest: pick(locale, "No institution request submitted yet.", "아직 기관 접근 요청을 제출하지 않았습니다."),
    reviewerLabel: pick(locale, "Reviewer", "검토자"),
    requestAccess: pick(locale, "Request Access", "접근 요청"),
    chooseInstitutionRole: pick(locale, "Choose your institution and role", "기관과 역할 선택"),
    hospital: pick(locale, "Hospital", "병원"),
    requestedRole: pick(locale, "Requested role", "요청 역할"),
    noteForReviewer: pick(locale, "Note for reviewer", "검토자 메모"),
    requestPlaceholder: pick(
      locale,
      "Department, study role, or context for this request.",
      "소속 부서, 연구 역할, 요청 배경을 적어주세요."
    ),
    submitInstitutionRequest: pick(locale, "Submit institution request", "기관 접근 요청 제출"),
    logOut: pick(locale, "Log Out", "로그아웃"),
    highlightGoogleTitle: pick(locale, "Google Sign-In", "Google 로그인"),
    highlightGoogleBody: pick(
      locale,
      "Researchers can onboard with a verified institution-linked Google account.",
      "연구자는 기관에 연결된 Google 계정으로 온보딩할 수 있습니다."
    ),
    highlightApprovalTitle: pick(locale, "Approval Queue", "승인 큐"),
    highlightApprovalBody: pick(
      locale,
      "Admins review institution and role requests before hospital access opens.",
      "관리자가 기관과 역할 요청을 검토한 뒤 병원 접근이 열립니다."
    ),
    highlightCanvasTitle: pick(locale, "Case Authoring", "증례 작성"),
    highlightCanvasBody: pick(
      locale,
      "Create, validate, and contribute cases from one workspace.",
      "하나의 작업공간에서 증례 작성, 검증, 기여를 처리합니다."
    ),
    highlightRecoveryTitle: pick(locale, "Admin Recovery", "관리자 복구"),
    highlightRecoveryBody: pick(
      locale,
      "A local admin fallback remains available for setup and incident recovery.",
      "초기 설정과 장애 대응을 위한 로컬 관리자 경로는 유지됩니다."
    ),
    landingBadge: pick(locale, "Corneal Research Network", "감염성 각막염 연구 네트워크"),
    landingScene: pick(
      locale,
      "After clinic ends, the image is still asking for one more look.",
      "외래가 끝난 뒤에도, 이미지는 한 번 더 들여다봐 달라고 말합니다."
    ),
    landingTitle: pick(locale, "A softer entrance into the research workspace.", "조금 더 감성적인 연구 워크스페이스의 입구"),
    landingBody: pick(
      locale,
      "Upload case images, review model evidence, and contribute cleaned cases from a single workspace that feels less like an admin gate and more like a quiet place to study.",
      "증례 이미지를 올리고, 모델 근거를 검토하고, 정리된 케이스를 기여하는 흐름을 하나의 화면에 담았습니다. 관리 콘솔의 입구보다, 차분하게 연구를 시작하는 장소에 가깝게 구성했습니다."
    ),
    landingPrimaryCta: pick(locale, "Start with Google", "Google로 연구 시작하기"),
    landingSecondaryCta: pick(locale, "See how it flows", "어떻게 이어지는지 보기"),
    landingCtaNote: pick(
      locale,
      "Institution Google login remains the primary path. Admin recovery stays separate.",
      "기관 Google 로그인이 기본 경로이며, 관리자 복구는 별도 경로로 유지됩니다."
    ),
    landingAuthEyebrow: pick(locale, "Research access", "연구 접근"),
    landingAuthTitle: pick(locale, "Move into the workspace with your institution account", "기관 계정으로 워크스페이스에 들어가기"),
    landingAuthBody: pick(
      locale,
      "The custom call-to-action leads here. The official Google button remains visible for a stable sign-in flow.",
      "히어로 CTA는 이 영역으로 연결되고, 실제 로그인은 안정성을 위해 공식 Google 버튼으로 이어집니다."
    ),
    landingAuthHint: pick(locale, "Use a hospital or institution-linked Google account.", "병원 또는 연구기관에 연결된 Google 계정을 사용하세요."),
    landingStoryEyebrow: pick(locale, "Why this tone", "이 분위기가 필요한 이유"),
    landingStoryTitle: pick(locale, "Research usually starts after the formal work is over.", "연구는 대개 공식 업무가 끝난 뒤에 시작됩니다."),
    landingStoryBody: pick(
      locale,
      "Keratitis cases often need a second pass: a cleaner crop, a calmer review, a better note, and a decision about whether the case is solid enough to contribute.",
      "감염성 각막염 증례는 대개 두 번째 검토가 필요합니다. 더 정돈된 crop, 더 차분한 판독, 더 나은 메모, 그리고 실제로 기여할 만큼 충분히 단단한 증례인지에 대한 판단이 뒤따릅니다."
    ),
    landingStoryQuote: pick(
      locale,
      "Not every useful research tool needs to feel like a control room. Sometimes it should feel like a desk lamp, a document, and one more careful question.",
      "유용한 연구 도구가 항상 관제실처럼 느껴질 필요는 없습니다. 때로는 스탠드 조명 아래의 문서와, 한 번 더 조심스럽게 던지는 질문에 가까워야 합니다."
    ),
    landingWorkflowEyebrow: pick(locale, "Workflow", "워크플로우"),
    landingWorkflowTitle: pick(locale, "One path from raw image to reusable case.", "원본 이미지에서 다시 쓸 수 있는 증례까지, 한 줄의 흐름으로"),
    landingWorkflowBody: pick(
      locale,
      "The pre-login page should already explain the rhythm of the product: collect, review, and contribute under the same institutional context.",
      "로그인 전 화면에서도 제품의 리듬이 보여야 합니다. 같은 기관 맥락 안에서 수집하고, 검토하고, 기여하는 흐름이 바로 읽혀야 합니다."
    ),
    landingTrustEyebrow: pick(locale, "Research guardrails", "연구를 위한 가드레일"),
    landingTrustTitle: pick(locale, "Built to stay careful, not just fast.", "빠르기만 한 도구가 아니라, 조심스럽게 남는 도구"),
    landingTrustBody: pick(
      locale,
      "Institution approval, case-level review, and contribution history still anchor the system even when the surface feels warmer.",
      "표면의 분위기가 조금 더 부드러워져도, 기관 승인과 케이스 단위 검토, 기여 이력이라는 핵심 규율은 그대로 유지됩니다."
    ),
    landingFinalTitle: pick(locale, "When you are ready, start with the same account your team already trusts.", "준비가 되면, 팀이 이미 신뢰하는 같은 계정으로 시작하면 됩니다."),
    landingFinalBody: pick(
      locale,
      "Google sign-in opens the same approval flow as before. Only the first impression changes.",
      "Google 로그인 이후의 승인 흐름은 기존과 같습니다. 바뀌는 것은 첫인상뿐입니다."
    ),
    landingFinalCta: pick(locale, "Open Google sign-in", "Google 로그인 열기"),
  };
  const landing = {
    navStory: pick(locale, "Origin", "시작 이야기"),
    navAbout: pick(locale, "What It Is", "K-ERA란"),
    navFeatures: pick(locale, "Features", "기능"),
    navPrivacy: pick(locale, "Privacy", "보안"),
    navJoin: pick(locale, "Join", "참여"),
    navFaq: pick(locale, "FAQ", "FAQ"),
    heroBadge: pick(locale, "Infectious Keratitis AI Research Platform", "감염성 각막염 AI 연구 플랫폼"),
    heroScene: pick(
      locale,
      "After clinic, the room turns quiet. A few corneal images are still open on the screen.",
      "외래가 끝난 뒤, 조용해진 진료실. 각막 사진 몇 장이 화면에 떠 있습니다."
    ),
    heroLineOne: pick(locale, "Is this bacterial,", "\"이건 세균성일까,"),
    heroLineTwo: pick(locale, "or fungal...", "곰팡이성일까…\""),
    heroEmphasis: pick(locale, "A moment to ask AI", "AI에게 물어보는 시간"),
    heroBody: pick(
      locale,
      "No Python setup, no Excel manifest, no manual annotation marathon. Upload today's images and let K-ERA think with you.",
      "파이썬도, 엑셀 manifest도, 수동 annotation도 필요 없습니다. 오늘 찍은 사진을 올리면, K-ERA가 함께 고민합니다."
    ),
    heroPrimary: pick(locale, "Start Research with Google", "Google로 연구 시작하기"),
    heroSecondary: pick(locale, "How does it work?", "어떻게 작동하나요"),
    heroScroll: pick(locale, "scroll", "scroll"),
    accessEyebrow: pick(locale, "Research Access", "연구 참여"),
    accessTitle: pick(locale, "Continue with your institution Google account", "기관 Google 계정으로 바로 시작하기"),
    accessBody: pick(
      locale,
      "Researchers use Google as the main path. The official Google button stays here for the real sign-in flow, while hospital onboarding and admin recovery remain separate.",
      "연구자는 Google 로그인이 기본 경로입니다. 실제 인증은 아래의 공식 Google 버튼으로 진행되고, 병원 참여 문의와 관리자 복구는 별도 경로로 유지됩니다."
    ),
    accessGoogleHint: pick(locale, "Use a hospital or institution-linked Google account.", "병원 또는 연구기관에 연결된 Google 계정을 사용하세요."),
    accessRecruiting: pick(locale, "Hospitals can request onboarding separately.", "병원 단위 참여는 별도 문의로 시작합니다."),
    accessMailCta: pick(locale, "Apply as a hospital", "병원 참여 신청하기"),
    originLabel: pick(locale, "AI research was too punishing to do alone", "AI 연구, 의사가 직접 하기엔"),
    originTitle: pick(locale, "It was a harsher process than it should have been.", "너무 가혹한 과정이었습니다"),
    originStory: pick(
      locale,
      "When we first tried to start AI research, the hardest part was not the deep learning model.\n\nIt was the Python environment, the image cleanup, and drawing ROI boxes one by one until the work itself began to ask a harder question.\n\n\"Is this really a study I can do on my own?\"\n\nThen came the emptiness of spending months on a model that failed on another hospital's data.\n\nAnd above all, the reality that privacy could keep all that effort from reaching actual care.",
      "처음 AI 연구를 시작할 때, 가장 힘든 건 딥러닝 모델이 아니었습니다.\n\n파이썬 환경을 맞추고, 이미지를 정리하고, ROI를 하나하나 그리다 보면 어느 순간 이렇게 생각하게 됩니다.\n\n\"이걸 정말 내가 할 수 있는 연구일까?\"\n\n몇 달을 쏟아부어 만든 모델이 다른 병원에서는 형편없는 성적을 보일 때의 허탈함.\n\n그리고 무엇보다, 프라이버시 문제로 그 모든 노력의 결실을 실제 진료에서 쓸 수 없다는 것."
    ),
    originSignature: pick(locale, "K-ERA developer note, Department of Ophthalmology", "K-ERA 개발자 노트, 제주대학교병원 안과"),
    aboutLabel: pick(locale, "What is K-ERA", "K-ERA란"),
    aboutTitleLead: pick(locale, "Turn AI research from", "AI 연구를"),
    aboutTitleAccent: pick(locale, "\"coding\"", "\"코딩\"이 아니라"),
    aboutTitleTail: pick(locale, "into a clinical workflow", "\"임상 워크플로\"로"),
    aboutBodyOne: pick(
      locale,
      "K-ERA is a research platform designed so clinicians can train, validate, and share keratitis AI without writing code. With a Google account, image upload and AI analysis stay inside one browser workflow.",
      "K-ERA는 임상 안과의사가 코드 없이 각막염 AI를 학습, 검증, 공유할 수 있도록 설계된 연구 플랫폼입니다. Google 계정으로 로그인하면 사진 업로드부터 AI 분석까지 웹 브라우저 하나로 처리됩니다."
    ),
    aboutBodyTwo: pick(
      locale,
      "The moment you register today's patient, the case starts becoming research data. As more hospitals join, the model learns from wider clinical environments while raw data never leaves the institution.",
      "오늘 진료한 환자를 등록하는 순간, 그 케이스가 연구 데이터가 됩니다. 참여 병원이 늘어날수록 AI는 더 다양한 임상 환경을 학습하고, 원본 데이터는 병원 밖으로 절대 나가지 않습니다."
    ),
    featuresLabel: pick(locale, "Core features", "핵심 기능"),
    featuresTitle: pick(locale, "Hours of manual work, reduced to a few guided clicks.", "수십 시간의 수작업을 클릭 몇 번으로"),
    featuresDesc: pick(
      locale,
      "K-ERA takes the repetitive and mechanical parts so the clinician can stay focused on interpretation.",
      "반복적이고 기계적인 작업은 K-ERA가 처리합니다. 임상의는 판단에만 집중하면 됩니다."
    ),
    federatedLabel: pick(locale, "Data privacy", "데이터 프라이버시"),
    federatedTitle: pick(locale, "Keep data inside the hospital. Share the model's learning outside it.", "데이터는 병원 안에. 지식은 모두와 함께."),
    federatedBodyOne: pick(
      locale,
      "The biggest barrier in multi-center AI research was always the same: hospitals cannot simply export data. K-ERA uses a different route.",
      "기존 다기관 AI 연구의 가장 큰 벽은 데이터 자체를 꺼낼 수 없다는 점이었습니다. K-ERA는 다른 방법을 선택했습니다."
    ),
    federatedBodyTwo: pick(
      locale,
      "Each hospital trains locally and shares only encrypted weight deltas with hashes. The original images, patient identifiers, and full-size crops remain inside the institution.",
      "각 병원이 자체 환경에서 모델을 학습하고, 학습 결과인 weight delta만 해시와 함께 암호화해 전송합니다. 원본 이미지, 환자 ID, full-size crop은 병원 내부에 남습니다."
    ),
    dreamLabel: pick(locale, "The scene we want", "우리가 그리는 장면"),
    dreamTitle: pick(locale, "After clinic ends, with one cup of coffee.", "외래가 정리된 뒤, 커피 한 잔과 함께"),
    dreamBox: pick(
      locale,
      "You close the final chart of the day and sit back down.\nA few corneal images remain on the screen.\n\nWhite, fluorescein, slit.\nYou look at the visit as a whole.\nDraw one box, and MedSAM catches the lesion.\n\nA moment later, AI replies:\n\"This visit pattern matches fungal keratitis at 76%.\nWould you like to review similar cases?\"\n\nThe decision still belongs to the doctor.\nBut now, the doctor does not have to reason alone.\nAnd one careful case can make someone else's model a little stronger.",
      "오늘 마지막 환자의 차트를 닫고, 자리에 앉습니다.\n컴퓨터 화면에는 각막 사진 몇 장이 떠 있습니다.\n\nWhite, Fluorescein, Slit.\n세 장의 사진을 함께 봅니다.\n병변에 box를 그리면, MedSAM이 ROI를 잡아냅니다.\n\n잠시 후, AI가 말합니다.\n\"이 방문의 패턴은 Fungal keratitis와 76% 일치합니다.\n유사한 케이스를 함께 보시겠어요?\"\n\n판단은 여전히 의사가 합니다.\n다만 이제는, 혼자 판단하지 않아도 됩니다.\n그리고 그 케이스 하나가 다른 누군가의 AI를 조금 더 강하게 만듭니다."
    ),
    dreamCta: pick(locale, "Join this scene", "이 장면에 함께하기"),
    statsLabel: pick(locale, "So far", "지금까지"),
    statsTitle: pick(locale, "Starting in Jeju, aiming for a national research network.", "제주에서 시작해, 한국 전체로"),
    collectiveLabel: pick(locale, "Participating hospitals", "함께하는 병원들"),
    collectiveTitle: pick(locale, "An experiment in collective intelligence.", "집단 지성을 믿어보는 실험"),
    collectiveBody: pick(
      locale,
      "Every case contributed by a clinician becomes both research material and real-world external validation. Even without coding or manuscript writing, participation itself becomes research.",
      "한국의 안과의사들이 각자의 케이스를 기여할 때마다, 그것은 동시에 실제 임상 환경에서의 external validation이 됩니다. 논문을 쓰지 않아도, 코딩을 몰라도, 참여 자체가 연구입니다."
    ),
    collectiveUserCta: pick(locale, "Sign in and start", "로그인하고 시작하기"),
    collectiveHospitalNote: pick(locale, "Any clinician can start with one Google account.", "임상 안과의사라면 누구나, Google 계정 1개로 시작"),
    faqLabel: pick(locale, "FAQ", "자주 묻는 질문"),
    faqTitle: pick(locale, "Questions you may already have.", "궁금한 점이 있으신가요?"),
    finalTitleLead: pick(locale, "Research does not have to begin as a giant project.", "연구는 거대한 프로젝트가 아닙니다"),
    finalBodyOne: pick(locale, "A single case from today's clinic can be enough.", "오늘 진료한 한 케이스, 그 사진 몇 장이면 충분합니다."),
    finalBodyTwo: pick(
      locale,
      "After clinic, with a cup of coffee, ask AI what it thinks. K-ERA begins with that question.",
      "외래가 끝난 뒤, 커피 한 잔을 들고 AI에게 물어보세요. \"너는 어떻게 생각해?\" K-ERA는 그 질문에서 시작됩니다."
    ),
    finalCta: pick(locale, "Open Google sign-in", "Google 로그인 열기"),
    finalNote: pick(locale, "Research begins with one case.", "Research begins with one case."),
    footerCopyright: pick(
      locale,
      "© 2026 K-ERA Project · Jeju National University Hospital",
      "© 2026 K-ERA Project · Jeju National University Hospital"
    ),
    footerPrivacy: pick(locale, "Privacy Policy", "개인정보처리방침"),
    footerTerms: pick(locale, "Terms", "이용약관"),
    footerContact: pick(locale, "Contact", "문의"),
    viewLabelWhite: pick(locale, "White", "White"),
    viewLabelFluorescein: pick(locale, "Fluorescein", "Fluorescein"),
    viewLabelSlit: pick(locale, "Slit", "Slit"),
    viewVisitChip: pick(locale, "Sample Visit", "Sample Visit"),
    viewVisitArrow: pick(locale, "Visit-level integrated review", "Visit 단위 종합 판독"),
    viewVisitResult: pick(locale, "Fungal Keratitis · 76% probability", "Fungal Keratitis · 76% 확률"),
    viewVisitSub: pick(locale, "MedSAM ROI extraction · Ensemble model", "MedSAM ROI 자동 추출 · Ensemble 모델"),
    fedTopLabel: pick(locale, "Central Control Plane", "중앙 Control Plane"),
    fedTopTitle: pick(locale, "Model versioning · FedAvg aggregation", "모델 버전 관리 · FedAvg 집계"),
    fedMid: pick(locale, "Only encrypted weight deltas move upward. Raw data never does.", "Weight Delta만 암호화 전송 · 원본 데이터는 이동하지 않습니다."),
    fedBottom: pick(locale, "Raw images, patient IDs, and full-size crops never leave the hospital.", "원본 이미지 · 환자 ID · full-size crop은 병원 밖으로 나가지 않습니다."),
  };
  const landingPainPoints = [
    {
      icon: "python",
      title: pick(locale, "Everything started with environment setup again.", "매번 Python 환경 설정부터"),
      body: pick(
        locale,
        "Anaconda, conflicting libraries, terminal errors. Too many clinicians stop before the study itself begins.",
        "Anaconda, 라이브러리 충돌, 터미널 에러. 이 과정에서 포기하는 임상의가 너무 많습니다."
      ),
    },
    {
      icon: "roi",
      title: pick(locale, "Thousands of images, all manually annotated.", "이미지 수천 장, 수동 annotation"),
      body: pick(
        locale,
        "Drawing lesion ROI one image at a time turns a few hundred cases into hundreds of hours.",
        "마우스로 병변 ROI를 하나씩 그리는 작업은 수백 장만 되어도 수백 시간으로 불어납니다."
      ),
    },
    {
      icon: "single",
      title: pick(locale, "Single-center data hits a hard wall.", "Single-center의 벽"),
      body: pick(
        locale,
        "If data cannot leave the hospital, external validation becomes the hardest part of proving the model.",
        "데이터를 병원 밖으로 꺼낼 수 없기 때문에, 힘들게 만든 AI도 external validation을 받기 어렵습니다."
      ),
    },
    {
      icon: "privacy",
      title: pick(locale, "Too many models end as papers only.", "논문만 쓰고 쓰지 못하는 AI"),
      body: pick(
        locale,
        "Research stays disconnected from care when privacy and deployment are treated as afterthoughts.",
        "실제 진료에서 활용되지 못하는 연구, 연구와 임상 사이의 간극이 계속 남습니다."
      ),
    },
  ];
  const landingFeatureCards = [
    {
      number: "01",
      eyebrow: pick(locale, "Meta AI MedSAM · 2024", "Meta AI MedSAM · 2024"),
      title: pick(locale, "Semi-automatic lesion segmentation with MedSAM", "MedSAM 기반 반자동 병변 분할"),
      body: pick(
        locale,
        "Upload an image and draw a loose box around the lesion. MedSAM creates a precise ROI mask in seconds, and Grad-CAM helps reveal why the model is attending there.",
        "이미지를 올리고 병변 주변에 box만 그리면, MedSAM이 정밀한 ROI segmentation을 자동 생성합니다. Grad-CAM으로 AI의 판단 근거도 함께 확인할 수 있습니다."
      ),
    },
    {
      number: "02",
      eyebrow: pick(locale, "Visit-level ensemble", "Visit-level Ensemble"),
      title: pick(locale, "Integrated review across White, Fluorescein, and Slit views", "Visit 단위 멀티모달 종합 판독"),
      body: pick(
        locale,
        "Instead of trusting a single photo, K-ERA reads the visit as a unit. Multiple views and ensemble logic reduce sensitivity to one noisy capture.",
        "실제 진료처럼 White, Fluorescein, Slit 세 가지 view를 함께 봅니다. 한 방문의 이미지를 통합해 판단하므로 사진 한 장의 잡음에 덜 흔들립니다."
      ),
    },
    {
      number: "03",
      eyebrow: pick(locale, "Privacy-preserving", "Privacy-preserving"),
      title: pick(locale, "Federated learning for multi-center collaboration", "Federated Learning 다기관 협력"),
      body: pick(
        locale,
        "Each hospital trains locally and shares only model deltas. Aggregated models return to all participants without exporting raw clinical images.",
        "각 병원이 자체 환경에서 학습 후 weight delta만 전달합니다. FedAvg로 집계된 모델은 참여 병원 모두에 배포되고, 원본 이미지는 병원 밖으로 나가지 않습니다."
      ),
    },
  ];
  const landingFederatedPoints = [
    {
      title: pick(locale, "What reaches the center", "중앙에 올라가는 것"),
      body: pick(
        locale,
        "Encrypted weight deltas and only lightweight review assets when policy allows them.",
        "암호화된 weight delta와, 정책상 허용된 경우에 한해 가벼운 검토용 자산만 전달됩니다."
      ),
    },
    {
      title: pick(locale, "What stays inside the hospital", "병원 밖으로 나가지 않는 것"),
      body: pick(
        locale,
        "Original images, patient identifiers, full-size crops, and detailed clinical records.",
        "원본 이미지, 환자 ID, full-size crop, 상세 임상 기록."
      ),
    },
    {
      title: pick(locale, "What happens as more hospitals join", "참여 병원이 늘어날수록"),
      body: pick(
        locale,
        "New sites naturally become broader external validation environments for the shared model.",
        "새로운 병원의 합류 자체가 더 넓은 external validation 환경으로 이어집니다."
      ),
    },
  ];
  const landingStats = [
    {
      value: "77%",
      label: pick(locale, "Pilot single-center 5-fold accuracy", "단일 기관 초기 모델 5-fold cross-validation accuracy"),
    },
    {
      value: "85%+",
      label: pick(locale, "Targeted accuracy at larger BK/FK scale", "BK · FK 각 5,000장 규모 달성 시 예상 accuracy"),
    },
    {
      value: "3",
      label: pick(locale, "White · Fluorescein · Slit modalities", "White · Fluorescein · Slit 멀티모달 이미지 지원"),
    },
    {
      value: "0",
      label: pick(locale, "Known raw-data leaks outside participating hospitals", "원본 데이터 외부 유출"),
    },
  ];
  const landingFaqItems = [
    {
      question: pick(locale, "Does K-ERA write the AI model for me?", "K-ERA는 AI 모델을 대신 만들어 주나요?"),
      answer: pick(
        locale,
        "No. K-ERA automates repetitive steps such as case registration, lesion segmentation, and training execution, but clinical judgment still belongs to the researcher.",
        "아니요. K-ERA의 원칙은 대체가 아니라 보조입니다. 케이스 등록, 병변 분할, 학습 실행 같은 반복 작업을 자동화하지만 판단은 언제나 임상의가 합니다."
      ),
    },
    {
      question: pick(locale, "Can I use it without coding?", "코딩을 전혀 몰라도 쓸 수 있나요?"),
      answer: pick(
        locale,
        "Yes. Python setup, CSV manifests, and most repetitive preparation steps are hidden behind the web workflow and Google sign-in.",
        "물론입니다. Python 설치도, CSV 작성도 필요 없습니다. Google 계정으로 로그인한 뒤 웹 UI에서 주요 기능을 사용할 수 있도록 설계했습니다."
      ),
    },
    {
      question: pick(locale, "Does patient data leave the hospital?", "환자 데이터가 외부로 유출되지 않나요?"),
      answer: pick(
        locale,
        "Original images and patient identifiers remain inside the hospital. The federated path is designed around local training and lightweight model updates.",
        "원본 이미지와 환자 정보는 병원 내부에만 존재합니다. 연합학습 경로는 로컬 학습과 경량 모델 업데이트 전송을 전제로 설계되어 있습니다."
      ),
    },
    {
      question: pick(locale, "What do participating hospitals gain?", "참여하면 어떤 이점이 있나요?"),
      answer: pick(
        locale,
        "Each contributed case becomes both research material and a wider validation environment, and participating sites benefit from the aggregated global model.",
        "참여 기관의 케이스는 전국 규모 AI의 external validation 데이터가 되고, 집계된 글로벌 모델의 혜택도 함께 공유받게 됩니다."
      ),
    },
    {
      question: pick(locale, "Which architectures are currently supported?", "어떤 모델 아키텍처를 지원하나요?"),
      answer: pick(
        locale,
        "Current initial training supports DenseNet121, ConvNeXt-Tiny, ViT-B/16, Swin-T, and EfficientNetV2-S with official pretrained backbones.",
        "현재 초기 학습은 DenseNet121, ConvNeXt-Tiny, ViT-B/16, Swin-T, EfficientNetV2-S를 official pretrained backbone 기준으로 지원합니다."
      ),
    },
    {
      question: pick(locale, "Does hospital IT need heavy infrastructure?", "병원 IT 인프라가 복잡해야 하나요?"),
      answer: pick(
        locale,
        "No. The local node is intended to run on a hospital-side workstation or server without requiring a large deployment footprint.",
        "아닙니다. Local Node는 병원 내부 워크스테이션 또는 서버 한 대에서도 운영할 수 있도록 설계되어 있습니다."
      ),
    },
  ];
  const adminRecoveryLinkLabel = pick(locale, "Open administrator recovery", "관리자 복구 열기");
  const adminLaunchLinks = [
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
  ];
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      if (isTokenExpired(stored)) {
        window.localStorage.removeItem(TOKEN_KEY);
      } else {
        setToken(stored);
      }
    }
    setLaunchTarget(parseOperationsLaunchFromSearch());
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(WORKSPACE_THEME_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setWorkspaceTheme(storedTheme);
    }
  }, []);

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
    window.localStorage.setItem(WORKSPACE_THEME_KEY, workspaceTheme);
  }, [workspaceTheme]);

  useEffect(() => {
    if (!approved || !canOpenOperations || !launchTarget || launchTarget.mode !== "operations") {
      return;
    }
    setOperationsSection(launchTarget.section);
    setWorkspaceMode("operations");
  }, [approved, canOpenOperations, launchTarget]);

  useEffect(() => {
    if (!token || !user || approved) {
      return;
    }
    void fetchPublicSites()
      .then((items) => {
        setPublicSites(items);
        setRequestForm((current) => ({
          ...current,
          requested_site_id: current.requested_site_id || items[0]?.site_id || "",
        }));
      })
      .catch((nextError) => {
        setError(describeError(nextError, copy.unableLoadInstitutions));
      });
  }, [token, user, approved, copy.unableLoadInstitutions]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const currentToken = token;
    async function bootstrap() {
      setBootstrapBusy(true);
      setError(null);
      try {
        const me = await fetchMe(currentToken);
        setUser(me);
        if (me.approval_status === "approved") {
          const nextSites = await fetchSites(currentToken);
          setSites(nextSites);
          setSelectedSiteId((current) => current ?? nextSites[0]?.site_id ?? null);
        } else {
          setSites([]);
          setSelectedSiteId(null);
          setMyRequests(await fetchMyAccessRequests(currentToken));
        }
      } catch (nextError) {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        if (!(nextError instanceof Error && isAuthBootstrapError(nextError.message))) {
          setError(describeError(nextError, copy.failedConnect));
        }
      } finally {
        setBootstrapBusy(false);
      }
    }
    void bootstrap();
  }, [token, copy.failedConnect]);

  useEffect(() => {
    if (!token || !selectedSiteId || !approved) {
      return;
    }
    const currentToken = token;
    const currentSiteId = selectedSiteId;
    async function loadSite() {
      setSiteBusy(true);
      setError(null);
      try {
        const [nextSummary, nextPatients] = await Promise.all([
          fetchSiteSummary(currentSiteId, currentToken),
          fetchPatients(currentSiteId, currentToken),
        ]);
        setSummary(nextSummary);
        setPatients(nextPatients);
      } catch (nextError) {
        setError(describeError(nextError, copy.failedLoadSiteData));
      } finally {
        setSiteBusy(false);
      }
    }
    void loadSite();
  }, [token, selectedSiteId, approved, copy.failedLoadSiteData]);

  useEffect(() => {
    if (!token || !canReview) {
      setAdminRequests([]);
      return;
    }
    const currentToken = token;
    void fetchAccessRequests(currentToken, "pending")
      .then((items) => {
        setAdminRequests(items);
        setReviewDrafts((current) => {
          const next = { ...current };
          for (const item of items) {
            next[item.request_id] = next[item.request_id] ?? {
              assigned_role: item.requested_role,
              assigned_site_id: item.requested_site_id,
              reviewer_notes: "",
            };
          }
          return next;
        });
      })
      .catch((nextError) => {
        setError(describeError(nextError, copy.failedLoadApprovalQueue));
      });
  }, [token, canReview, copy.failedLoadApprovalQueue]);

  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || token || !googleButtonRef.current || !window.google?.accounts?.id) {
      return;
    }
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError(copy.googleNoCredential);
          return;
        }
        setAuthBusy(true);
        setError(null);
        try {
          const auth = await googleLogin(response.credential);
          window.localStorage.setItem(TOKEN_KEY, auth.access_token);
          setToken(auth.access_token);
          setUser(auth.user);
        } catch (nextError) {
          setError(describeError(nextError, copy.googleLoginFailed));
        } finally {
          setAuthBusy(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      width: googleButtonWidth,
      text: "signin_with",
      shape: "pill",
    });
  }, [googleReady, token, googleButtonWidth, copy.googleLoginFailed, copy.googleNoCredential]);

  async function refreshSiteData(siteId: string, currentToken: string) {
    const [nextSummary, nextPatients] = await Promise.all([
      fetchSiteSummary(siteId, currentToken),
      fetchPatients(siteId, currentToken),
    ]);
    setSummary(nextSummary);
    setPatients(nextPatients);
  }

  async function refreshApprovedSites(currentToken: string) {
    const nextSites = await fetchSites(currentToken);
    setSites(nextSites);
    setSelectedSiteId((current) => current ?? nextSites[0]?.site_id ?? null);
  }

  async function handleCreatePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedSiteId) {
      return;
    }
    setPatientBusy(true);
    setError(null);
    try {
      await createPatient(selectedSiteId, token, {
        patient_id: patientForm.patient_id,
        sex: patientForm.sex,
        age: Number(patientForm.age),
        chart_alias: patientForm.chart_alias,
        local_case_code: patientForm.local_case_code,
      });
      setPatientForm((current) => ({ ...current, patient_id: "", chart_alias: "", local_case_code: "" }));
      await refreshSiteData(selectedSiteId, token);
    } catch (nextError) {
      setError(describeError(nextError, pick(locale, "Patient creation failed.", "환자 생성에 실패했습니다.")));
    } finally {
      setPatientBusy(false);
    }
  }

  async function handleRequestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setRequestBusy(true);
    setError(null);
    try {
      const response = await submitAccessRequest(token, requestForm);
      setUser(response.user);
      setMyRequests(await fetchMyAccessRequests(token));
    } catch (nextError) {
      setError(describeError(nextError, copy.requestSubmissionFailed));
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    if (!token) {
      return;
    }
    const draft = reviewDrafts[requestId];
    setReviewBusyById((current) => ({ ...current, [requestId]: true }));
    setError(null);
    try {
      await reviewAccessRequest(requestId, token, {
        decision,
        assigned_role: draft?.assigned_role,
        assigned_site_id: draft?.assigned_site_id,
        reviewer_notes: draft?.reviewer_notes,
      });
      setAdminRequests(await fetchAccessRequests(token, "pending"));
    } catch (nextError) {
      setError(describeError(nextError, pick(locale, "Review failed.", "검토에 실패했습니다.")));
    } finally {
      setReviewBusyById((current) => ({ ...current, [requestId]: false }));
    }
  }

  async function handleManifestDownload() {
    if (!token || !selectedSiteId) {
      return;
    }
    const blob = await downloadManifest(selectedSiteId, token);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedSiteId}_dataset_manifest.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function handleLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setWorkspaceMode("canvas");
    setOperationsSection("dashboard");
    setSites([]);
    setSelectedSiteId(null);
    setSummary(null);
    setPatients([]);
    setMyRequests([]);
    setAdminRequests([]);
  }

  function handleGoogleLaunch() {
    if (!GOOGLE_CLIENT_ID) {
      setError(copy.googleDisabled);
      return;
    }
    if (!googleReady) {
      setError(copy.googlePreparing);
      return;
    }
    setError(null);
    setGoogleLaunchPulse(true);
    googleButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      setGoogleLaunchPulse(false);
      const host = googleButtonRef.current;
      if (!host) {
        return;
      }
      const interactive = host.querySelector<HTMLElement>('div[role="button"], iframe');
      if (interactive) {
        interactive.click();
      }
    }, 180);
  }

  const landingHospitalChips = [
    ...publicSites.slice(0, 5).map((site) => ({ label: site.display_name, active: true })),
    ...Array.from({ length: Math.max(0, 5 - publicSites.slice(0, 5).length) }, () => ({
      label: pick(locale, "Recruiting", "참여 모집 중"),
      active: false,
    })),
  ];

  if (!token || !user) {
    return (
      <LandingV4
        locale={locale}
        authBusy={authBusy}
        error={error}
        googleClientId={GOOGLE_CLIENT_ID}
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

  if (!approved) {
    return (
      <main className="shell">
        <div className="shell-toolbar">
          <LocaleToggle />
        </div>
        <section className="dashboard">
          <div className="section-head">
            <div>
              <div className="eyebrow">{copy.approvalRequired}</div>
              <h2>{copy.institutionAccessRequest}</h2>
              <p className="muted">{copy.signedInAs(user.full_name, user.username)}</p>
            </div>
            <button className="secondary-button" type="button" onClick={handleLogout}>
              {copy.logOut}
            </button>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="approval-grid">
            <article className="content-card approval-status-card">
              <div className="eyebrow">{copy.currentStatus}</div>
              <h3>{statusCopy(locale, user.approval_status)}</h3>
              <p className="muted">{copy.approvedBody}</p>
              <div className={`status-chip tone-${user.approval_status}`}>{translateStatus(locale, user.approval_status)}</div>
              {myRequests.length === 0 ? (
                <div className="empty">{copy.noInstitutionRequest}</div>
              ) : (
                <div className="request-list">
                  {myRequests.map((request) => (
                    <div key={request.request_id} className="request-item">
                      <strong>{request.requested_site_id}</strong>
                      <div className="muted">
                        {translateRole(locale, request.requested_role)} · {translateStatus(locale, request.status)}
                      </div>
                      {request.message ? <div className="muted">“{request.message}”</div> : null}
                      {request.reviewer_notes ? <div className="muted">{copy.reviewerLabel}: {request.reviewer_notes}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="content-card approval-form-card">
              <div className="eyebrow">{copy.requestAccess}</div>
              <h3>{copy.chooseInstitutionRole}</h3>
              <form className="stack" onSubmit={handleRequestAccess}>
                <div className="field">
                  <label htmlFor="requested_site_id">{copy.hospital}</label>
                  <select
                    id="requested_site_id"
                    value={requestForm.requested_site_id}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, requested_site_id: event.target.value }))
                    }
                  >
                    {publicSites.map((site) => (
                      <option key={site.site_id} value={site.site_id}>
                        {site.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="requested_role">{copy.requestedRole}</label>
                  <select
                    id="requested_role"
                    value={requestForm.requested_role}
                    onChange={(event) => setRequestForm((current) => ({ ...current, requested_role: event.target.value }))}
                  >
                    <option value="researcher">{translateRole(locale, "researcher")}</option>
                    <option value="viewer">{translateRole(locale, "viewer")}</option>
                    <option value="site_admin">{translateRole(locale, "site_admin")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="message">{copy.noteForReviewer}</label>
                  <textarea
                    id="message"
                    rows={4}
                    value={requestForm.message}
                    onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder={copy.requestPlaceholder}
                  />
                </div>
                <button className="primary-button" type="submit" disabled={requestBusy || !requestForm.requested_site_id}>
                  {requestBusy ? copy.submitting : copy.submitInstitutionRequest}
                </button>
              </form>
            </article>
          </section>
        </section>
      </main>
    );
  }

  if (workspaceMode === "canvas" || !canOpenOperations) {
    return (
      <CaseWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        canOpenOperations={canOpenOperations}
        onSelectSite={setSelectedSiteId}
        onExportManifest={handleManifestDownload}
        onLogout={handleLogout}
        onOpenOperations={(section) => {
          setOperationsSection(section ?? "dashboard");
          setWorkspaceMode("operations");
        }}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
        theme={workspaceTheme}
        onToggleTheme={() => setWorkspaceTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
    );
  }

  if (workspaceMode === "operations" && canOpenOperations) {
    return (
      <AdminWorkspace
        token={token}
        user={user}
        sites={sites}
        selectedSiteId={selectedSiteId}
        summary={summary}
        initialSection={operationsSection}
        onSelectSite={setSelectedSiteId}
        onOpenCanvas={() => setWorkspaceMode("canvas")}
        onLogout={handleLogout}
        onRefreshSites={() => refreshApprovedSites(token)}
        onSiteDataChanged={(siteId) => refreshSiteData(siteId, token)}
        theme={workspaceTheme}
        onToggleTheme={() => setWorkspaceTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
    );
  }

  return null;
}
