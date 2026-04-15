import type { SiteRecord } from "../../lib/api";
import { getSiteDisplayName } from "../../lib/site-labels";
import { LandingGoogleCta } from "./landing-google-cta";

type EnglishLandingViewProps = {
  authBusy: boolean;
  googleLoginLabel: string;
  connectingLabel: string;
  googleLaunchPulse: boolean;
  adminRecoveryLinkLabel: string;
  adminLaunchLinks: Array<{ label: string; href: string }>;
  publicSites: SiteRecord[];
  onGoogleLaunch: () => void;
  onLocaleChange: (locale: "ko") => void;
};

const enStats = [
  {
    number: "101",
    label: "Patients in the founding single-center feasibility cohort.",
  },
  {
    number: "258",
    label: "Culture-confirmed visits evaluated with patient-disjoint 5-fold validation.",
  },
  {
    number: "658",
    label: "White-light slit-lamp images in the current published benchmark.",
  },
  {
    number: "0.677",
    label: "Best visit-level AUROC in the current leakage-aware benchmark.",
  },
];

const enAtGlance = [
  {
    label: "Platform type",
    body: "Clinician-facing research platform with a federated validation workflow.",
  },
  {
    label: "Workflow",
    body: "Web approval first, then desktop case work and local training on a hospital PC.",
  },
  {
    label: "Focus disease",
    body: "Infectious keratitis, with bacterial-versus-fungal differentiation as the current public benchmark task.",
  },
  {
    label: "Data boundary",
    body: "Raw images and patient identifiers stay inside each hospital.",
  },
];

const enWhyItMatters = [
  {
    label: "Clinical reality",
    title: "The decision is time-sensitive",
    body: "Bacterial and fungal keratitis often overlap visually early on, yet treatment direction can diverge quickly and delay can cost vision.",
  },
  {
    label: "Evidence gap",
    title: "Internal benchmarks do not solve external validation",
    body: "Most keratitis AI work still depends on single-site evidence. The real bottleneck is building broader validation under real hospital variation.",
  },
  {
    label: "Operational barrier",
    title: "Governance is part of the model problem",
    body: "Hospitals need a way to review, validate, and contribute cases without exporting raw patient data. That workflow gap is what K-ERA is designed to close.",
  },
];

const enWorkflow = [
  {
    step: "Step 01",
    title: "Sign in. Request access.",
    body: "Sign in with Google on this website to request institutional approval. The web portal is for account management and hospital access only — patient images never reach a web server.",
  },
  {
    step: "Step 02",
    title: "Install the desktop app. Upload images.",
    body: "After approval, install the K-ERA desktop app on a hospital PC. Upload white-light, fluorescein, and slit images per visit. The current published benchmark is white-light only.",
  },
  {
    step: "Step 03",
    title: "Draw the lesion box.",
    body: "Draw a loose box around the lesion. K-ERA runs MedSAM to refine it into ROI previews and lesion crops. No manual annotation pipeline required.",
  },
  {
    step: "Step 04",
    title: "Run a local training round.",
    body: "Approved sites trigger image-level or visit-level training from the desktop app. Weight deltas go to central review before aggregation — raw data stays on-site.",
  },
];

const enWorkingRails = [
  {
    tag: "Lesion preparation",
    title: "MedSAM-assisted ROI workflow",
    body: "Draw a box around the lesion. K-ERA runs MedSAM to refine it into a cornea mask and lesion crop — reducing manual preprocessing while keeping the clinician in the loop.",
    detail:
      "The current benchmark used manual lesion prompts. The desktop app operationalizes the same workflow for routine clinical cases.",
  },
  {
    tag: "Case assessment",
    title: "AI inference and similar case retrieval",
    body: "The desktop app returns a visit-level prediction with confidence percentage, GradCAM activation, and multi-model ensemble breakdown. A separate DINO retrieval rail surfaces the most similar cases from the research corpus — both are working features today.",
    detail:
      "Inference runs locally on the hospital PC. Retrieval queries the central embedding index. The published benchmark is white-light; the app already stores white-light, fluorescein, and slit views.",
  },
  {
    tag: "Federated training",
    title: "Review-gated aggregation across hospitals",
    body: "Approved sites trigger local image-level or visit-level training rounds from the desktop app. Weight deltas go to central review before FedAvg aggregation — no blind automatic merging.",
    detail:
      "The full training pipeline is implemented and tested. Active multi-site rounds begin as additional hospitals join beyond the founding site.",
  },
];

