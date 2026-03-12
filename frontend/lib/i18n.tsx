"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ko";

const LOCALE_STORAGE_KEY = "kera_web_locale";

const localeTags: Record<Locale, string> = {
  en: "en-US",
  ko: "ko-KR",
};

const commonLabels = {
  en: {
    language: "Language",
    english: "EN",
    korean: "KO",
    saved: "Saved",
    actionNeeded: "Action needed",
    loading: "Loading...",
    notAvailable: "n/a",
  },
  ko: {
    language: "언어",
    english: "EN",
    korean: "KO",
    saved: "저장됨",
    actionNeeded: "확인 필요",
    loading: "불러오는 중...",
    notAvailable: "없음",
  },
} as const;

const roleLabels = {
  en: {
    admin: "admin",
    site_admin: "hospital admin",
    researcher: "researcher",
    viewer: "viewer",
  },
  ko: {
    admin: "관리자",
    site_admin: "병원 관리자",
    researcher: "연구자",
    viewer: "뷰어",
  },
} as const;

const statusLabels = {
  en: {
    approved: "Approved",
    pending: "Pending",
    rejected: "Rejected",
    application_required: "Application required",
  },
  ko: {
    approved: "승인됨",
    pending: "대기 중",
    rejected: "반려됨",
    application_required: "신청 필요",
  },
} as const;

