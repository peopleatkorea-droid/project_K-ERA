"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import type { SiteRecord } from "../../lib/api";
import { getSiteDisplayName } from "../../lib/site-labels";
import { LandingGoogleCta } from "./landing-google-cta";

type KoreanLandingViewProps = {
  authBusy: boolean;
  googleLoginLabel: string;
  connectingLabel: string;
  googleLaunchPulse: boolean;
  adminRecoveryLinkLabel: string;
  adminLaunchLinks: Array<{ label: string; href: string }>;
  publicSites: SiteRecord[];
  onGoogleLaunch: () => void;
  onLocaleChange: (locale: "en") => void;
};

const koPainItems = [
  {
    title: "Python 환경 설정, 수동 Annotation",
    body: "Anaconda 충돌, 터미널 에러, 수천 장의 ROI 작업. 연구를 시작하기도 전에 지칩니다.",
  },
  {
    title: "Single-center의 한계",
    body: "데이터를 병원 밖으로 꺼낼 수 없어, 힘들게 만든 모델도 external validation을 받지 못합니다.",
  },
  {
    title: "논문은 쓰지만 진료엔 못 쓰는 AI",
    body: "연구 결과가 쌓여도 프라이버시 문제로 실제 임상에 적용되지 못합니다.",
  },
];

const koFeatures = [
  {
    title: "MedSAM 기반 반자동 병변 분할",
    body: "병변 주변에 box를 그리면 MedSAM이 ROI preview와 lesion crop을 준비합니다. 현재 논문에서 lesion-centered 비교는 manual prompt 기반이었고, 앱은 그 과정을 반자동 워크플로로 정리합니다.",
    chip: "MedSAM",
    previewSrc: "/landing/medSAM.png",
    previewAlt: "MedSAM 기반 반자동 병변 분할을 보여주는 이미지",
  },
  {
    title: "Visit 단위 멀티모달 판독",
    body: "플랫폼은 White · Fluorescein · Slit 이미지를 함께 저장하고 검토합니다. 다만 현재 공개 benchmark는 white-light 기준이며, visit 단위 판독과 유사 증례 탐색이 그 다음 확장 축입니다.",
    chip: "Visit-level",
    previewSrc: "/landing/multi_modal.png",
    previewAlt: "Visit 단위 멀티모달 종합 판독을 보여주는 이미지",
  },
  {
    title: "연합학습 확장",
    body: "이미지-level과 visit-level site round, pending review, FedAvg 집계가 구현돼 있습니다. Retrieval은 별도 federated corpus expansion 레일로 분리해 운영합니다.",
    chip: "Federated",
    previewSrc: "/landing/federated.png",
    previewAlt: "Federated Learning 다기관 협력을 보여주는 이미지",
  },
];

const koFeaturePreviewOptions = [
  {
    src: "/landing/workflow.png",
    alt: "K-ERA 핵심 기능 워크플로를 보여주는 랜딩 이미지",
  },
  ...koFeatures.map((feature) => ({
    src: feature.previewSrc,
    alt: feature.previewAlt,
  })),
];

const koFedPoints = [
  "중앙에 올라가는 것: AI 학습 결과 요약, 비식별 메타데이터, 검토용 저해상도 썸네일",
  "병원 밖으로 나가지 않는 것: 원본 이미지, 환자 정보, 상세 임상 기록",
  "데스크톱 앱에서 실행: 케이스 작성·이미지 업로드·AI 학습이 모두 병원 PC에서 이루어집니다",
];

const koStats = [
  { number: "101명", label: "제주 단일기관\nfeasibility cohort", context: "현재 공개 근거의 출발점입니다" },
  { number: "258", label: "Culture-confirmed visits\npatient-disjoint 5-fold", context: "누수 통제를 강하게 둔 평가입니다" },
  { number: "658", label: "White-light slit-lamp images\n현재 논문 benchmark", context: "공개 결과는 white-light 기준입니다" },
  { number: "0.677", label: "Best visit-level AUROC\nleakage-aware evaluation", context: "아직 modest해서 더 큰 다기관 검증이 필요합니다" },
];