const enParticipationBenefits = [
  "Co-authorship on multi-site validation publications, per ICMJE criteria, agreed in advance of each submission.",
  "Access to the K-ERA AI inference model and confidence outputs for enrolled cases.",
  "Similar-case retrieval across the shared research corpus via the DINO embedding index.",
  "Federated weight updates distributed to approved nodes after central review.",
];

const enGovernance = [
  {
    label: "IRB",
    body: "Founding site (JNUH) IRB-approved. Each participating site obtains its own institutional IRB approval prior to case enrollment — K-ERA provides protocol documentation on request.",
  },
  {
    label: "Authorship",
    body: "Contributing sites are included in multi-site publications per ICMJE criteria. Authorship scope and order are agreed upon in writing before each submission.",
  },
  {
    label: "Data flow",
    body: "Raw images and identifiers never leave the site. The central server receives only reviewed weight deltas, de-identified metadata, and low-resolution thumbnails.",
  },
];

const enPrimaryCtaClass =
  "rounded-[4px] bg-[#1a5fa8] px-[22px] py-2.5 text-[0.82rem] tracking-[0.03em] text-white transition hover:bg-[#144e94] active:scale-[0.97] active:translate-y-0";

const enNavCtaClass =
  "rounded-[4px] bg-[#1a5fa8] px-5 py-2 text-[0.78rem] tracking-[0.03em] text-white transition hover:bg-[#144e94] active:scale-[0.97] active:translate-y-0";

function getEnglishSiteLabel(site: SiteRecord): string {
  const label = getSiteDisplayName(site);
  if (label === "제주대학교병원" || label === "제주대병원") {
    return "Jeju National University Hospital";
  }
  return label;
}