const apiErrorExact = {
  en: {
    "학습 데이터가 없습니다. 먼저 이미지를 등록하세요.": "No training data is available. Upload images first.",
    "최소 4개 케이스가 필요합니다 (현재 0개).": "At least 4 cases are required (current 0).",
  },
  ko: {
    "Invalid token.": "유효하지 않은 토큰입니다.",
    "Google authentication is not configured on the server.": "서버에 Google 인증이 설정되지 않았습니다.",
    "Google token verification failed.": "Google 토큰 검증에 실패했습니다.",
    "Google token issuer mismatch.": "Google 토큰 발급자 정보가 일치하지 않습니다.",
    "Google email is not verified.": "Google 이메일 인증이 완료되지 않았습니다.",
    "Google account did not return an email.": "Google 계정에서 이메일 정보를 반환하지 않았습니다.",
    "Google account did not return a subject.": "Google 계정에서 subject 정보를 반환하지 않았습니다.",
    "Google account did not return a stable subject identifier.": "Google 계정에서 안정적인 subject 식별자를 반환하지 않았습니다.",
    "This Google email is already used by another account.": "이 Google 이메일은 다른 계정에서 이미 사용 중입니다.",
    "This email is already reserved by a local account.": "이 이메일은 로컬 계정에서 이미 사용 중입니다.",
    "This email is already linked to a different Google account.": "이 이메일은 다른 Google 계정에 이미 연결되어 있습니다.",
    "Missing bearer token.": "Bearer 토큰이 없습니다.",
    "User no longer exists.": "사용자 계정이 더 이상 존재하지 않습니다.",
    "This account is not approved yet. Submit an institution request first.": "이 계정은 아직 승인되지 않았습니다. 먼저 기관 접근 요청을 제출해 주세요.",
    "No access to this site.": "이 병원에 대한 접근 권한이 없습니다.",
    "You cannot review requests for this site.": "이 병원의 요청을 검토할 권한이 없습니다.",
    "Validation execution is disabled for viewer accounts.": "뷰어 계정에서는 검증 실행이 비활성화됩니다.",
    "Admin or site admin access required.": "관리자 또는 병원 관리자 권한이 필요합니다.",
    "Platform admin access required.": "플랫폼 관리자 권한이 필요합니다.",
    "Invalid credentials.": "로그인 정보가 올바르지 않습니다.",
    "Invalid requested role.": "요청한 역할이 올바르지 않습니다.",
    "Unknown site.": "알 수 없는 병원입니다.",
    "Unknown access request.": "알 수 없는 접근 요청입니다.",
    "Invalid review decision.": "검토 결정값이 올바르지 않습니다.",
    "Invalid assigned role.": "부여할 역할이 올바르지 않습니다.",
    "No pending updates are available for aggregation.": "집계할 대기 중 업데이트가 없습니다.",
    "Only updates with the same architecture can be aggregated together.": "같은 아키텍처의 업데이트만 함께 집계할 수 있습니다.",
    "Only updates based on the same global model can be aggregated together.": "같은 전역 모델을 기준으로 한 업데이트만 함께 집계할 수 있습니다.",
    "No global model is available for aggregation.": "집계에 사용할 전역 모델이 없습니다.",
    "One or more pending update artifacts are missing on disk.": "하나 이상의 대기 중 업데이트 아티팩트가 디스크에 없습니다.",
    "Invalid user role.": "사용자 역할이 올바르지 않습니다.",
    "Non-admin accounts must be assigned to at least one site.": "관리자가 아닌 계정에는 최소 한 개 이상의 병원을 지정해야 합니다.",
    "Password is required for user creation.": "사용자 생성에는 비밀번호가 필요합니다.",
    "Bulk import requires a CSV metadata file.": "대량 임포트에는 CSV 메타데이터 파일이 필요합니다.",
    "Validation run not found.": "검증 실행 기록을 찾을 수 없습니다.",
    "No ready model version is available for site validation.": "병원 검증에 사용할 준비된 모델 버전이 없습니다.",
    "Visit not found.": "방문 기록을 찾을 수 없습니다.",
    "Only active visits are enabled for contribution under the current policy.": "현재 정책에서는 활동성 방문만 기여 대상으로 허용됩니다.",
    "No ready model version is available for contribution.": "기여에 사용할 준비된 모델 버전이 없습니다.",
    "Image not found for this case.": "이 케이스의 이미지를 찾을 수 없습니다.",
    "ROI preview record not found.": "각막 crop 미리보기 기록을 찾을 수 없습니다.",
    "Unknown ROI preview artifact.": "알 수 없는 각막 crop 미리보기 아티팩트입니다.",
    "Requested ROI artifact is not available.": "요청한 각막 crop 아티팩트를 사용할 수 없습니다.",
    "Lesion preview record not found.": "병변 crop 미리보기 기록을 찾을 수 없습니다.",
    "Unknown lesion preview artifact.": "알 수 없는 병변 crop 미리보기 아티팩트입니다.",
    "Requested lesion artifact is not available.": "요청한 병변 crop 아티팩트를 사용할 수 없습니다.",
    "Artifact is outside the site workspace.": "아티팩트가 병원 워크스페이스 밖에 있습니다.",
    "Artifact file not found on disk.": "아티팩트 파일을 디스크에서 찾을 수 없습니다.",
    "Validation case prediction not found.": "검증 케이스 예측 결과를 찾을 수 없습니다.",
    "Unknown validation artifact.": "알 수 없는 검증 아티팩트입니다.",
    "Requested artifact is not available.": "요청한 아티팩트를 사용할 수 없습니다.",
    "No images found for this visit.": "이 방문에 해당하는 이미지가 없습니다.",
    "Representative image is not part of this visit.": "대표 이미지는 이 방문 기록에 속한 이미지여야 합니다.",
    "Image not found.": "이미지를 찾을 수 없습니다.",
    "Image file not found on disk.": "이미지 파일을 디스크에서 찾을 수 없습니다.",
    "No ready global model is available for validation.": "검증에 사용할 준비된 전역 모델이 없습니다.",
    "No uploaded images are available for validation.": "검증에 사용할 업로드 이미지가 없습니다.",
    "No manifest records are available for fine-tuning.": "파인튜닝에 사용할 매니페스트 레코드가 없습니다.",
    "Cross-validation requires a non-empty dataset.": "교차 검증에는 비어 있지 않은 데이터셋이 필요합니다.",
    "Cross-validation is MedSAM crop-only.": "교차 검증은 MedSAM 각막 crop 데이터만 지원합니다.",
    "Initial training is MedSAM crop-only.": "초기 학습은 MedSAM 각막 crop 데이터만 지원합니다.",
    "Cross-validation is MedSAM cornea-crop-only.": "교차 검증은 MedSAM 각막 crop 데이터만 지원합니다.",
    "Initial training is MedSAM cornea-crop-only.": "초기 학습은 MedSAM 각막 crop 데이터만 지원합니다.",
    "Checkpoint did not contain a readable state_dict.": "체크포인트에 읽을 수 있는 state_dict가 없습니다.",
    "No records are available for fine-tuning.": "파인튜닝에 사용할 레코드가 없습니다.",
    "At least one delta path is required.": "최소 한 개 이상의 delta 경로가 필요합니다.",
    "weights length must match delta_paths length.": "weights 길이는 delta_paths 길이와 일치해야 합니다.",
    "Cross-validation fold construction failed. Not enough patients in a fold.": "교차 검증 fold 생성에 실패했습니다. 한 fold에 환자 수가 충분하지 않습니다.",
    "test_size must leave at least one patient on each side of the split.": "test_size 설정 후 분할 양쪽에 최소 한 명 이상의 환자가 남아야 합니다.",
    "Only culture-proven keratitis cases are allowed.": "배양으로 확인된 각막염 케이스만 허용됩니다.",
    "Cross-validation currently supports automated or manual crop mode, not both.": "교차 검증은 현재 automated 또는 manual crop mode만 지원하며 both는 지원하지 않습니다.",
    "Ensemble models are not supported for local fine-tuning contributions.": "앙상블 모델은 현재 로컬 파인튜닝 기여를 지원하지 않습니다.",
    "Manual lesion crop requires at least one saved lesion box.": "Manual lesion crop에는 저장된 병변 박스가 최소 한 개 이상 필요합니다.",
    "This case requires at least one saved lesion box.": "이 케이스에는 저장된 병변 박스가 최소 한 개 이상 필요합니다.",
    "Visit must exist before image upload.": "이미지를 업로드하기 전에 방문 기록이 먼저 있어야 합니다.",
    "There is already a pending approval request for this user.": "이 사용자에 대해서는 이미 대기 중인 승인 요청이 있습니다.",
    "Only pending requests can be reviewed.": "대기 중인 요청만 검토할 수 있습니다.",
    "Project name is required.": "프로젝트 이름은 필수입니다.",
    "Site code is required.": "병원 코드는 필수입니다.",
    "Site display name is required.": "병원 표시 이름은 필수입니다.",
    "Patient ID is required.": "환자 ID는 필수입니다.",
  },
} as const;

