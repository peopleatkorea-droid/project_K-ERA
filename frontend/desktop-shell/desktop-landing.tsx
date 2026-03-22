"use client";

import { LocaleToggle, pick, useI18n } from "../lib/i18n";

type DesktopLandingScreenProps = {
  setupReady: boolean;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
};

export function DesktopLandingScreen(props: DesktopLandingScreenProps) {
  const { locale } = useI18n();

  const copy = {
    badge: pick(locale, "Hospital-local desktop workspace", "병원 로컬 데스크톱 워크스페이스"),
    statusReady: pick(locale, "Ready for local sign-in", "로컬 로그인 준비 완료"),
    statusSetup: pick(locale, "One-time setup needed", "최초 1회 설정 필요"),
    heroEyebrow: pick(
      locale,
      "Culture results arrive later. Right now, the image is all you have.",
      "배양 결과는 며칠 뒤. 지금은 이 사진만으로 판단해야 합니다."
    ),
    heroTitle: pick(
      locale,
      "“Bacterial, or fungal?” A calmer first screen for the local workspace.",
      "\"이건 세균성일까,\n진균성일까…\"\nAI와 상의하는 시간"
    ),
    heroBody: pick(
      locale,
      "This desktop app opens the hospital-local K-ERA workspace with the same softer landing you used before. Local setup and troubleshooting stay below instead of taking over the first screen.",
      "예전에 쓰던 랜딩 톤을 그대로 가져오고, 설치 정보와 문제 해결 도구는 아래로 내렸습니다. 첫 화면은 병원 로컬 K-ERA 워크스페이스답게 더 부드럽게 시작합니다."
    ),
    primaryAction: pick(locale, "Open local workspace", "로컬 워크스페이스 열기"),
    secondaryAction: pick(locale, "View setup and status", "설정과 상태 보기"),
    cardOneTitle: pick(locale, "Data stays inside the hospital", "데이터는 병원 안에 보관"),
    cardOneBody: pick(
      locale,
      "Images, SQLite data, models, and logs stay on this PC unless your workflow explicitly shares approved outputs.",
      "이미지, SQLite 데이터, 모델, 로그는 이 PC에 보관되고, 승인된 산출물만 워크플로에 따라 공유됩니다."
    ),
    cardTwoTitle: pick(locale, "Built-in local services", "내장 로컬 서비스"),
    cardTwoBody: pick(
      locale,
      "The desktop runtime starts the local app server, worker, and AI sidecar for you after setup.",
      "설정이 끝나면 데스크톱 런타임이 로컬 앱 서버, 워커, AI 사이드카를 직접 시작합니다."
    ),
    cardThreeTitle: pick(locale, "Approved accounts only", "승인된 계정만 사용"),
    cardThreeBody: pick(
      locale,
      "The local workspace opens with approved hospital-local accounts, while central administration remains on the web.",
      "로컬 워크스페이스는 승인된 병원 로컬 계정으로 열리고, 중앙 운영은 웹에서 계속 관리합니다."
    ),
    heroAlt: pick(locale, "A clinician reviewing corneal images in a quiet exam room", "진료실에서 각막 이미지를 검토하는 장면"),
    scrollHint: pick(locale, "scroll", "scroll"),
  };

  const featureCards = [
    { title: copy.cardOneTitle, body: copy.cardOneBody },
    { title: copy.cardTwoTitle, body: copy.cardTwoBody },
    { title: copy.cardThreeTitle, body: copy.cardThreeBody },
  ];

  return (
    <section className="relative overflow-hidden bg-[#0d0f14] text-[#e4e8f5]">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_55%_45%_at_50%_24%,rgba(45,212,192,0.1)_0%,transparent_68%),radial-gradient(ellipse_35%_25%_at_82%_78%,rgba(245,158,11,0.07)_0%,transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(45,212,192,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,192,0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />

      <nav className="relative z-20 flex items-center justify-between border-b border-[rgba(45,212,192,0.13)] bg-[rgba(9,13,24,0.82)] px-5 py-3 backdrop-blur-xl md:px-10 md:py-4">
        <div className="flex items-center gap-3">
          <div className="text-[1.35rem] tracking-[0.04em] text-[#2dd4c0] font-ko-serif">
            K<span className="text-[#7b88a8]">-</span>ERA
          </div>
          <div className="hidden rounded-full border border-[rgba(45,212,192,0.18)] bg-[rgba(45,212,192,0.08)] px-3 py-1 text-[0.68rem] tracking-[0.12em] text-[#9ddfd7] md:block">
            {copy.badge}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`rounded-full border px-3 py-1 text-[0.72rem] font-semibold tracking-[0.08em] ${
              props.setupReady
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                : "border-amber-400/25 bg-amber-400/10 text-amber-100"
            }`}
          >
            {props.setupReady ? copy.statusReady : copy.statusSetup}
          </div>
          <LocaleToggle />
        </div>
      </nav>

      <div className="relative z-10 px-6 pb-18 pt-10 md:px-8 md:pb-24 md:pt-14">
        <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-[1180px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="text-center lg:text-left">
            <p
              className="landing-hero-fade mb-6 text-[clamp(0.9rem,1.6vw,1.1rem)] italic text-[#7b88a8] font-ko-serif"
              style={{ animationDelay: "0s" }}
            >
              {copy.heroEyebrow}
            </p>

            <h1
              className="landing-hero-fade whitespace-pre-line text-[clamp(2rem,4.35vw,3.35rem)] leading-[1.18] tracking-[-0.02em] font-ko-serif"
              style={{ animationDelay: "0.05s" }}
            >
              {copy.heroTitle}
            </h1>

            <p
              className="landing-hero-fade mt-7 max-w-[620px] text-base leading-[1.85] text-[#7b88a8] lg:text-[1.02rem]"
              style={{ animationDelay: "0.13s" }}
            >
              {copy.heroBody}
            </p>

            <div className="landing-hero-fade mt-10 flex flex-wrap justify-center gap-3.5 lg:justify-start" style={{ animationDelay: "0.21s" }}>
              <button
                className="rounded-[10px] border border-[rgba(45,212,192,0.28)] bg-[#24aa9e] px-8 py-3 text-[0.92rem] font-medium tracking-[0.04em] text-[#081116] shadow-[0_10px_24px_rgba(9,13,24,0.32)] transition hover:-translate-y-0.5 hover:border-[rgba(45,212,192,0.38)] hover:bg-[#209d92] hover:shadow-[0_12px_28px_rgba(9,13,24,0.38)]"
                type="button"
                onClick={props.onPrimaryAction}
              >
                {copy.primaryAction}
              </button>
              <button
                className="rounded-[10px] border border-[rgba(45,212,192,0.13)] px-7 py-3 text-[0.88rem] tracking-[0.04em] text-[#7b88a8] transition hover:border-[#2dd4c0] hover:text-[#2dd4c0]"
                type="button"
                onClick={props.onSecondaryAction}
              >
                {copy.secondaryAction}
              </button>
            </div>

            <div className="mt-12 grid gap-3 md:grid-cols-3">
              {featureCards.map((card, index) => (
                <div
                  key={card.title}
                  className="landing-reveal rounded-[22px] border border-[rgba(45,212,192,0.13)] bg-[rgba(13,20,38,0.55)] p-5 text-left shadow-[0_20px_44px_rgba(6,10,20,0.2)] backdrop-blur"
                  data-reveal=""
                  data-reveal-order={index}
                >
                  <div className="mb-2 text-[0.72rem] uppercase tracking-[0.14em] text-[#2dd4c0]">{`0${index + 1}`}</div>
                  <div className="text-base font-semibold text-[#f7f9ff]">{card.title}</div>
                  <p className="mt-2 text-sm leading-7 text-[#8c97b1]">{card.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-hero-fade relative lg:mx-auto lg:w-full lg:max-w-[640px]" style={{ animationDelay: "0.17s" }}>
            <div className="relative overflow-hidden rounded-[32px] border border-[rgba(255,255,255,0.14)] bg-[rgba(13,20,38,0.72)] shadow-[0_28px_64px_rgba(6,10,20,0.34)]">
              <img
                src="./landing/hero-clinic.png"
                alt={copy.heroAlt}
                className="h-auto w-full object-cover"
              />
            </div>
            <div className="absolute inset-x-6 bottom-6 rounded-[22px] border border-[rgba(45,212,192,0.16)] bg-[rgba(9,13,24,0.8)] px-5 py-4 shadow-[0_18px_36px_rgba(6,10,20,0.3)] backdrop-blur">
              <div className="text-[0.7rem] uppercase tracking-[0.14em] text-[#8a96b0]">K-ERA Desktop</div>
              <div className="mt-2 text-[1rem] font-semibold text-[#f7f9ff]">
                {pick(locale, "Local research workspace, softer entry.", "로컬 연구 워크스페이스, 부드러운 첫 진입")}
              </div>
              <div className="mt-2 text-sm leading-6 text-[#8c97b1]">
                {pick(
                  locale,
                  "The app still runs hospital-local services, but it no longer drops every runtime detail on the first screen.",
                  "병원 로컬 서비스를 그대로 운영하되, 첫 화면에서 모든 런타임 정보를 한꺼번에 쏟아내지 않도록 정리했습니다."
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-hero-fade absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-[0.68rem] tracking-[0.12em] text-[#3f4b6a]" style={{ animationDelay: "0.42s" }}>
        <div className="h-9 w-px animate-pulse bg-gradient-to-b from-[#3f4b6a] to-transparent" />
        {copy.scrollHint}
      </div>
    </section>
  );
}