export function EnglishLandingView(props: EnglishLandingViewProps) {
  const activeInstitutions = props.publicSites.slice(0, 5).map((site) => ({
    label: getEnglishSiteLabel(site),
    active: true,
  }));
  const hasActiveInstitutions = activeInstitutions.length > 0;

  return (
    <main className="bg-white text-[#111218] font-alt-sans">
      <div className="flex items-center justify-between bg-[#1a5fa8] px-5 py-1.5 md:px-12">
        <div className="text-[0.65rem] uppercase tracking-[0.14em] text-white/65 font-mono-alt">
          K-ERA · Infectious Keratitis AI Research Network
        </div>
        <div className="flex overflow-hidden rounded-[4px] border border-white/30">
          <button className="bg-white/15 px-3.5 py-1 text-[0.63rem] tracking-[0.1em] text-white font-mono-alt" type="button">
            EN
          </button>
          <button
            className="border-l border-white/25 px-3.5 py-1 text-[0.63rem] tracking-[0.1em] text-white/80 transition hover:bg-white/10 hover:text-white font-mono-alt"
            type="button"
            onClick={() => props.onLocaleChange("ko")}
          >
            한국어
          </button>
        </div>
      </div>

      <nav className="sticky top-0 z-40 flex items-center justify-between border-b border-[#d6d9e4] bg-white px-5 py-3 md:px-12">
        <div className="text-[1.4rem] font-semibold tracking-[0.04em] font-editorial">
          K<span className="text-[#1a5fa8]">-ERA</span>
        </div>
        <div className="hidden items-center gap-7 md:flex">
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#evidence">
            Evidence
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#why-it-matters">
            Why It Matters
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#how-it-works">
            How It Works
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#why-federated">
            Why Federated
          </a>
        </div>
        <LandingGoogleCta
          buttonClassName={enNavCtaClass}
          googleLaunchPulse={props.googleLaunchPulse}
          onGoogleLaunch={props.onGoogleLaunch}
          pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
          slotClassName="rounded-[4px]"
        >
          {props.authBusy ? props.connectingLabel : "Apply to join"}
        </LandingGoogleCta>
      </nav>

      <section className="border-b border-[#d6d9e4] px-6 pb-16 pt-[72px] md:px-8">
        <div className="mx-auto grid max-w-[900px] gap-15 md:grid-cols-[1fr_300px]">
          <div className="text-center md:text-center">
            <div className="mb-6 flex items-center justify-center gap-2.5 text-[0.63rem] uppercase tracking-[0.16em] text-[#7c8095] font-mono-alt">
              <span className="h-px w-5 bg-[#d6d9e4]" />
              Infectious keratitis · AI research platform
            </div>
            <h1 className="mb-6 text-[clamp(1.9rem,3.8vw,3rem)] leading-[1.22] tracking-[-0.015em] font-editorial">
              Federated keratitis AI research.
              <br />
              <em className="italic text-[#1a5fa8]">From one founding cohort to a multi-site clinical network.</em>
            </h1>
            <div className="mx-auto mb-8 max-w-[500px] text-[0.95rem] leading-[1.85] text-[#393c4a]">
              <p>K-ERA is a governed research platform for infectious keratitis AI — built from the start for federated validation across hospitals, without moving raw patient data.</p>
              <p className="mt-2.5">Apply on the web, install the desktop app on a hospital PC, and contribute local cases to a growing multi-site validation corpus.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              <LandingGoogleCta
                buttonClassName={enPrimaryCtaClass}
                googleLaunchPulse={props.googleLaunchPulse}
                onGoogleLaunch={props.onGoogleLaunch}
                pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
                slotClassName="rounded-[4px]"
              >
                {props.authBusy ? props.connectingLabel : "Apply with Google"}
              </LandingGoogleCta>
              <a className="rounded-[4px] border border-[#d6d9e4] px-5 py-2.5 text-[0.82rem] text-[#393c4a] transition hover:border-[#1a5fa8] hover:text-[#1a5fa8]" href="#evidence">
                Read more ↓
              </a>
            </div>
            <div className="mt-4 text-[0.74rem] text-[#7c8095]">
              1. Sign in on the web → 2. Get approved → 3. Install the desktop app → 4. Start local case work
            </div>
          </div>

          <div className="border-t border-[#d6d9e4] pt-6 text-center md:border-t-0 md:border-l md:pl-7 md:pt-0 md:text-center">
            {enAtGlance.map((item, index) => (
              <div key={item.label} className={index < enAtGlance.length - 1 ? "mb-5" : ""}>
                <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                  {item.label}
                </div>
                <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">{item.body}</div>
              </div>
            ))}
            <div className="my-[18px] h-px bg-[#eceef5]" />
            <div>
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Principal Investigator
              </div>
              <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">
                Jinho Jeong, M.D., Ph.D.
                <br />
                <span className="text-[0.75rem] text-[#7c8095]">Dept. of Ophthalmology · Jeju National University Hospital</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-white px-6 py-20 md:px-8" id="evidence">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            Current Evidence
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            The founding evidence.
            <br />
            One site. Where the network begins.
          </h2>
          <div className="max-w-[680px] text-[0.92rem] leading-[1.88] text-[#393c4a]">
            <p>The public benchmark is intentionally strict: white-light images only, patient-disjoint evaluation, visit-level prediction, and leakage-aware controls.</p>
            <p className="mt-3">A single-center feasibility result tells you what is possible. Multi-site validation is what makes that evidence credible across institutions. That is the gap K-ERA is designed to close.</p>
          </div>
          <div className="mt-12 grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-4">
            {enStats.map((stat) => (
              <div key={stat.number + stat.label} className="border-r border-[#d6d9e4] bg-[#f7f8fc] px-6 py-7 last:border-r-0">
                <div className="text-[2.2rem] leading-none text-[#1a5fa8] font-editorial">{stat.number}</div>
                <div className="mt-2 text-[0.76rem] leading-[1.6] text-[#7c8095]">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[0.72rem] text-[#7c8095] font-mono-alt">
            Manuscript under peer review · Founding cohort: Dept. of Ophthalmology, Jeju National University Hospital
          </div>
        </div>
      </section>

      <section className="bg-[#1a5fa8] px-6 py-20 text-white md:px-8" id="why-it-matters">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-white/50 font-mono-alt">
            Why This Matters
            <span className="h-px w-8 bg-white/15" />
          </div>
          <h2 className="mb-7 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Urgent decisions.
            <br />
            Thin external evidence.
            <br />
            <em className="italic text-white/65">A workflow problem as much as a model problem.</em>
          </h2>
          <div className="mb-11 max-w-[560px] text-[0.95rem] leading-[1.85] text-white/78">
            <p>Infectious keratitis remains one of the leading causes of preventable corneal blindness worldwide. Bacterial and fungal keratitis can present with overlapping features, making early differential diagnosis difficult even for experienced clinicians.</p>
            <p className="mt-2.5">What is missing is not another internal demo. It is a governed way for hospitals to build broader validation cohorts under real privacy constraints.</p>
          </div>
          <div className="grid overflow-hidden rounded-[6px] border border-white/14 md:grid-cols-3">
            {enWhyItMatters.map((item) => (
              <div key={item.label} className="border-r border-white/10 bg-white/6 px-[22px] py-[26px] last:border-r-0">
                <div className="mb-2.5 text-[0.6rem] uppercase tracking-[0.14em] text-white/38 font-mono-alt">{item.label}</div>
                <div className="mb-2 text-[1.05rem] leading-[1.3] text-white font-editorial">{item.title}</div>
                <div className="text-[0.79rem] leading-[1.72] text-white/63">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-[#f7f8fc] px-6 py-20 md:px-8" id="how-it-works">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            How It Works — Workflow &amp; Technology
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Approval on the web.
            <br />
            Case work on the desktop.
            <br />
            Review stays in the loop.
          </h2>
          <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Case authoring, image upload, and AI assessment all run from the K-ERA desktop app installed on a hospital PC. The web portal handles account approval only — patient images never reach a web server. This is a deliberate security boundary, not a technical limitation.</p>
          <div className="mt-11 grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-4">
            {enWorkflow.map((item) => (
              <div key={item.step} className="border-r border-[#d6d9e4] bg-white px-5 py-[26px] last:border-r-0">
                <div className="mb-2 text-[0.6rem] tracking-[0.12em] text-[#1a5fa8] font-mono-alt">{item.step}</div>
                <div className="mb-2 text-[0.88rem] font-medium">{item.title}</div>
                <div className="text-[0.77rem] leading-[1.65] text-[#7c8095]">{item.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-14 mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            Platform capabilities
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <div className="grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-3">
            {enWorkingRails.map((item) => (
              <div key={item.tag} className="border-r border-[#d6d9e4] bg-white px-6 py-7 last:border-r-0">
                <span className="mb-3 inline-block rounded-[3px] bg-[rgba(26,95,168,0.08)] px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em] text-[#1a5fa8]">{item.tag}</span>
                <div className="mb-2 text-[0.92rem] font-medium leading-[1.35]">{item.title}</div>
                <div className="text-[0.79rem] leading-[1.75] text-[#393c4a]">{item.body}</div>
                <div className="mt-3 border-t border-[#d6d9e4] pt-3 text-[0.74rem] leading-[1.65] text-[#7c8095]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-white px-6 py-20 md:px-8" id="why-federated">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            Why Federated
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Raw data stays on-site.
            <br />
            Validation reaches across hospitals.
          </h2>
          <div className="mt-11 grid gap-13 md:grid-cols-[1fr_280px]">
            <div>
              <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Raw images and identifiers stay on-site. The web handles approval; the desktop app handles patient cases and local training; the central server sees reviewed weight deltas, de-identified metadata, and low-resolution thumbnails only.</p>
              <p className="mt-3 max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">That is why K-ERA is federated. It gives hospitals a governed way to contribute to broader validation and future multi-site training without collapsing the privacy boundary that made external validation so hard in the first place.</p>
              <div className="mt-6 rounded-[4px] border border-[#d6d9e4] bg-[#f7f8fc] px-5 py-[18px] text-[0.72rem] leading-[2.2] text-[#7c8095] font-mono-alt">
                <span className="text-[#1a5fa8]">Hospital A</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital B</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span> → <span className="text-[#1a5fa8]">Central review</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital C</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <br />
                <span className="text-[#1a5fa8]">FedAvg aggregation</span> → redistributed to approved nodes
              </div>
              <div className="mt-4 rounded-[4px] border border-[#d6d9e4] bg-[#f7f8fc] px-5 py-4">
                <div className="mb-1 text-[0.6rem] uppercase tracking-[0.12em] text-[#7c8095]">K-ERA Desktop App</div>
                <p className="text-[0.82rem] leading-[1.65] text-[#393c4a]">Local training runs on the K-ERA desktop app, installed on a hospital PC. Case authoring and image upload also happen in the app — not in the browser. A download link is provided after institutional approval.</p>
              </div>
            </div>

            {hasActiveInstitutions ? (
              <div className="overflow-hidden rounded-[6px] border border-[#d6d9e4]">
                <div className="border-b border-[#d6d9e4] bg-white px-[18px] py-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#7c8095] font-mono-alt">
                  Participating institutions
                </div>
                {activeInstitutions.map((institution, index) => (
                  <div key={`${institution.label}-${index}`} className="flex items-center justify-between border-b border-[#eceef5] px-[18px] py-3 text-[0.78rem] last:border-b-0">
                    <span className="text-[#393c4a]">{institution.label}</span>
                    <span className="text-[0.6rem] tracking-[0.06em] text-[#1a6b46] font-mono-alt">● Active</span>
                  </div>
                ))}
                <div className="border-t border-[#d6d9e4] bg-[#f7f8fc] px-[18px] py-3 text-center text-[0.77rem] text-[#7c8095]">
                  Founding site public today. Additional ophthalmology departments invited.
                  <br />
                  <a className="text-[#1a5fa8]" href="mailto:dr.jinho.jeong@gmail.com">
                    Contact us to join →
                  </a>
                </div>
              </div>
            ) : (
              <div className="rounded-[6px] border border-[#d6d9e4] bg-white px-6 py-7 shadow-[0_18px_42px_rgba(10,18,34,0.08)]">
                <div className="mb-2 text-[0.6rem] uppercase tracking-[0.12em] text-[#1a5fa8] font-mono-alt">Pilot enrollment open</div>
                <div className="text-[1rem] font-medium leading-[1.45] text-[#111218]">
                  We are preparing the first participating hospital for the clinical validation network.
                </div>
                <p className="mt-3 text-[0.78rem] leading-[1.72] text-[#7c8095]">
                  After institutional approval, sites can install the desktop app, register cases locally, and join the review and aggregation workflow.
                </p>
                <div className="mt-4 text-[0.77rem] text-[#7c8095]">
                  <a className="text-[#1a5fa8]" href="mailto:dr.jinho.jeong@gmail.com">
                    Contact us to join →
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-[4px] border border-[#d6d9e4] bg-[#f7f8fc] px-6 py-5">
              <div className="mb-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#1a5fa8] font-mono-alt">What participating sites receive</div>
              <ul className="space-y-2.5">
                {enParticipationBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2 text-[0.82rem] leading-[1.65] text-[#393c4a]">
                    <span className="mt-[2px] shrink-0 text-[#1a5fa8]">→</span>
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[4px] border border-[#d6d9e4] bg-white px-6 py-5">
              <div className="mb-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#7c8095] font-mono-alt">Governance</div>
              <div className="space-y-4">
                {enGovernance.map((item) => (
                  <div key={item.label}>
                    <div className="mb-0.5 text-[0.6rem] uppercase tracking-[0.1em] text-[#7c8095] font-mono-alt">{item.label}</div>
                    <div className="text-[0.8rem] leading-[1.65] text-[#393c4a]">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-6 py-20 md:px-8" id="invitation">
        <div className="mx-auto max-w-[600px] text-center">
          <div className="mx-auto mb-9 h-px w-9 bg-[#d6d9e4]" />
          <div className="mb-6 text-[1.2rem] leading-[1.55] tracking-[-0.01em] text-[#111218] font-editorial">
            A single-center result tells you what is possible.
            <br />
            Multi-site validation tells you what is true.
          </div>
          <div className="mb-9 max-w-[480px] mx-auto text-[0.92rem] leading-[1.88] text-[#393c4a]">
            As hospitals join, the validation corpus grows in geographic and device variation, the federated model becomes something that can be claimed across populations, and the evidence required for clinical deployment becomes buildable. That is the trajectory K-ERA is on — and participating institutions are part of shaping it.
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <LandingGoogleCta
              buttonClassName={enPrimaryCtaClass}
              googleLaunchPulse={props.googleLaunchPulse}
              onGoogleLaunch={props.onGoogleLaunch}
              pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
              slotClassName="rounded-[4px]"
            >
              {props.authBusy ? props.connectingLabel : "Apply with Google"}
            </LandingGoogleCta>
            <a className="rounded-[4px] border border-[#d6d9e4] px-5 py-2.5 text-[0.82rem] text-[#393c4a] transition hover:border-[#1a5fa8] hover:text-[#1a5fa8]" href="#evidence">
              Read the evidence
            </a>
          </div>
          <div className="mt-6 text-[0.74rem] text-[#7c8095]">
            Open to ophthalmology departments worldwide
          </div>
          <div className="mt-3 text-[0.74rem] text-[#7c8095]">
            Jinho Jeong, M.D., Ph.D. · Dept. of Ophthalmology, Jeju National University Hospital
            <br />
            <a className="text-[#1a5fa8] hover:underline" href="mailto:dr.jinho.jeong@gmail.com">
              dr.jinho.jeong@gmail.com
            </a>
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center justify-between gap-2.5 border-t border-[#d6d9e4] bg-white px-5 py-[22px] text-center md:flex-row md:px-12">
        <div className="text-[1.05rem] font-semibold tracking-[0.04em] font-editorial">
          K<span className="text-[#1a5fa8]">-ERA</span>
        </div>
        <div className="text-[0.71rem] text-[#7c8095]">© 2026 K-ERA Research Network · TinyStar Labs</div>
        <div className="flex gap-[18px]">
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="/privacy">
            Privacy
          </a>
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="/terms">
            Terms
          </a>
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="mailto:dr.jinho.jeong@gmail.com">
            Contact
          </a>
        </div>
      </footer>
    </main>
  );
}