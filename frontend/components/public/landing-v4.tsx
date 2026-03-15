"use client";

import Link from "next/link";
import Script from "next/script";
import type { RefObject } from "react";

import { LocaleToggle, pick, type Locale } from "../../lib/i18n";
import type { SiteRecord } from "../../lib/api";

type LandingV4Props = {
  locale: Locale;
  authBusy: boolean;
  error: string | null;
  googleClientId: string;
  googleButtonRef: RefObject<HTMLDivElement | null>;
  googleLaunchPulse: boolean;
  onGoogleReady: () => void;
  onGoogleLaunch: () => void;
  connectingLabel: string;
  googleLoginLabel: string;
  googleDisabledLabel: string;
  adminRecoveryOnlyLabel: string;
  adminRecoveryLinkLabel: string;
  adminLaunchLinks: Array<{ label: string; href: string }>;
  publicSites: SiteRecord[];
};

export function LandingV4({
  locale,
  authBusy,
  error,
  googleClientId,
  googleButtonRef,
  googleLaunchPulse,
  onGoogleReady,
  onGoogleLaunch,
  connectingLabel,
  googleLoginLabel,
  googleDisabledLabel,
  adminRecoveryOnlyLabel,
  adminRecoveryLinkLabel,
  adminLaunchLinks,
  publicSites,
}: LandingV4Props) {
  const content = {
    navProblem: pick(locale, "Problem", "Problem"),
    navSolution: pick(locale, "Solution", "Solution"),
    navWorkflow: pick(locale, "Workflow", "Workflow"),
    navFeatures: pick(locale, "Features", "Features"),
    navTrust: pick(locale, "Trust", "Trust"),
    navNetwork: pick(locale, "Network", "Network"),
    navFaq: "FAQ",
    heroBadge: pick(locale, "Clinician-friendly AI research platform", "Clinician-friendly AI research platform"),
    heroTitle: pick(locale, "A collaboration platform for infectious keratitis AI research", "감염성 각막염 AI 연구를 위한 협업 플랫폼"),
    heroSceneLead: pick(locale, "After clinic, the room turns quiet.", "외래가 끝난 뒤, 조용해진 진료실."),
    heroSceneBody: pick(
      locale,
      "Looking back at the corneal images from today's patients, have you ever found yourself asking:",
      "오늘 본 환자의 각막 사진을 다시 보며 이렇게 생각해본 적 있나요?"
    ),
    heroSceneQuote: pick(locale, "\"Could this be bacterial... or fungal...?\"", "\"이건 세균성일까… 진균성일까…\""),
    heroBody: pick(
      locale,
      "AI sounds helpful, but when research begins, the same walls appear: Python environments, image annotation, CSV manifests, and external validation. That is where many ideas stop. K-ERA begins at that exact moment.",
      "AI가 도움 될 수 있다는 건 알지만 연구를 시작하려 하면 늘 같은 벽이 있습니다. Python 환경, 이미지 annotation, CSV manifest, external validation. 그래서 많은 연구가 아이디어에서 멈춥니다. K-ERA는 그 순간에서 시작되었습니다."
    ),
    heroPrimary: pick(locale, "Join the research network", "연구 참여하기"),
    heroSecondary: pick(locale, "How does it work?", "어떻게 작동하나요"),
    problemLabel: pick(locale, "Why it was hard", "왜 어려웠나"),
    problemTitle: pick(locale, "AI research was harder than it should have been", "AI 연구, 생각보다 너무 어려웠습니다"),
    problemBody: pick(
      locale,
      "The hardest part of infectious keratitis AI research is not the algorithm. It is the workflow around it.",
      "감염성 각막염 AI 연구에서 가장 어려운 건 알고리즘이 아닙니다. 연구 workflow입니다."
    ),
    solutionLabel: pick(locale, "What changed", "K-ERA란"),
    solutionTitle: pick(locale, "So we changed the question", "그래서 우리는 질문을 바꿨습니다"),
    solutionBody: pick(
      locale,
      "Not how to build a better model first, but how clinicians can do AI research together. K-ERA is a clinician-friendly AI research platform for infectious keratitis. You can start without writing code.",
      "AI 모델을 더 잘 만드는 방법이 아니라 의사들이 함께 AI 연구를 할 수 있는 방법은 없을까. K-ERA는 감염성 각막염 연구를 위한 clinician-friendly AI research platform입니다. 코드를 작성하지 않아도 AI 연구를 시작할 수 있습니다."
    ),
    workflowLabel: pick(locale, "Workflow", "어떻게 시작하나"),
    workflowTitle: pick(locale, "This is how AI research starts", "AI 연구, 이렇게 시작합니다"),
    workflowLine: pick(
      locale,
      "Research does not need to begin as a giant project. One case from today is enough.",
      "연구는 거대한 프로젝트가 아닙니다. 오늘 케이스 하나면 충분합니다."
    ),
    featuresLabel: pick(locale, "Core features", "핵심 기능"),
    featuresTitle: pick(locale, "So clinicians can focus on the research itself", "임상의가 연구에 집중할 수 있도록"),
    trustLabel: pick(locale, "Trust and privacy", "신뢰"),
    trustTitle: pick(locale, "Data stays inside the hospital. Knowledge grows together.", "데이터는 병원 안에. 지식은 함께 성장합니다."),
    trustLine: pick(
      locale,
      "As more hospitals join, the AI receives broader external validation naturally.",
      "참여 병원이 늘어날수록 AI는 자연스럽게 external validation을 받습니다."
    ),
    sharedLabel: pick(locale, "What can be shared", "공유되는 것"),
    privateLabel: pick(locale, "What never leaves", "공유되지 않는 것"),
    networkLabel: pick(locale, "Collective intelligence", "집단 지성"),
    networkTitle: pick(locale, "We believe in collective intelligence", "집단 지성을 믿습니다"),
    networkBody: pick(
      locale,
      "There are thousands of ophthalmologists in Korea, and every hospital holds valuable cases. One person may gather only a small dataset, but together we can make infectious keratitis AI far stronger than it is now.",
      "한국에는 수천 명의 안과 의사가 있습니다. 각 병원에는 수많은 케이스가 있습니다. 한 사람이 모은 데이터는 작을 수 있습니다. 하지만 많은 사람들이 함께한다면 감염성 각막염 AI는 지금보다 훨씬 강해질 것입니다."
    ),
    networkLine: pick(
      locale,
      "You do not need to write code or publish a paper for your participation to become research.",
      "논문을 쓰지 않아도 코딩을 몰라도 참여 자체가 연구가 됩니다."
    ),
    sceneLabel: pick(locale, "The scene we imagine", "감성 장면"),
    sceneTitle: pick(locale, "The scene we are building toward", "우리가 그리는 장면"),
    sceneBody: pick(
      locale,
      "After clinic, you open K-ERA with a cup of coffee. Today's keratitis images are waiting. White, fluorescein, slit. You draw a box and MedSAM finds the ROI. A moment later, AI says: \"This visit pattern matches fungal keratitis at 76%.\" The judgment still belongs to the doctor. But now the doctor does not have to reason alone.",
      "외래가 끝난 뒤 커피 한 잔을 들고 K-ERA를 엽니다. 오늘 본 각막염 환자의 사진이 올라와 있습니다. White, Fluorescein, Slit. 병변에 box를 그리면 MedSAM이 ROI를 잡습니다. 잠시 후 AI가 말합니다. \"이 방문의 패턴은 진균성 각막염과 76% 일치합니다.\" 판단은 여전히 의사가 합니다. 다만 이제는 혼자 판단하지 않아도 됩니다."
    ),
    ctaLabel: pick(locale, "Start together", "지금 시작하기"),
    ctaTitle: pick(locale, "Infectious keratitis AI research can now be done together", "감염성 각막염 AI 연구, 이제 함께 할 수 있습니다"),
    ctaBody: pick(
      locale,
      "No more wrestling alone with Python. No more organizing Excel manifests by hand. A single photo from today's clinic can become the beginning of research.",
      "혼자 Python과 씨름하지 않아도 됩니다. 엑셀 manifest를 정리하지 않아도 됩니다. 오늘 외래에서 찍은 사진 한 장이 연구의 시작이 됩니다."
    ),
    ctaPrimary: pick(locale, "Start now", "지금 시작하기"),
    ctaSecondary: pick(locale, "Hospital onboarding", "병원 참여 문의"),
    faqLabel: "FAQ",
    faqTitle: pick(locale, "A few important questions", "자주 묻는 질문"),
    footerCopy: pick(locale, "© 2026 K-ERA Project · Jeju National University Hospital", "© 2026 K-ERA Project · Jeju National University Hospital"),
    footerContact: pick(locale, "Contact", "문의"),
  };

  const problemCards = [
    {
      tag: "01",
      title: pick(locale, "Python environment setup", "Python 환경 설정"),
      body: pick(
        locale,
        "Library conflicts, environment rebuilds, and terminal errors create a barrier that is too high for many clinicians.",
        "라이브러리 충돌, 환경 재설치, 터미널 오류. 임상의에게 너무 큰 장벽입니다."
      ),
    },
    {
      tag: "02",
      title: pick(locale, "Thousands of images to annotate", "수천 장 이미지 annotation"),
      body: pick(
        locale,
        "Researchers end up drawing ROI boxes, cropping lesions, and organizing datasets by hand.",
        "ROI를 직접 그리고 이미지를 crop하고 데이터를 정리해야 합니다."
      ),
    },
    {
      tag: "03",
      title: pick(locale, "The wall of external validation", "외부 검증의 벽"),
      body: pick(
        locale,
        "A model that performs well in one hospital often drops in performance elsewhere.",
        "한 병원에서 잘 작동하던 모델이 다른 병원에서는 성능이 떨어집니다."
      ),
    },
    {
      tag: "04",
      title: pick(locale, "Data cannot simply be shared", "데이터 공유의 문제"),
      body: pick(
        locale,
        "Patient data cannot leave the hospital, so too many studies remain stuck at single-center scope.",
        "환자 데이터는 병원 밖으로 나갈 수 없습니다. 그래서 많은 연구가 single-center에 머뭅니다."
      ),
    },
  ];

  const workflowSteps = [
    {
      number: "01",
      title: pick(locale, "Register a patient", "환자 등록"),
      body: pick(locale, "Turn today's patient into a structured case.", "오늘 진료한 환자를 케이스로 등록합니다."),
    },
    {
      number: "02",
      title: pick(locale, "Upload images", "사진 업로드"),
      body: pick(locale, "White, fluorescein, and slit images move into one visit.", "White, Fluorescein, Slit image를 하나의 방문으로 올립니다."),
    },
    {
      number: "03",
      title: pick(locale, "Run AI analysis", "AI 분석"),
      body: pick(locale, "MedSAM automatically finds the corneal ROI.", "MedSAM이 자동으로 각막 ROI를 찾습니다."),
    },
    {
      number: "04",
      title: pick(locale, "Create research data", "연구 데이터 생성"),
      body: pick(locale, "One case becomes reusable research data.", "한 케이스가 연구 데이터가 됩니다."),
    },
  ];

  const featureCards = [
    {
      tag: "MedSAM ROI",
      title: pick(locale, "Automatic ROI with MedSAM", "MedSAM 기반 자동 ROI"),
      body: pick(
        locale,
        "Draw a loose box around the lesion and MedSAM generates the segmentation in seconds.",
        "병변 주변에 box를 그리면 MedSAM이 segmentation을 생성합니다. 수시간의 annotation 작업이 몇 초로 줄어듭니다."
      ),
    },
    {
      tag: "Visit multimodal",
      title: pick(locale, "Visit-level multimodal analysis", "Visit 단위 멀티모달 분석"),
      body: pick(
        locale,
        "White, fluorescein, and slit images are reviewed together for a more stable interpretation.",
        "White, Fluorescein, Slit 여러 이미지를 함께 분석해 더 안정적인 판독을 합니다."
      ),
    },
    {
      tag: "Federated learning",
      title: pick(locale, "Federated collaboration", "연합학습 기반 협력"),
      body: pick(
        locale,
        "Each hospital keeps local data while sharing only model updates.",
        "각 병원은 로컬 데이터를 유지합니다. 공유되는 것은 model update only 입니다."
      ),
    },
  ];

  const sharedItems = [
    pick(locale, "Model weight delta", "model weight delta"),
    pick(locale, "Low-resolution review thumbnails", "저해상도 검토용 썸네일"),
  ];

  const privateItems = [
    pick(locale, "Original images", "원본 이미지"),
    pick(locale, "Patient ID", "환자 ID"),
    pick(locale, "Full clinical source records", "임상 원문 데이터"),
  ];

  const faqItems = [
    {
      q: pick(locale, "Does K-ERA replace diagnosis?", "K-ERA는 진단을 대신하나요?"),
      a: pick(locale, "No. It supports research review and collaborative interpretation, but the final judgment remains with the clinician.", "아니요. 연구 검토와 협업 판단을 돕는 플랫폼이며 최종 판단은 임상의에게 있습니다."),
    },
    {
      q: pick(locale, "Is the data safe?", "데이터는 안전한가요?"),
      a: pick(locale, "Yes. The system is designed so original images and patient identifiers remain inside each hospital.", "네. 원본 이미지와 환자 식별자는 각 병원 내부에 남도록 설계되어 있습니다."),
    },
    {
      q: pick(locale, "Do I need coding?", "코딩이 필요한가요?"),
      a: pick(locale, "No. K-ERA is built so clinicians can start AI research from the browser without writing code.", "아니요. 브라우저에서 바로 시작할 수 있도록 설계되어 있어 코드를 작성하지 않아도 됩니다."),
    },
    {
      q: pick(locale, "Can multiple hospitals participate?", "여러 병원이 참여할 수 있나요?"),
      a: pick(locale, "Yes. That is one of the core ideas behind K-ERA and its federated collaboration design.", "네. 다기관 참여와 연합학습 기반 협력이 K-ERA의 핵심 설계 중 하나입니다."),
    },
  ];

  const hospitalChips = [
    ...publicSites.slice(0, 4).map((site) => ({ label: site.display_name, active: true })),
    ...Array.from({ length: Math.max(0, 4 - publicSites.slice(0, 4).length) }, () => ({
      label: pick(locale, "Recruiting", "참여 모집 중"),
      active: false,
    })),
  ];

  return (
    <main className="shell landing-v4-page">
      {googleClientId ? <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={onGoogleReady} /> : null}

      <header className="landing-v4-bar">
        <Link href="/" className="landing-v4-logo">
          K-ERA
        </Link>
        <nav className="landing-v4-nav" aria-label={pick(locale, "Landing sections", "랜딩 섹션")}>
          <a href="#problem">{content.navProblem}</a>
          <a href="#solution">{content.navSolution}</a>
          <a href="#workflow">{content.navWorkflow}</a>
          <a href="#features">{content.navFeatures}</a>
          <a href="#trust">{content.navTrust}</a>
          <a href="#network">{content.navNetwork}</a>
          <a href="#faq">{content.navFaq}</a>
        </nav>
        <LocaleToggle />
      </header>

      <section className="landing-v4-hero">
        <div className="landing-v4-container landing-v4-hero-grid">
          <div className="landing-v4-hero-copy">
            <div className="landing-v4-badge">{content.heroBadge}</div>
            <h1>{content.heroTitle}</h1>
            <div className="landing-v4-hero-scene">
              <p>{content.heroSceneLead}</p>
              <p>{content.heroSceneBody}</p>
              <strong>{content.heroSceneQuote}</strong>
            </div>
            <p className="landing-v4-lead">{content.heroBody}</p>
            <div className="landing-v4-hero-pills">
              <span>Python environment</span>
              <span>Image annotation</span>
              <span>CSV manifest</span>
              <span>External validation</span>
            </div>
            <div className="landing-v4-actions">
              <button className="landing-v4-primary" type="button" onClick={onGoogleLaunch} disabled={authBusy}>
                {authBusy ? connectingLabel : content.heroPrimary}
              </button>
              <a href="#workflow" className="landing-v4-secondary">
                {content.heroSecondary}
              </a>
            </div>
          </div>
          <div className="landing-v4-hero-panel">
            <div className="landing-v4-panel-kicker">K-ERA</div>
            <div className="landing-v4-hero-stack">
              <div className="landing-v4-mini-card">
                <strong>{pick(locale, "Case-centered research", "케이스 중심 연구")}</strong>
                <p>{pick(locale, "Start from one visit, not from infrastructure.", "인프라가 아니라 환자 한 케이스에서 시작합니다.")}</p>
              </div>
              <div className="landing-v4-mini-card">
                <strong>{pick(locale, "Clinician-friendly workflow", "의사 친화적 워크플로")}</strong>
                <p>{pick(locale, "Registration, upload, ROI, validation, contribution.", "등록, 업로드, ROI, 검증, 기여를 한 흐름으로 묶었습니다.")}</p>
              </div>
              <div className="landing-v4-mini-card">
                <strong>{pick(locale, "Multi-center growth", "다기관 확장")}</strong>
                <p>{pick(locale, "Hospitals can collaborate without exporting raw data.", "원본 데이터를 내보내지 않고도 병원이 함께 연구할 수 있습니다.")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-v4-section" id="problem">
        <div className="landing-v4-container">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.problemLabel}</div>
            <h2>{content.problemTitle}</h2>
            <p>{content.problemBody}</p>
          </div>
          <div className="landing-v4-problem-grid">
            {problemCards.map((item) => (
              <article key={item.tag} className="landing-v4-problem-card">
                <div className="landing-v4-card-tag">{item.tag}</div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-v4-section landing-v4-solution" id="solution">
        <div className="landing-v4-container landing-v4-solution-grid">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.solutionLabel}</div>
            <h2>{content.solutionTitle}</h2>
            <p>{content.solutionBody}</p>
          </div>
          <div className="landing-v4-solution-card">
            <div className="landing-v4-definition-kicker">K-ERA</div>
            <p>{pick(locale, "A clinician-friendly AI research platform for infectious keratitis", "감염성 각막염 연구를 위한 clinician-friendly AI research platform")}</p>
            <span>{pick(locale, "No code required to begin the workflow.", "코드를 작성하지 않아도 연구 workflow를 시작할 수 있습니다.")}</span>
          </div>
        </div>
      </section>

      <section className="landing-v4-section" id="workflow">
        <div className="landing-v4-container">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.workflowLabel}</div>
            <h2>{content.workflowTitle}</h2>
          </div>
          <div className="landing-v4-workflow-grid">
            {workflowSteps.map((item) => (
              <article key={item.number} className="landing-v4-step-card">
                <div className="landing-v4-step-number">{item.number}</div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <p className="landing-v4-keyline">{content.workflowLine}</p>
        </div>
      </section>

      <section className="landing-v4-section landing-v4-features" id="features">
        <div className="landing-v4-container">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.featuresLabel}</div>
            <h2>{content.featuresTitle}</h2>
          </div>
          <div className="landing-v4-feature-grid">
            {featureCards.map((item) => (
              <article key={item.tag} className="landing-v4-feature-card">
                <div className="landing-v4-card-tag">{item.tag}</div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-v4-section" id="trust">
        <div className="landing-v4-container landing-v4-trust-grid">
          <div>
            <div className="landing-v4-section-head">
              <div className="landing-v4-label">{content.trustLabel}</div>
              <h2>{content.trustTitle}</h2>
              <p>{content.trustLine}</p>
            </div>
            <div className="landing-v4-trust-columns">
              <article className="landing-v4-rule-card">
                <strong>{content.sharedLabel}</strong>
                <ul>
                  {sharedItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
              <article className="landing-v4-rule-card">
                <strong>{content.privateLabel}</strong>
                <ul>
                  {privateItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            </div>
          </div>
          <div className="landing-v4-diagram">
            <div className="landing-v4-diagram-core">Central Control Plane</div>
            <div className="landing-v4-diagram-arrow" />
            <div className="landing-v4-diagram-nodes">
              {["Hospital A", "Hospital B", "Hospital C"].map((node) => (
                <div key={node} className="landing-v4-node">
                  {pick(locale, node, node.replace("Hospital", "병원"))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-v4-section landing-v4-network" id="network">
        <div className="landing-v4-container">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.networkLabel}</div>
            <h2>{content.networkTitle}</h2>
            <p>{content.networkBody}</p>
          </div>
          <div className="landing-v4-network-row">
            {hospitalChips.map((site, index) => (
              <div key={`${site.label}-${index}`} className={`landing-v4-chip${site.active ? " is-active" : ""}`}>
                {site.label}
              </div>
            ))}
          </div>
          <p className="landing-v4-keyline">{content.networkLine}</p>
        </div>
      </section>

      <section className="landing-v4-section landing-v4-scene">
        <div className="landing-v4-container landing-v4-scene-grid">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.sceneLabel}</div>
            <h2>{content.sceneTitle}</h2>
            <p>{content.sceneBody}</p>
          </div>
          <div className="landing-v4-scene-card">
            <div className="landing-v4-scene-images">
              <span>White</span>
              <span>Fluorescein</span>
              <span>Slit</span>
            </div>
            <div className="landing-v4-scene-quote">
              {pick(locale, "\"This visit pattern matches fungal keratitis at 76%.\"", "\"이 방문의 패턴은 진균성 각막염과 76% 일치합니다.\"")}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-v4-section landing-v4-cta" id="cta">
        <div className="landing-v4-container landing-v4-cta-grid">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.ctaLabel}</div>
            <h2>{content.ctaTitle}</h2>
            <p>{content.ctaBody}</p>
          </div>
          <aside className={`landing-v4-auth-card${googleLaunchPulse ? " is-highlighted" : ""}`}>
            <div className="landing-v4-auth-head">
              <div>
                <div className="landing-v4-card-tag">{googleLoginLabel}</div>
                <h3>{content.ctaPrimary}</h3>
              </div>
              <a href="mailto:kera-research@jnuh.ac.kr" className="landing-v4-inline-link">
                {content.ctaSecondary}
              </a>
            </div>
            {googleClientId ? (
              <div className="landing-v4-google-wrap">
                <div className="field">
                  <label>{googleLoginLabel}</label>
                  <div ref={googleButtonRef} className="google-button-slot" />
                </div>
              </div>
            ) : (
              <div className="empty">{googleDisabledLabel}</div>
            )}
            {error ? <div className="error">{error}</div> : null}
            <div className="divider-line">{adminRecoveryOnlyLabel}</div>
            <div className="landing-v4-auth-actions">
              <button className="landing-v4-primary" type="button" onClick={onGoogleLaunch} disabled={authBusy}>
                {authBusy ? connectingLabel : content.ctaPrimary}
              </button>
              <Link href="/admin-login" className="landing-v4-secondary landing-v4-secondary-link">
                {adminRecoveryLinkLabel}
              </Link>
            </div>
            <div className="landing-v4-admin-links">
              {adminLaunchLinks.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="landing-v4-section" id="faq">
        <div className="landing-v4-container">
          <div className="landing-v4-section-head">
            <div className="landing-v4-label">{content.faqLabel}</div>
            <h2>{content.faqTitle}</h2>
          </div>
          <div className="landing-v4-faq-grid">
            {faqItems.map((item, index) => (
              <article key={item.q} className="landing-v4-faq-card">
                <div className="landing-v4-faq-q">{`Q${index + 1}`}</div>
                <strong>{item.q}</strong>
                <p>{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="landing-v4-footer">
        <div>K-ERA</div>
        <div>{content.footerCopy}</div>
        <a href="mailto:kera-research@jnuh.ac.kr">{content.footerContact}</a>
      </footer>
    </main>
  );
}
