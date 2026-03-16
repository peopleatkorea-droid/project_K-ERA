"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import type { SiteRecord } from "../../lib/api";

type KoreanLandingViewProps = {
  authBusy: boolean;
  googleLoginLabel: string;
  connectingLabel: string;
  googleLaunchPulse: boolean;
  publicSites: SiteRecord[];
  onGoogleLaunch: () => void;
  onLocaleChange: (locale: "en") => void;
};

const koPainItems = [
  {
    icon: "💻",
    title: "매번 Python 환경 설정부터",
    body: "Anaconda, 라이브러리 충돌, 터미널 에러. 이 과정에서 포기하는 임상의가 너무 많습니다.",
  },
  {
    icon: "✂️",
    title: "이미지 수천 장, 수동 Annotation",
    body: "병변 ROI를 직접 그려야 하는 반복 작업. 연구를 시작하기도 전에 피로가 커집니다.",
  },
  {
    icon: "🗂️",
    title: "데이터 정리와 manifest 작업",
    body: "이미지 이름을 맞추고 메타데이터를 정리하고 CSV를 만드는 일만으로도 연구 준비가 길어집니다.",
  },
  {
    icon: "📊",
    title: "Single-center의 벽",
    body: "데이터를 병원 밖으로 꺼낼 수 없어, 힘들게 만든 AI도 external validation을 받지 못합니다.",
  },
  {
    icon: "🔒",
    title: "논문만 쓰고 쓰지 못하는 AI",
    body: "연구 결과가 쌓여도 실제 진료로 이어지지 못합니다.",
  },
];