const koFaqs = [
  {
    q: "K-ERA는 AI 모델을 대신 만들어 주나요?",
    a: "아닙니다. K-ERA는 케이스 등록, 병변 ROI 준비, 학습 실행 같은 반복 작업을 줄여 주는 연구 워크플로입니다. 최종 판단과 처방은 여전히 임상 의사의 몫입니다.",
  },
  {
    q: "코딩을 전혀 몰라도 쓸 수 있나요?",
    a: "가능합니다. Python 설치도, CSV 작성도 필요 없습니다. 먼저 웹 포털에서 Google 로그인으로 기관 승인을 신청하고, 승인되면 K-ERA 데스크톱 앱을 설치해 환자 이미지 업로드와 케이스 작성을 진행하면 됩니다.",
  },
  {
    q: "환자 데이터가 외부로 유출되지 않나요?",
    a: "원본 이미지와 환자 정보는 병원 내부에만 남습니다. 중앙으로는 weight delta, 비식별 메타데이터, 검토용 저해상도 thumbnail만 올라가며, review 이후에만 집계가 진행됩니다.",
  },
  {
    q: "참여하면 어떤 이점이 있나요?",
    a: "현재 단일기관 feasibility를 다기관 validation infrastructure로 확장하는 데 직접 기여하게 됩니다. 참여 기관은 더 큰 검증 코호트와 집계 모델 개선의 일부가 됩니다.",
  },
  {
    q: "어떤 진단 범주를 지원하나요?",
    a: "현재 공개 benchmark는 culture-confirmed BK vs FK, white-light slit-lamp 이미지 기준입니다. 앱은 White · Fluorescein · Slit 저장과 visit-level review를 지원하지만, 그 전체가 아직 같은 수준으로 검증된 것은 아닙니다.",
  },
  {
    q: "병원 IT 인프라가 복잡해야 하나요?",
    a: "아닙니다. 웹 포털은 로그인, 기관 승인, 설치 파일 안내에 사용하고, 실제 환자 케이스 작업은 병원 PC의 K-ERA 데스크톱 앱 한 대로 시작할 수 있게 설계돼 있습니다. 승인 후 다운로드 링크가 제공되고, 그다음부터는 앱에서 케이스 작성과 AI 학습을 이어가면 됩니다.",
  },
];

const koSecondaryCtaClass =
  "inline-block rounded-[8px] border border-[rgba(45,212,192,0.28)] bg-[#24aa9e] px-8 py-3 text-[0.9rem] font-medium tracking-[0.04em] text-[#081116] shadow-[0_10px_24px_rgba(9,13,24,0.32)] transition hover:-translate-y-0.5 hover:border-[rgba(45,212,192,0.38)] hover:bg-[#209d92] hover:shadow-[0_12px_28px_rgba(9,13,24,0.38)] active:scale-[0.97] active:translate-y-0";