type ApiErrorPattern = {
  pattern: RegExp;
  render: (...matches: string[]) => string;
};

const apiErrorPatterns: Record<Locale, ApiErrorPattern[]> = {
  en: [
    {
      pattern: /^최소 4개 케이스가 필요합니다 \(현재 (\d+)개\)\.$/,
      render: (count: string) => `At least 4 cases are required (current ${count}).`,
    },
    {
      pattern: /^최소 4명의 환자가 필요합니다 \(현재 (\d+)명\)\.$/,
      render: (count: string) => `At least 4 patients are required (current ${count}).`,
    },
  ],
  ko: [
    { pattern: /^Request failed: (\d+)$/, render: (code: string) => `요청에 실패했습니다 (${code}).` },
    { pattern: /^Manifest export failed: (\d+)$/, render: (code: string) => `매니페스트 내보내기에 실패했습니다 (${code}).` },
    { pattern: /^Image fetch failed: (\d+)$/, render: (code: string) => `이미지를 불러오지 못했습니다 (${code}).` },
    { pattern: /^Artifact fetch failed: (\d+)$/, render: (code: string) => `아티팩트를 불러오지 못했습니다 (${code}).` },
    { pattern: /^ROI preview fetch failed: (\d+)$/, render: (code: string) => `각막 crop 미리보기를 불러오지 못했습니다 (${code}).` },
    { pattern: /^Lesion preview fetch failed: (\d+)$/, render: (code: string) => `병변 crop 미리보기를 불러오지 못했습니다 (${code}).` },
    { pattern: /^Unable to parse CSV: (.+)$/, render: (detail: string) => `CSV를 파싱하지 못했습니다: ${detail}` },
    { pattern: /^Missing columns: (.+)$/, render: (columns: string) => `누락된 컬럼: ${columns}` },
    { pattern: /^AI workflow is not available on this server: (.+)$/, render: (detail: string) => `이 서버에서는 AI 워크플로를 사용할 수 없습니다: ${detail}` },
    { pattern: /^Federated aggregation is unavailable: (.+)$/, render: (detail: string) => `연합 집계를 실행할 수 없습니다: ${detail}` },
    { pattern: /^Site validation is unavailable: (.+)$/, render: (detail: string) => `병원 검증을 실행할 수 없습니다: ${detail}` },
    { pattern: /^Initial training is unavailable: (.+)$/, render: (detail: string) => `초기 학습을 실행할 수 없습니다: ${detail}` },
    { pattern: /^Cross-validation is unavailable: (.+)$/, render: (detail: string) => `교차 검증을 실행할 수 없습니다: ${detail}` },
    { pattern: /^Case validation is unavailable: (.+)$/, render: (detail: string) => `케이스 검증을 실행할 수 없습니다: ${detail}` },
    { pattern: /^Case contribution is unavailable: (.+)$/, render: (detail: string) => `케이스 기여를 실행할 수 없습니다: ${detail}` },
    { pattern: /^ROI preview is unavailable: (.+)$/, render: (detail: string) => `각막 crop 미리보기를 실행할 수 없습니다: ${detail}` },
    { pattern: /^Lesion preview is unavailable: (.+)$/, render: (detail: string) => `병변 crop 미리보기를 실행할 수 없습니다: ${detail}` },
    { pattern: /^Initial training supports only these architectures: (.+)$/, render: (variants: string) => `초기 학습은 다음 아키텍처만 지원합니다: ${variants}` },
    { pattern: /^Cross-validation supports only these architectures: (.+)$/, render: (variants: string) => `교차 검증은 다음 아키텍처만 지원합니다: ${variants}` },
    { pattern: /^Initial training supports only DenseNet variants: (.+)$/, render: (variants: string) => `초기 학습은 DenseNet 계열만 지원합니다: ${variants}` },
    { pattern: /^Cross-validation supports only DenseNet variants: (.+)$/, render: (variants: string) => `교차 검증은 DenseNet 계열만 지원합니다: ${variants}` },
    { pattern: /^Unknown user_id: (.+)$/, render: (userId: string) => `알 수 없는 사용자 ID: ${userId}` },
    { pattern: /^Unknown request_id: (.+)$/, render: (requestId: string) => `알 수 없는 요청 ID: ${requestId}` },
    { pattern: /^Unknown project_id: (.+)$/, render: (projectId: string) => `알 수 없는 프로젝트 ID: ${projectId}` },
    { pattern: /^Patient (.+) already exists\.$/, render: (patientId: string) => `환자 ${patientId}는 이미 존재합니다.` },
    { pattern: /^Patient (.+) does not exist\.$/, render: (patientId: string) => `환자 ${patientId}가 존재하지 않습니다.` },
    { pattern: /^Visit (.+) \/ (.+) already exists\.$/, render: (patientId: string, visitDate: string) => `방문 ${patientId} / ${visitDate}는 이미 존재합니다.` },
    { pattern: /^Site (.+) already exists\.$/, render: (siteCode: string) => `병원 ${siteCode}는 이미 존재합니다.` },
    { pattern: /^No images found for patient (.+) \/ (.+)\.$/, render: (patientId: string, visitDate: string) => `환자 ${patientId} / ${visitDate}에 대한 이미지가 없습니다.` },
    { pattern: /^At least 4 patients are required \(current: (\d+)\)\.$/, render: (count: string) => `최소 4명의 환자가 필요합니다 (현재 ${count}명).` },
    { pattern: /^At least (\d+) patients are required for (\d+)-fold cross-validation\.$/, render: (count: string, folds: string) => `${folds}-fold 교차 검증을 하려면 최소 ${count}명의 환자가 필요합니다.` },
  ],
} as const;