const koFeatures = [
  {
    number: "01",
    icon: "🎯",
    title: "MedSAM 기반\n반자동 병변 분할",
    body: "이미지를 올리고 병변 주변에 box만 그리면, MedSAM이 정밀한 ROI segmentation을 자동 생성합니다. 수시간의 수동 annotation이 몇 초로. Grad-CAM으로 AI의 판단 근거도 함께 보여줍니다.",
    chip: "Meta AI MedSAM · 2024",
    previewSrc: "/landing/medSAM.png",
    previewAlt: "MedSAM 기반 반자동 병변 분할을 보여주는 이미지",
  },
  {
    number: "02",
    icon: "👁️",
    title: "Visit 단위\n멀티모달 종합 판독",
    body: "실제 진료처럼 White · Fluorescein · Slit 세 가지 view를 함께 봅니다. 한 방문(Visit)의 이미지를 통합해 판단하므로, 사진 한 장의 빛 번짐에 흔들리지 않습니다. 두 모델이 넓게·집중적으로 나눠 보고 앙상블합니다.",
    chip: "Visit-level Ensemble",
    previewSrc: "/landing/multi_modal.png",
    previewAlt: "Visit 단위 멀티모달 종합 판독을 보여주는 이미지",
  },
  {
    number: "03",
    icon: "🤝",
    title: "Federated Learning\n다기관 협력",
    body: "원본 이미지는 병원 밖으로 나가지 않습니다. 각 병원이 자체 환경에서 학습 후, Weight delta만 암호화해 전달합니다. FedAvg로 집계된 모델은 참여 병원 모두에 배포됩니다.",
    chip: "Privacy-preserving",
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
  "중앙에 올라가는 것: 저해상도 검토용 썸네일(최대 128px), Weight Delta",
  "병원 밖으로 나가지 않는 것: 원본 이미지, 환자 ID, full-size crop, 임상 기록",
  "참여 병원이 늘어날수록: 새로운 병원의 합류 자체가 자연스러운 external validation이 됩니다",
];

const koStats = [
  { number: "77%", label: "단일 기관 초기 모델\n5-fold cross-validation accuracy" },
  { number: "85%+", label: "BK · FK 각 5,000장 규모\n달성 시 예상 accuracy" },
  { number: "3종", label: "White · Fluorescein · Slit\n멀티모달 이미지 지원" },
  { number: "0건", label: "원본 데이터 외부 유출\n(Federated 구조 보장)" },
];

const koFaqs = [
  {
    q: "K-ERA는 AI 모델을 대신 만들어 주나요?",
    a: "아니요. K-ERA의 원칙은 대체가 아니라 보조입니다. 케이스 등록, 병변 분할, 학습 실행 — 반복 작업을 자동화해 드리지만, 판단은 언제나 임상의가 합니다.",
  },
  {
    q: "코딩을 전혀 몰라도 쓸 수 있나요?",
    a: "물론입니다. Python 설치도, CSV 작성도 필요 없습니다. Google 계정으로 로그인 후 웹 UI에서 모든 기능을 사용할 수 있습니다.",
  },
  {
    q: "환자 데이터가 외부로 유출되지 않나요?",
    a: "원본 이미지와 환자 정보는 병원 내부에만 존재합니다. 중앙 서버로는 Weight Delta와 저해상도 썸네일만 전송되며, SHA256 해시와 EXIF 제거로 보안을 강화합니다.",
  },
  {
    q: "참여하면 어떤 이점이 있나요?",
    a: "참여 기관의 케이스는 전국 규모 AI의 external validation 데이터가 되며, 집계된 글로벌 모델의 혜택을 공유받습니다. 각 기관의 참여는 연구 데이터 축적과 모델 개선에 기여합니다.",
  },
  {
    q: "어떤 진단 범주를 지원하나요?",
    a: "현재 Bacterial keratitis vs Fungal keratitis 이진 분류를 중심으로 합니다. DenseNet, ConvNeXt-Tiny, ViT 등 여러 모델 아키텍처를 지원하며 향후 확장 예정입니다.",
  },
  {
    q: "병원 IT 인프라가 복잡해야 하나요?",
    a: "아닙니다. Local Node는 병원 내부 PC 한 대로 구동 가능하도록 설계되었습니다. 설치 스크립트(PowerShell)와 웹 UI로 기술적 장벽을 최소화했습니다.",
  },
];

const koSecondaryCtaClass =
  "inline-block rounded-[8px] border border-[rgba(45,212,192,0.28)] bg-[#24aa9e] px-8 py-3 text-[0.9rem] font-medium tracking-[0.04em] text-[#081116] shadow-[0_10px_24px_rgba(9,13,24,0.32)] transition hover:-translate-y-0.5 hover:border-[rgba(45,212,192,0.38)] hover:bg-[#209d92] hover:shadow-[0_12px_28px_rgba(9,13,24,0.38)]";

export function KoreanLandingView(props: KoreanLandingViewProps) {
  const [featurePreviewIndex, setFeaturePreviewIndex] = useState(0);
  const [featurePreviewOverride, setFeaturePreviewOverride] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const hospitals = [
    ...props.publicSites.slice(0, 5).map((site) => ({ label: site.display_name, active: true })),
    ...Array.from({ length: Math.max(0, 5 - props.publicSites.slice(0, 5).length) }, () => ({
      label: "참여 모집 중",
      active: false,
    })),
  ];

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
    <main className="bg-[#090d18] text-[#e4e8f5] font-ko-sans">
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
              className="cursor-pointer rounded-full border border-[rgba(45,212,192,0.13)] px-3 py-1 text-[0.75rem] tracking-[0.06em] text-[#3f4b6a] transition hover:border-[#2dd4c0] hover:text-[#2dd4c0]"
              type="button"
              onClick={() => props.onLocaleChange("en")}
            >
              KO / EN
            </button>
          </div>
          <a
            className="rounded-full px-2.5 py-1 text-[0.68rem] tracking-[0.08em] text-[#4d5874] transition hover:text-[#7b88a8]"
            href="/admin-login"
          >
            관리자
          </a>
        </div>
      </nav>

      <section className="relative overflow-hidden px-6 pb-20 pt-16 md:px-8">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_55%_45%_at_50%_30%,rgba(45,212,192,0.1)_0%,transparent_70%),radial-gradient(ellipse_35%_25%_at_80%_75%,rgba(245,158,11,0.06)_0%,transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(45,212,192,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,192,0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />

        <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-[1180px] items-center gap-10 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="relative z-10 text-center">
            <p
              className="landing-hero-fade mb-6 text-[clamp(0.9rem,1.6vw,1.1rem)] italic text-[#7b88a8] font-ko-serif"
              style={{ animationDelay: "0s" }}
            >
              외래가 끝난 뒤, 조용해진 진료실. 각막 사진 몇 장이 화면에 떠 있습니다.
            </p>

            <h1
              className="landing-hero-fade mx-auto mb-7 max-w-[760px] text-[clamp(1.85rem,4.45vw,3.3rem)] leading-[1.22] tracking-[-0.01em] font-ko-serif"
              style={{ animationDelay: "0.05s" }}
            >
              "이건 세균성일까,
              <br />
              진균성일까…"
              <br />
              <em className="italic text-[#2dd4c0]">AI와 상의하는 시간</em>
            </h1>

            <p
              className="landing-hero-fade mx-auto mb-12 max-w-[520px] text-base leading-[1.85] text-[#7b88a8]"
              style={{ animationDelay: "0.13s" }}
            >
              파이썬도, 엑셀 manifest도, 수동 annotation도 필요 없습니다.
              <br />
              오늘 찍은 사진을 올리면, K-ERA가 함께 고민합니다.
            </p>

            <div
              className="landing-hero-fade flex flex-wrap justify-center gap-3.5"
              style={{ animationDelay: "0.21s" }}
            >
              <button className={koSecondaryCtaClass} type="button" onClick={props.onGoogleLaunch}>
                연구 참여하기
              </button>
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

      <section className="bg-gradient-to-b from-[#090d18] to-[#0e1426] px-6 py-24 md:px-8" id="origin">
        <div className="mx-auto max-w-[1080px]">
          <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">AI 연구, 안과 임상 의사가 직접 하기에는</div>
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
                몇 달을 쏟아부어 만든 모델이
                <br />
                다른 병원에서는 형편없는 성적을 보일 때의 허탈함.
                <br />
                <br />
                그리고 무엇보다 —
                <br />
                프라이버시 문제로 <strong className="font-medium text-[#e4e8f5]">그 모든 노력의 결실을
                <br />
                실제 진료에서 쓸 수 없다는 것.</strong>
              </p>
              <p className="mt-7 text-[0.76rem] italic tracking-[0.04em] text-[#3f4b6a]">— K-ERA 개발자 노트, 제주대학교병원 안과</p>
              <div className="landing-reveal mt-8 overflow-hidden rounded-[24px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)]" data-reveal="" data-reveal-order={koPainItems.length}>
                <Image
                  src="/landing/pain%20point%201.png"
                  alt="AI 연구 시작 단계의 현실적인 부담을 보여주는 이미지"
                  width={1600}
                  height={900}
                  className="h-auto w-full object-cover"
                />
              </div>
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
              {koPainItems.map((item) => (
                <div
                  key={item.title}
                  className="landing-reveal flex items-start gap-4 border-b border-white/4 py-6 last:border-b-0"
                  data-reveal=""
                  data-reveal-order={koPainItems.findIndex((candidate) => candidate.title === item.title) + 1}
                >
                  <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] bg-[rgba(245,158,11,0.14)] text-base">
                    {item.icon}
                  </div>
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

      <section className="bg-[#090d18] px-6 py-24 md:px-8" id="about">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-15 md:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[rgba(45,212,192,0.13)] bg-[#121a30]">
              <div className="absolute left-3.5 top-3.5 rounded-full border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.14)] px-2.5 py-1 text-[0.62rem] tracking-[0.1em] text-[#f59e0b]">
                1st Visit · 2026.03.15
              </div>
              <div className="flex h-full flex-col items-center justify-center gap-3.5 p-7">
                <div className="flex items-start justify-center gap-2">
                  {[
                    ["👁️", "White"],
                    ["🟢", "Fluorescein"],
                    ["🔵", "Slit"],
                  ].map(([icon, label]) => (
                    <div key={label} className="flex w-[72px] flex-col items-center overflow-hidden rounded-[8px] border border-[rgba(45,212,192,0.13)] bg-black/45 px-1.5 pb-1.5 pt-2">
                      <span className="text-2xl">{icon}</span>
                      <div className="mt-1 text-[0.58rem] tracking-[0.08em] text-[#3f4b6a]">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[1.1rem] text-[#2dd4c0]">↓ Visit 단위 종합 판독</div>
                <div className="rounded-[8px] border border-[#2dd4c0] bg-[rgba(45,212,192,0.22)] px-[18px] py-3 text-center text-[0.76rem] tracking-[0.06em] text-[#2dd4c0]">
                  🦠 Fungal Keratitis · 76% 확률
                  <div className="mt-1 text-[0.62rem] opacity-65">MedSAM ROI 자동 추출 · Ensemble 모델</div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">K-ERA란</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                AI 연구를
                <br />
                "코딩"이 아니라
                <br />
                <span className="text-[#2dd4c0]">"임상 워크플로"</span>로
              </h2>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                K-ERA는 임상 안과의사가 <strong className="font-medium text-[#2dd4c0]">코드 없이</strong> 각막염 AI를 학습·검증·공유할 수 있도록 설계된 연구 플랫폼입니다. Google 계정으로 로그인하면, 사진 업로드부터 AI 분석까지 <strong className="font-medium text-[#e4e8f5]">웹 브라우저 하나</strong>로 처리됩니다.
              </p>
              <p className="text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                오늘 진료한 환자를 등록하는 순간, 그 케이스가 연구 데이터가 됩니다. 참여 병원이 늘어날수록 AI는 더 다양한 임상 환경을 학습합니다. <strong className="font-medium text-[#e4e8f5]">원본 데이터는 절대 병원 밖으로 나가지 않습니다.</strong>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#0e1426] px-6 py-24 md:px-8" id="features">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">핵심 기능</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                수십 시간의 수작업을
                <br />
                클릭 몇 번으로
              </h2>
              <p className="mx-auto max-w-[580px] text-[0.93rem] leading-[1.9] text-[#7b88a8]">반복적이고 기계적인 작업은 K-ERA가 처리합니다. 임상의는 판단에만 집중하면 됩니다.</p>
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
            {koFeatures.map((feature) => (
              <div
                key={feature.number}
                className="landing-reveal relative border-r border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.75)] px-[30px] py-[38px] last:border-r-0 hover:bg-[rgba(13,20,38,0.88)]"
                data-reveal=""
                data-reveal-order={koFeatures.findIndex((candidate) => candidate.number === feature.number) + 1}
                onMouseEnter={() => {
                  setFeaturePreviewIndex(koFeatures.findIndex((candidate) => candidate.number === feature.number) + 1);
                  setFeaturePreviewOverride({ src: feature.previewSrc, alt: feature.previewAlt });
                }}
                onMouseLeave={() => setFeaturePreviewOverride(null)}
                onFocus={() => {
                  setFeaturePreviewIndex(koFeatures.findIndex((candidate) => candidate.number === feature.number) + 1);
                  setFeaturePreviewOverride({ src: feature.previewSrc, alt: feature.previewAlt });
                }}
                onBlur={() => setFeaturePreviewOverride(null)}
                tabIndex={0}
              >
                <div className="mb-[18px] text-[3.2rem] leading-none text-[rgba(45,212,192,0.13)] font-ko-serif">
                  {feature.number}
                </div>
                <span className="mb-[14px] block text-[1.35rem]">{feature.icon}</span>
                <div className="mb-3 whitespace-pre-line text-[0.95rem] leading-[1.4] font-medium">{feature.title}</div>
                <div className="text-[0.81rem] leading-[1.8] text-[#7b88a8]">{feature.body}</div>
                <span className="mt-4 inline-block rounded-full bg-[rgba(45,212,192,0.22)] px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.1em] text-[#2dd4c0]">{feature.chip}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#090d18] px-6 py-24 md:px-8" id="federated">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-15 md:grid-cols-2">
            <div className="rounded-2xl border border-[rgba(45,212,192,0.13)] bg-[#121a30] p-9">
              <div className="mb-4 rounded-[10px] border border-[#2dd4c0] bg-[rgba(45,212,192,0.22)] p-[18px] text-center">
                <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[#2dd4c0]">중앙 Control Plane</div>
                <div className="mt-1 text-[0.95rem] font-medium">모델 버전 관리 · FedAvg 집계</div>
              </div>
              <div className="my-2.5 text-center text-[0.7rem] tracking-[0.05em] text-[#3f4b6a]">↑ Weight Delta만 암호화 전송 · 원본 데이터 절대 불가 ↑</div>
              <div className="grid grid-cols-3 gap-2">
                {["병원 A", "병원 B", "병원 C"].map((name) => (
                  <div key={name} className="rounded-[8px] border border-[rgba(45,212,192,0.13)] bg-white/[0.025] px-1.5 py-3 text-center text-[0.7rem] leading-[1.4] text-[#7b88a8]">
                    <span className="mb-1 block text-[1.15rem]">🏥</span>
                    {name}
                    <br />
                    Local Node
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-[8px] border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.14)] px-3.5 py-2.5 text-center text-[0.73rem] text-[#f59e0b]">
                🔒 원본 이미지 · 환자 ID · 병원 밖 전송 절대 불가
              </div>
            </div>

            <div>
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">데이터 프라이버시</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                데이터는 병원 안에.
                <br />
                지식은 모두와 함께.
              </h2>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">기존 다기관 AI 연구의 가장 큰 벽은 <strong className="font-medium text-[#e4e8f5]">데이터를 꺼낼 수 없다는 것</strong>이었습니다. K-ERA는 다른 방법을 선택했습니다.</p>
              <p className="mb-4 text-[0.93rem] leading-[1.9] text-[#7b88a8]">각 병원이 자체 환경에서 모델을 학습하고, 학습 결과인 <strong className="font-medium text-[#e4e8f5]">Weight Delta만 SHA256 해시와 함께 암호화해 전송</strong>합니다.</p>
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
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[rgba(45,212,192,0.13)] bg-[linear-gradient(135deg,#0e1426_0%,#121a30_100%)] px-6 py-24 text-center md:px-8">
        <div className="mx-auto max-w-[660px]">
          <span className="mb-6 block text-[2.8rem]">☕</span>
          <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">우리가 그리는 장면</div>
          <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
            외래가 정리된 뒤,
            <br />
            커피 한 잔과 함께
          </h2>

          <div className="relative mb-9 mt-2 rounded-2xl border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.75)] px-11 py-10 text-left text-[0.97rem] leading-[2.05] text-[#7b88a8]">
            <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-transparent via-[#2dd4c0] to-transparent" />
            오늘 마지막 환자의 차트를 닫고, 자리에 앉습니다.
            <br />
            컴퓨터 화면에는 각막 사진 몇 장이 떠 있습니다.
            <br />
            <br />
            <em className="not-italic text-[#2dd4c0]">White, Fluorescein, Slit — 세 장의 사진을 함께 봅니다.</em>
            <br />
            병변에 box를 그리면, MedSAM이 ROI를 잡아냅니다.
            <br />
            <br />
            잠시 후, AI가 말합니다:
            <br />
            <strong className="font-medium text-[#e4e8f5]">
              "이 방문의 패턴은 Fungal keratitis와 76% 일치합니다.
              <br />
              유사한 케이스를 함께 보시겠어요?"
            </strong>
            <br />
            <br />
            판단은 여전히 의사가 합니다.
            <br />
            다만 이제는, <em className="not-italic text-[#2dd4c0]">혼자 판단하지 않아도 됩니다.</em>
            <br />
            <br />
            그리고 그 케이스 하나가, 다른 누군가의 AI를 조금 더 강하게 만듭니다.
          </div>
          <button className={koSecondaryCtaClass} type="button" onClick={props.onGoogleLaunch}>
            이 연구에 함께하기
          </button>
        </div>
      </section>

      <section className="bg-[#090d18] px-6 py-24 md:px-8">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">지금까지</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                제주에서 시작해,
                <br />
                한국 전체로
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
                <div className="whitespace-pre-line text-[0.76rem] leading-[1.55] text-[#7b88a8]">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0e1426] px-6 py-24 md:px-8" id="collective">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="text-center">
              <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">함께하는 병원들</div>
              <h2 className="mb-4 text-[clamp(1.55rem,2.8vw,2.3rem)] leading-[1.26] font-ko-serif">
                집단 지성이
                <br />
                만들어 나가는 연구
              </h2>
              <p className="mx-auto mb-11 max-w-[580px] text-[0.93rem] leading-[1.9] text-[#7b88a8]">
                한국의 안과의사들이 각자의 케이스를 기여할 때마다,
                <br />
                그것은 동시에 실제 임상 환경에서의 External Validation이 됩니다.
                <br />
                논문을 직접 쓰지 않아도, 코딩을 몰라도,
                <br />
                참여 자체가 연구 데이터와 모델 개선에 기여합니다.
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
            <button className={koSecondaryCtaClass} type="button" onClick={props.onGoogleLaunch}>
              병원 참여 신청하기 →
            </button>
            <p className="mt-3.5 text-[0.76rem] text-[#3f4b6a]">임상 안과의사라면 누구나 · Google 계정 1개로 시작</p>
          </div>
        </div>
      </section>

      <section className="bg-[#090d18] px-6 py-24 md:px-8">
        <div className="mx-auto max-w-[1080px]">
          <div className="mb-3 text-[0.68rem] uppercase tracking-[0.18em] text-[#2dd4c0]">자주 묻는 질문</div>
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

      <section className="border-t border-[rgba(45,212,192,0.13)] bg-[#090d18] px-6 py-[120px] md:px-8">
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
            <p className="mb-10 text-[0.97rem] leading-[2] text-[#e4e8f5] italic">
              외래가 끝난 뒤, 커피 한 잔을 들고
              <br />
              AI에게 물어보세요. "너는 어떻게 생각해?"
              <br />
              K-ERA는 그 질문에서 시작됩니다.
            </p>
            <button
              className={`${koSecondaryCtaClass} ${props.googleLaunchPulse ? "ring-4 ring-[rgba(45,212,192,0.22)]" : ""}`}
              type="button"
              onClick={props.onGoogleLaunch}
            >
              {props.authBusy ? props.connectingLabel : "Google 로그인하여 연구 참여하기"}
            </button>
            <div className="absolute left-[-9999px] h-px w-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
              <div data-google-slot />
            </div>
            <p className="mt-4 text-[0.75rem] text-[#3f4b6a]">Research begins with one case.</p>
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

      <footer className="flex flex-col items-center justify-between gap-3 border-t border-[rgba(45,212,192,0.13)] bg-[#090d18] px-5 py-7 text-center md:flex-row md:px-12">
        <div className="text-[0.95rem] text-[#2dd4c0] font-ko-serif">
          K<span className="text-[#3f4b6a]">-ERA</span>
        </div>
        <div className="text-[0.73rem] text-[#3f4b6a]">© 2026 K-ERA Project · Jeju National University Hospital</div>
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