export function KoreanLandingView(props: KoreanLandingViewProps) {
  const [featurePreviewIndex, setFeaturePreviewIndex] = useState(0);
  const [featurePreviewOverride, setFeaturePreviewOverride] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const activeHospitals = props.publicSites.slice(0, 5).map((site) => ({
    label: getSiteDisplayName(site),
    active: true,
  }));
  const openHospitalSlots = Array.from({ length: Math.max(0, 5 - activeHospitals.length) }, () => ({
    label: "추가 참여 기관 모집 중",
    active: false,
  }));
  const hospitals = [...activeHospitals, ...openHospitalSlots];

  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollSnapType = "y proximity";
    html.style.scrollBehavior = "smooth";
    return () => {
      html.style.scrollSnapType = "";
      html.style.scrollBehavior = "";
    };
  }, []);

  useEffect(() => {
    if (featurePreviewOverride) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setFeaturePreviewIndex((current) => (current + 1) % koFeaturePreviewOptions.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [featurePreviewOverride]);

  const activeFeaturePreview = featurePreviewOverride ?? koFeaturePreviewOptions[featurePreviewIndex];

  return (
    <main className="bg-[#0d0f14] text-[#e4e8f5] font-ko-sans">
      <nav className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-[rgba(45,212,192,0.13)] bg-[rgba(9,13,24,0.88)] px-5 py-3 backdrop-blur-xl md:px-12 md:py-4">
        <div className="flex items-center gap-3">
          <div className="text-[1.35rem] tracking-[0.04em] text-[#2dd4c0] font-ko-serif">
            K<span className="text-[#7b88a8]">-</span>ERA
          </div>
          <div className="hidden rounded-full border border-[rgba(45,212,192,0.18)] bg-[rgba(45,212,192,0.08)] px-3 py-1 text-[0.68rem] tracking-[0.12em] text-[#9ddfd7] md:block">
            감염성 각막염 AI 연구 플랫폼
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-7 md:flex">
            <a className="text-[0.8rem] uppercase tracking-[0.08em] text-[#7b88a8] transition hover:text-[#2dd4c0]" href="#origin">
              시작 이야기
            </a>
            <a className="text-[0.8rem] uppercase tracking-[0.08em] text-[#7b88a8] transition hover:text-[#2dd4c0]" href="#features">
              기능
            </a>
            <a className="text-[0.8rem] uppercase tracking-[0.08em] text-[#7b88a8] transition hover:text-[#2dd4c0]" href="#federated">
              보안
            </a>
            <a className="text-[0.8rem] uppercase tracking-[0.08em] text-[#7b88a8] transition hover:text-[#2dd4c0]" href="#collective">
              참여
            </a>
            <button
              className="cursor-pointer rounded-full border border-[rgba(45,212,192,0.13)] px-3 py-1 text-[0.75rem] tracking-[0.06em] text-[#7b88a8] transition hover:border-[#2dd4c0] hover:text-[#2dd4c0]"
              type="button"
              onClick={() => props.onLocaleChange("en")}
            >
              KO / EN
            </button>
          </div>
          {props.adminRecoveryLinkLabel.trim() ? (
            <a
              className="rounded-full px-2.5 py-1 text-[0.68rem] tracking-[0.08em] text-[#4d5874] transition hover:text-[#7b88a8]"
              href="/admin-login"
            >
              {props.adminRecoveryLinkLabel}
            </a>
          ) : null}
        </div>
      </nav>

      <section className="relative overflow-hidden px-6 pb-20 pt-16 md:px-8 snap-start">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_55%_45%_at_50%_30%,rgba(45,212,192,0.1)_0%,transparent_70%),radial-gradient(ellipse_35%_25%_at_80%_75%,rgba(245,158,11,0.06)_0%,transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(45,212,192,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,192,0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />

        <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-[1180px] items-center gap-10 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="relative z-10 text-center">
            <p
              className="landing-hero-fade mb-6 text-[clamp(0.9rem,1.6vw,1.1rem)] italic text-[#7b88a8] font-ko-serif"
              style={{ animationDelay: "0s" }}
            >
              배양 결과는 며칠 뒤. 지금은 이 사진만으로 판단해야 합니다.
            </p>

            <h1
              className="landing-hero-fade mx-auto mb-7 max-w-[760px] text-[clamp(1.85rem,4.45vw,3.3rem)] leading-[1.22] tracking-[-0.01em] font-ko-serif"
              style={{ animationDelay: "0.05s" }}
            >
              "이건 세균성일까,
              <br />
              진균성일까…"
              <br />
              <em className="italic text-[#f59e0b]">AI와 상의하는 시간</em>
            </h1>

            <p
              className="landing-hero-fade mx-auto mb-12 max-w-[520px] text-base leading-[1.85] text-[#7b88a8]"
              style={{ animationDelay: "0.13s" }}
            >
              파이썬도, 엑셀 manifest도, 수동 annotation도 필요 없습니다.
              <br />
              K-ERA 앱에 오늘 찍은 사진을 올리면, 함께 판단을 돕습니다.
            </p>

            <div
              className="landing-hero-fade flex flex-wrap justify-center gap-3.5"
              style={{ animationDelay: "0.21s" }}
            >
              <LandingGoogleCta
                buttonClassName={koSecondaryCtaClass}
                googleLaunchPulse={props.googleLaunchPulse}
                onGoogleLaunch={props.onGoogleLaunch}
                pulseClassName="ring-4 ring-[rgba(45,212,192,0.22)]"
                slotClassName="rounded-[8px]"
              >
                {props.authBusy ? props.connectingLabel : "Google 로그인으로 승인 신청"}
              </LandingGoogleCta>
              <a className="inline-block rounded-[8px] border border-[rgba(45,212,192,0.13)] px-7 py-3 text-[0.88rem] tracking-[0.04em] text-[#7b88a8] transition hover:border-[#2dd4c0] hover:text-[#2dd4c0]" href="#features">
                어떻게 작동하나요 →
              </a>
            </div>
          </div>

          <div className="landing-hero-fade relative z-10 lg:mx-auto lg:w-full lg:max-w-[640px]" style={{ animationDelay: "0.17s" }}>
            <div className="relative overflow-hidden rounded-[32px] border border-[rgba(255,255,255,0.14)] bg-[rgba(13,20,38,0.72)] shadow-[0_28px_64px_rgba(6,10,20,0.34)]">
              <Image
                src="/landing/hero-clinic.png"
                alt="외래가 끝난 진료실에서 각막 사진을 검토하는 장면"
                width={1688}
                height={949}
                priority
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
        </div>

        <div className="landing-hero-fade absolute bottom-8 z-10 flex flex-col items-center gap-2 text-[0.68rem] tracking-[0.12em] text-[#3f4b6a]" style={{ animationDelay: "0.42s" }}>
          <div className="h-9 w-px animate-pulse bg-gradient-to-b from-[#3f4b6a] to-transparent" />
          scroll
        </div>
      </section>

      <section className="bg-gradient-to-b from-[#0d0f14] to-[#111420] px-6 pt-14 pb-24 md:px-8" id="origin">
        <div className="mx-auto max-w-[1080px]">
          <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">AI 연구, 안과 임상 의사가 직접 하기에는</div>
          <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
            생각보다 너무 많은 일이 필요했습니다
          </h2>

          <div className="mt-13 grid overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] md:grid-cols-2">
            <div className="relative border-b border-[rgba(45,212,192,0.13)] bg-[rgba(255,255,255,0.016)] p-12 md:border-b-0 md:border-r">
              <div className="pointer-events-none absolute left-7 top-2 text-[9rem] leading-none text-[rgba(45,212,192,0.22)] font-ko-serif">
                "
              </div>
              <p className="relative z-10 text-base leading-[2.05] text-[#7b88a8]">
                처음 AI 연구를 시작할 때,
                <br />
                가장 힘든 건 딥러닝 모델이 아니었습니다.
                <br />
                <br />
                파이썬 환경을 맞추고, 이미지를 정리하고,
                <br />
                ROI를 하나하나 그리다 보면
                <br />
                어느 순간 이렇게 생각하게 됩니다.
                <br />
                <br />
                <strong className="font-medium text-[#e4e8f5]">"이걸 정말 내가 할 수 있는 연구일까?"</strong>
                <br />
                <br />
                논문 코드를 그대로 돌렸는데
                <br />
                결과는 전혀 다르게 나올 때.
                <br />
                <br />
                그리고 무엇보다 —
                <br />
                프라이버시 문제로 <strong className="font-medium text-[#e4e8f5]">그 모든 노력의 결실을
                <br />
                실제 진료에서 쓸 수 없다는 것.</strong>
              </p>
              <p className="mt-7 text-[0.76rem] italic tracking-[0.04em] text-[#3f4b6a]">— K-ERA 개발자 노트, 제주대학교병원 안과</p>
            </div>

            <div className="flex flex-col px-12 pb-8 pt-7">
              <div
                className="landing-reveal mb-5 overflow-hidden rounded-[24px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)]"
                data-reveal=""
                data-reveal-order={0}
              >
                <Image
                  src="/landing/pain%20point%202.png"
                  alt="수작업과 다기관 검증의 어려움을 보여주는 이미지"
                  width={1600}
                  height={900}
                  className="h-auto w-full object-cover"
                />
              </div>
              {koPainItems.map((item, index) => (
                <div
                  key={item.title}
                  className="landing-reveal flex items-start gap-4 border-b border-white/4 py-6 last:border-b-0"
                  data-reveal=""
                  data-reveal-order={index + 1}
                >
                  <div className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-[#f59e0b]" />
                  <div>
                    <div className="mb-1 text-[0.92rem] font-medium">{item.title}</div>
                    <div className="text-[0.85rem] leading-[1.65] text-[#7b88a8]">{item.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0d0f14] px-6 py-24 md:px-8 snap-start" id="about">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-15 md:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] bg-[#121a30]">
              <div className="absolute left-3.5 top-3.5 rounded-full border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.14)] px-2.5 py-1 text-[0.62rem] tracking-[0.1em] text-[#f59e0b]">
                1st Visit · 2026.03.15
              </div>
              <div className="flex h-full flex-col items-center justify-center gap-3.5 p-7">
                <div className="flex items-start justify-center gap-2">
                  {["White", "Fluorescein", "Slit"].map((label) => (
                    <div key={label} className="flex w-[72px] flex-col items-center overflow-hidden rounded-[8px] border border-[rgba(45,212,192,0.13)] bg-black/45 px-1.5 pb-1.5 pt-2">
                      <div className="h-6 w-6 rounded-full bg-[rgba(45,212,192,0.22)]" />
                      <div className="mt-1 text-[0.58rem] tracking-[0.08em] text-[#3f4b6a]">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[0.9rem] text-[#2dd4c0]">↓ Visit 단위 종합 판독</div>
                <div className="rounded-[8px] border border-[#2dd4c0] bg-[rgba(45,212,192,0.22)] px-[18px] py-3 text-center text-[0.76rem] tracking-[0.06em] text-[#2dd4c0]">
                  Fungal Keratitis · 76%
                  <div className="mt-1 text-[0.62rem] opacity-65">MedSAM · Ensemble</div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">K-ERA란</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                AI 연구를
                <br />
                "코딩"이 아니라
                <br />
                <span className="text-[#2dd4c0]">"임상 워크플로"</span>로
              </h2>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                K-ERA는 임상 안과의사가 <strong className="font-medium text-[#2dd4c0]">코드 없이</strong> 각막염 AI 연구를 이어갈 수 있도록 설계된 연구 플랫폼입니다. Google 로그인으로 기관 승인을 신청하고, 승인되면 K-ERA 앱에서 케이스 등록과 이미지 검토를 이어갈 수 있습니다.
              </p>
              <p className="text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                현재 공개 근거는 제주 단일기관 white-light benchmark입니다. 그 위에서 참여 병원이 늘어날수록 더 넓은 external validation이 가능해지고, 문헌 전반에서 기대되는 것처럼 CNN 계열이 더 큰 데이터에서 좋아지는지 직접 검증할 수 있습니다. <strong className="font-medium text-[#e4e8f5]">원본 데이터는 병원 밖으로 나가지 않습니다.</strong>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#111420] px-6 py-24 md:px-8 snap-start" id="features">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">핵심 기능</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                ROI 그리는 데
                <br />
                반나절 쓰셨다면
              </h2>
              <p className="mx-auto max-w-[580px] text-[0.93rem] leading-[1.9] text-[#7b88a8]">box 하나로 ROI 초안을 만들고, 정리와 review 흐름은 K-ERA가 이어받습니다.</p>
            </div>
            <div
              className="landing-reveal justify-self-center w-full max-w-[460px] overflow-hidden rounded-[24px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] shadow-[0_20px_48px_rgba(6,10,20,0.24)] lg:max-w-[320px]"
              data-reveal=""
              data-reveal-order={0}
            >
              <Image
                src={activeFeaturePreview.src}
                alt={activeFeaturePreview.alt}
                width={1200}
                height={1200}
                className="h-auto w-full object-cover"
              />
            </div>
          </div>

          <div className="mt-13 grid overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] md:grid-cols-3">
            {koFeatures.map((feature, index) => (
              <div
                key={feature.title}
                className="landing-reveal relative border-r border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.75)] px-[30px] py-[38px] last:border-r-0 hover:bg-[rgba(13,20,38,0.88)]"
                data-reveal=""
                data-reveal-order={index + 1}
                onMouseEnter={() => {
                  setFeaturePreviewIndex(index + 1);
                  setFeaturePreviewOverride({ src: feature.previewSrc, alt: feature.previewAlt });
                }}
                onMouseLeave={() => setFeaturePreviewOverride(null)}
                onFocus={() => {
                  setFeaturePreviewIndex(index + 1);
                  setFeaturePreviewOverride({ src: feature.previewSrc, alt: feature.previewAlt });
                }}
                onBlur={() => setFeaturePreviewOverride(null)}
                tabIndex={0}
              >
                <div className="mb-3 text-[0.95rem] leading-[1.4] font-medium">{feature.title}</div>
                <div className="text-[0.81rem] leading-[1.8] text-[#7b88a8]">{feature.body}</div>
                <span className="mt-4 inline-block rounded-full bg-[rgba(45,212,192,0.22)] px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.1em] text-[#2dd4c0]">{feature.chip}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0d0f14] px-6 py-24 md:px-8 snap-start" id="federated">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-15 md:grid-cols-2">
            <div className="rounded-2xl border border-[rgba(45,212,192,0.13)] bg-[#121a30] p-9">
              <div className="mb-4 rounded-[10px] border border-[#2dd4c0] bg-[rgba(45,212,192,0.22)] p-[18px] text-center">
                <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[#2dd4c0]">중앙 서버</div>
                <div className="mt-1 text-[0.95rem] font-medium">모델 버전 관리 · 연합 집계</div>
              </div>
              <div className="my-2.5 text-center text-[0.7rem] tracking-[0.05em] text-[#3f4b6a]">↑ 가중치 변화량만 암호화 전송 · 원본 데이터 절대 불가 ↑</div>
              <div className="grid grid-cols-3 gap-2">
                {["병원 A", "병원 B", "병원 C"].map((name) => (
                  <div key={name} className="rounded-[8px] border border-[rgba(45,212,192,0.13)] bg-white/[0.025] px-1.5 py-3 text-center text-[0.7rem] leading-[1.4] text-[#7b88a8]">
                    {name}
                    <br />
                    K-ERA 앱
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-[8px] border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.14)] px-3.5 py-2.5 text-center text-[0.73rem] text-[#f59e0b]">
                원본 이미지 · 환자 ID — 병원 밖 전송 불가
              </div>
            </div>

            <div>
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">데이터 프라이버시</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                원본은 병원 안에 두고,
                <br />
                모델만 함께 키웁니다
              </h2>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">다기관 AI 연구의 가장 큰 벽은 <strong className="font-medium text-[#e4e8f5]">데이터를 꺼낼 수 없다는 것</strong>이었습니다. K-ERA는 raw data 이동 대신 review-first federated workflow를 선택했습니다.</p>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">각 병원이 자체 환경에서 모델을 학습하고, 학습 결과인 <strong className="font-medium text-[#e4e8f5]">가중치 변화량과 검토용 요약 자산만 중앙으로 전달</strong>합니다. 이후 pending review를 거친 뒤에만 집계가 진행됩니다.</p>
              <div className="mt-1 flex flex-col gap-3.5">
                {koFedPoints.map((point) => {
                  const [strong, rest] = point.split(": ");
                  return (
                    <div
                      key={point}
                      className="landing-reveal flex items-start gap-3"
                      data-reveal=""
                      data-reveal-order={koFedPoints.findIndex((candidate) => candidate === point)}
                    >
                      <div className="mt-2 h-[7px] w-[7px] shrink-0 rounded-full bg-[#2dd4c0]" />
                      <div className="text-[0.83rem] leading-[1.7] text-[#7b88a8]">
                        <strong className="font-medium text-[#e4e8f5]">{strong}:</strong> {rest}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 rounded-[12px] border border-[rgba(45,212,192,0.18)] bg-[rgba(45,212,192,0.05)] px-6 py-5">
                <div className="mb-1.5 text-[0.63rem] uppercase tracking-[0.14em] text-[#2dd4c0]">K-ERA 데스크톱 앱</div>
                <p className="mb-2 text-[0.86rem] leading-[1.7] text-[#e4e8f5]">
                  케이스 작성, 이미지 업로드, AI 학습은 모두 병원 PC에 설치된 K-ERA 앱에서 진행합니다. 웹은 로그인과 기관 승인 신청에만 사용됩니다.
                </p>
                <p className="text-[0.78rem] text-[#7b88a8]">
                  기관 승인 완료 후 다운로드 링크가 제공됩니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0d0f14] px-6 py-24 md:px-8 snap-start">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">지금까지</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                제주에서 시작된 benchmark,
                <br />
                더 많은 병원에서
                <br />
                검증할 준비를 합니다
              </h2>
            </div>
            <div className="landing-reveal justify-self-center w-full max-w-[420px] overflow-hidden rounded-[24px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] shadow-[0_20px_48px_rgba(6,10,20,0.24)] lg:max-w-[280px]" data-reveal="" data-reveal-order={0}>
              <Image
                src="/landing/Jeju.png"
                alt="제주를 상징하는 랜딩 이미지"
                width={900}
                height={900}
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
          <div className="mt-12 grid overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] md:grid-cols-4">
            {koStats.map((stat) => (
              <div
                key={stat.number + stat.label}
                className="landing-reveal border-r border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.75)] px-6 py-[38px] text-center last:border-r-0"
                data-reveal=""
                data-reveal-order={koStats.findIndex((candidate) => candidate.number === stat.number) + 1}
              >
                <div className="mb-2 text-[2.5rem] leading-none text-[#2dd4c0] font-ko-serif">
                  {stat.number}
                </div>
                <div className="whitespace-pre-line text-[0.84rem] leading-[1.55] text-[#7b88a8]">{stat.label}</div>
                <div className="mt-3 text-[0.8rem] leading-[1.5] text-[#6b7a96]">{stat.context}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#111420] px-6 py-24 md:px-8 snap-start" id="collective">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">함께하는 병원들</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                내 케이스가
                <br />
                AI를 성장시킵니다
              </h2>
              <p className="mx-auto mb-11 max-w-[580px] text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                한국의 안과의사들이 각자의 케이스를 기여할 때마다,
                <br />
                그것은 동시에 실제 임상 환경에서의 external validation 후보가 됩니다.
                <br />
                현재는 single-center 근거를 다기관 검증으로 넓히는 단계입니다.
                <br />
                논문을 직접 쓰지 않아도, 참여 자체가 연구 데이터와 모델 개선에 기여합니다.
              </p>
            </div>
            <div
              className="landing-reveal justify-self-center w-full max-w-[480px] overflow-hidden rounded-[28px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] shadow-[0_24px_56px_rgba(6,10,20,0.28)] lg:max-w-[360px]"
              data-reveal=""
              data-reveal-order={0}
            >
              <Image
                src="/landing/mass%20intelligence.png"
                alt="집단 지성과 다기관 협력을 상징하는 이미지"
                width={1600}
                height={1200}
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
          <div className="mb-11 mt-11 flex flex-wrap justify-center gap-2.5">
            {hospitals.map((hospital, index) => (
              <div
                key={`${hospital.label}-${index}`}
                className={`landing-reveal flex items-center gap-2 rounded-full border px-4 py-[7px] text-[0.76rem] ${hospital.active ? "border-[#2dd4c0] bg-[rgba(45,212,192,0.22)] text-[#e4e8f5]" : "border-[rgba(45,212,192,0.13)] border-dashed bg-white/[0.02] text-[#7b88a8] opacity-45"}`}
                data-reveal=""
                data-reveal-order={index + 1}
              >
                <span className="h-[5px] w-[5px] rounded-full bg-[#2dd4c0]" />
                {hospital.label}
              </div>
            ))}
          </div>
          <div className="text-center">
            <LandingGoogleCta
              buttonClassName={koSecondaryCtaClass}
              googleLaunchPulse={props.googleLaunchPulse}
              onGoogleLaunch={props.onGoogleLaunch}
              pulseClassName="ring-4 ring-[rgba(45,212,192,0.22)]"
              slotClassName="rounded-[8px]"
            >
              {props.authBusy ? props.connectingLabel : "Google 로그인으로 기관 승인 신청하기 →"}
            </LandingGoogleCta>
            <p className="mt-3.5 text-[0.76rem] text-[#3f4b6a]">① Google 로그인 → 기관 승인 신청 → ② 승인 후 데스크톱 앱 설치 → 케이스 작성</p>
          </div>
        </div>
      </section>

      <section className="bg-[#0d0f14] px-6 py-24 md:px-8 snap-start">
        <div className="mx-auto max-w-[1080px]">
          <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#8a96b0]">자주 묻는 질문</div>
          <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
            궁금한 점이 있으신가요?
          </h2>
          <div className="mt-13 grid overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] md:grid-cols-2">
            {koFaqs.map((faq, index) => (
              <div
                key={faq.q}
                className="landing-reveal border-b border-r border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.75)] px-9 py-8 transition hover:bg-[rgba(45,212,192,0.04)] md:[&:nth-child(2n)]:border-r-0 md:[&:nth-last-child(-n+2)]:border-b-0"
                data-reveal=""
                data-reveal-order={index}
              >
                <div className="mb-2.5 flex items-start gap-2.5 text-[0.88rem] font-medium">
                  <span className="mt-[3px] shrink-0 text-[0.72rem] tracking-[0.06em] text-[#2dd4c0]">Q{index + 1}</span>
                  {faq.q}
                </div>
                <div className="pl-6 text-[0.81rem] leading-[1.75] text-[#7b88a8]">{faq.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[rgba(45,212,192,0.13)] bg-[#0d0f14] px-6 py-[120px] md:px-8 snap-start">
        <div className="mx-auto grid max-w-[1080px] items-center gap-10 lg:grid-cols-2">
          <div className="relative text-center">
            <h2 className="mb-4 text-[clamp(1.7rem,3.2vw,2.6rem)] leading-[1.26] font-ko-serif">
              연구는
              <br />
              거대한 프로젝트가
              <br />
              <em className="italic text-[#2dd4c0]">아닙니다</em>
            </h2>
            <p className="mb-3.5 text-[0.93rem] leading-[2] text-[#7b88a8]">
              오늘 진료한 한 케이스.
              <br />
              그 사진 몇 장이면 충분합니다.
            </p>
            <p className="mb-10 text-[0.97rem] leading-[2] text-[#e4e8f5]">
              배양 결과가 나오기 전,
              <br />
              한 번 더 확인하고 싶을 때.
            </p>
            <LandingGoogleCta
              buttonClassName={koSecondaryCtaClass}
              googleLaunchPulse={props.googleLaunchPulse}
              onGoogleLaunch={props.onGoogleLaunch}
              pulseClassName="ring-4 ring-[rgba(45,212,192,0.22)]"
              slotClassName="rounded-[8px]"
            >
              {props.authBusy ? props.connectingLabel : "Google 로그인으로 승인 신청하기"}
            </LandingGoogleCta>
            <p className="mt-4 text-[0.75rem] text-[#3f4b6a]">한 케이스로 시작하고, 여러 병원이 검증합니다.</p>
          </div>
          <div className="justify-self-center grid w-full max-w-[500px] gap-5 lg:max-w-[360px]">
            <div className="landing-reveal overflow-hidden rounded-[28px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] shadow-[0_24px_56px_rgba(6,10,20,0.28)]" data-reveal="" data-reveal-order={0}>
              <Image
                src="/landing/CTA1.png"
                alt="K-ERA 최종 참여 안내 이미지"
                width={1600}
                height={1200}
                className="h-auto w-full object-cover"
              />
            </div>
            <button
              className="landing-reveal overflow-hidden rounded-[28px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] shadow-[0_24px_56px_rgba(6,10,20,0.28)] transition hover:border-[rgba(45,212,192,0.28)]"
              data-reveal=""
              data-reveal-order={1}
              type="button"
              onClick={props.onGoogleLaunch}
            >
              <Image
                src="/landing/CTA3.png"
                alt="K-ERA 연구 참여를 상징하는 보조 이미지"
                width={1600}
                height={1200}
                className="h-auto w-full object-cover"
              />
            </button>
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center justify-between gap-3 border-t border-[rgba(45,212,192,0.13)] bg-[#0d0f14] px-5 py-7 text-center md:flex-row md:px-12">
        <div className="text-[0.95rem] text-[#2dd4c0] font-ko-serif">
          K<span className="text-[#3f4b6a]">-ERA</span>
        </div>
        <div className="text-[0.73rem] text-[#3f4b6a]">© 2026 K-ERA Project · TinyStar Labs</div>
        <div className="flex gap-5">
          <a className="text-[0.73rem] text-[#3f4b6a] transition hover:text-[#2dd4c0]" href="/privacy">
            개인정보처리방침
          </a>
          <a className="text-[0.73rem] text-[#3f4b6a] transition hover:text-[#2dd4c0]" href="/terms">
            이용약관
          </a>
          <a className="text-[0.73rem] text-[#3f4b6a] transition hover:text-[#2dd4c0]" href="mailto:kera-research@jnuh.ac.kr">
            문의
          </a>
        </div>
      </footer>
    </main>
  );
}