const optionLabels = {
  en: {
    sex: {
      female: "female",
      male: "male",
      other: "other",
      unknown: "unknown",
    },
    contactLens: {
      none: "none",
      "soft contact lens": "soft contact lens",
      "rigid gas permeable": "rigid gas permeable",
      orthokeratology: "orthokeratology",
      unknown: "unknown",
    },
    predisposing: {
      trauma: "trauma",
      "contact lens": "contact lens",
      "ocular surface disease": "ocular surface disease",
      "topical steroid use": "topical steroid use",
      "post surgery": "post surgery",
      neurotrophic: "neurotrophic",
      unknown: "unknown",
    },
    smear: {
      "not done": "not done",
      positive: "positive",
      negative: "negative",
      unknown: "unknown",
      other: "other",
    },
    visitStatus: {
      active: "active",
      improving: "improving",
      scar: "scar",
    },
    view: {
      white: "White",
      slit: "slit",
      fluorescein: "Fluorescein",
    },
    cultureCategory: {
      bacterial: "bacterial",
      fungal: "fungal",
    },
  },
  ko: {
    sex: {
      female: "여성",
      male: "남성",
      other: "기타",
      unknown: "미상",
    },
    contactLens: {
      none: "없음",
      "soft contact lens": "소프트렌즈",
      "rigid gas permeable": "RGP 렌즈",
      orthokeratology: "드림렌즈",
      unknown: "미상",
    },
    predisposing: {
      trauma: "외상",
      "contact lens": "콘택트렌즈",
      "ocular surface disease": "안구표면질환",
      "topical steroid use": "국소 스테로이드 사용",
      "post surgery": "수술 후",
      neurotrophic: "신경영양성",
      unknown: "미상",
    },
    smear: {
      "not done": "미시행",
      positive: "양성",
      negative: "음성",
      unknown: "미상",
      other: "기타",
    },
    visitStatus: {
      active: "활동성",
      improving: "호전",
      scar: "반흔",
    },
    view: {
      white: "백색광",
      slit: "세극등",
      fluorescein: "형광염색",
    },
    cultureCategory: {
      bacterial: "세균",
      fungal: "진균",
    },
  },
} as const;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localeTag: string;
  common: {
    language: string;
    english: string;
    korean: string;
    saved: string;
    actionNeeded: string;
    loading: string;
    notAvailable: string;
  };
  formatDateTime: (value: string | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function toLocale(value: string | null): Locale {
  if (!value) {
    return "en";
  }
  return value.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function pick<T>(locale: Locale, en: T, ko: T): T {
  return locale === "ko" ? ko : en;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const stored = toLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    setLocale(stored || toLocale(window.navigator.language));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const localeTag = localeTags[locale];
    return {
      locale,
      setLocale,
      localeTag,
      common: commonLabels[locale],
      formatDateTime: (value, options) => {
        if (!value) {
          return commonLabels[locale].notAvailable;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          return value;
        }
        return parsed.toLocaleString(localeTag, options);
      },
      formatNumber: (value, options) => {
        if (typeof value !== "number" || Number.isNaN(value)) {
          return commonLabels[locale].notAvailable;
        }
        return new Intl.NumberFormat(localeTag, options).format(value);
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within LocaleProvider.");
  }
  return context;
}

export function LocaleToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, common } = useI18n();

  return (
    <div className={`locale-switcher ${className}`.trim()} aria-label={common.language}>
      <button className={`locale-chip ${locale === "ko" ? "active" : ""}`} type="button" onClick={() => setLocale("ko")}>
        {common.korean}
      </button>
      <button className={`locale-chip ${locale === "en" ? "active" : ""}`} type="button" onClick={() => setLocale("en")}>
        {common.english}
      </button>
    </div>
  );
}

export function translateRole(locale: Locale, role: string): string {
  return roleLabels[locale][role as keyof typeof roleLabels.en] ?? role;
}

export function translateStatus(locale: Locale, status: string): string {
  return statusLabels[locale][status as keyof typeof statusLabels.en] ?? status;
}

export function translateOption(
  locale: Locale,
  group: keyof typeof optionLabels.en,
  value: string
): string {
  const table = optionLabels[locale][group] as Record<string, string>;
  return table[value] ?? value;
}

export function translateApiError(locale: Locale, message: string): string {
  const direct = apiErrorExact[locale][message as keyof (typeof apiErrorExact)[typeof locale]];
  if (direct) {
    return direct;
  }
  for (const entry of apiErrorPatterns[locale]) {
    const match = message.match(entry.pattern);
    if (match) {
      return entry.render(...match.slice(1));
    }
  }
  return message;
}
