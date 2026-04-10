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

const enApproach = [
  {
    number: "Enables 01",
    title: "A strict starting benchmark",
    body: "Begin with leakage-aware single-center evidence, then expand into multi-center validation without changing the clinician workflow.",
  },
  {
    number: "Enables 02",
    title: "A realistic scaling path",
    body: "Across the broader literature, CNN-family models usually improve as datasets become larger and more heterogeneous. K-ERA is built to test that under real hospital variation.",
  },
  {
    number: "Enables 03",
    title: "Privacy-preserving collaboration",
    body: "Local site rounds, pending-review model updates, and FedAvg aggregation support collaboration without moving raw images or patient identifiers.",
  },
];

const enWorkflow = [
  {
    step: "Step 01",
    title: "Register and obtain approval",
    body: "Sign in with Google, enter case details in the browser, and work inside the same clinical-style workflow. Federated contribution requires institutional approval.",
  },
  {
    step: "Step 02",
    title: "Upload slit-lamp images",
    body: "The platform can store white light, fluorescein, and slit views from a visit. The current published benchmark is white-light only.",
  },
  {
    step: "Step 03",
    title: "Prepare lesion ROI",
    body: "Draw a loose lesion box and K-ERA prepares ROI previews and lesion crops for review. The current paper's lesion-centered comparison was evaluated with manual prompts.",
  },
  {
    step: "Step 04",
    title: "Review and contribute",
    body: "Approved sites can run local image-level or visit-level rounds. Review bundles are checked centrally before aggregation.",
  },
];

const enTechnology = [
  {
    tag: "Prompt-guided ROI",
    title: "MedSAM-assisted lesion workflow",
    body: "MedSAM converts a clinician-drawn box into ROI previews and lesion crops. This reduces manual preprocessing while keeping the clinician in the loop.",
    detail:
      "In the current paper, lesion-centered gains were shown with manual lesion prompts rather than a fully automated deployment pipeline.",
  },
  {
    tag: "Visit-level benchmark",
    title: "EfficientNetV2-S MIL plus DINO retrieval rail",
    body: "The active operating rail is visit-level EfficientNetV2-S MIL, with DINO lesion retrieval retained as a complementary comparison path. The platform can store multiple slit-lamp views, but the published benchmark is white-light.",
    detail:
      "This keeps current evidence separate from the future multimodal roadmap instead of treating them as the same claim.",
  },
  {
    tag: "Federated extension",
    title: "Review-first aggregation across hospitals",
    body: "Site nodes can run local image-level ConvNeXt-Tiny rounds and visit-level EfficientNetV2-S MIL rounds. Aggregation happens after central review rather than blind automatic merging.",
    detail:
      "The central service receives weight deltas, de-identified metadata, and low-resolution thumbnails for review. Retrieval sharing runs on a separate corpus-expansion rail.",
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
  const openSlots = Array.from({ length: Math.max(0, 5 - activeInstitutions.length) }, () => ({
    label: "Additional department invited",
    active: false,
  }));
  const institutions = [...activeInstitutions, ...openSlots];
  const institutionFooter = activeInstitutions.length
    ? "Founding site public today. Additional ophthalmology departments invited."
    : "Ophthalmology departments invited.";

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
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#problem">
            The Problem
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#platform">
            Platform
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#technology">
            Technology
          </a>
          <a className="text-[0.78rem] tracking-[0.03em] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#network">
            Network
          </a>
        </div>
        <LandingGoogleCta
          buttonClassName={enNavCtaClass}
          googleLaunchPulse={props.googleLaunchPulse}
          onGoogleLaunch={props.onGoogleLaunch}
          pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
          slotClassName="rounded-[4px]"
        >
          {props.authBusy ? props.connectingLabel : props.googleLoginLabel}
        </LandingGoogleCta>
      </nav>

      <section className="border-b border-[#d6d9e4] px-6 pb-16 pt-[72px] md:px-8">
        <div className="mx-auto grid max-w-[900px] gap-15 md:grid-cols-[1fr_300px]">
          <div className="text-center md:text-center">
            <div className="mb-6 flex items-center justify-center gap-2.5 text-[0.63rem] uppercase tracking-[0.16em] text-[#7c8095] font-mono-alt">
              <span className="h-px w-5 bg-[#d6d9e4]" />
              A clinician-facing research platform
            </div>
            <h1 className="mb-6 text-[clamp(1.9rem,3.8vw,3rem)] leading-[1.22] tracking-[-0.015em] font-editorial">
              A stricter keratitis benchmark,
              <br />
              built for <em className="italic text-[#1a5fa8]">multi-center growth.</em>
            </h1>
            <div className="mx-auto mb-8 max-w-[500px] text-[0.95rem] leading-[1.85] text-[#393c4a]">
              <p>K-ERA starts from a leakage-aware single-center study: 101 patients, 258 visits, and 658 white-light slit-lamp images.</p>
              <p className="mt-2.5">The current result is modest, but the broader literature suggests CNN-family models improve as datasets scale. The platform is built to test that next step across hospitals.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              <LandingGoogleCta
                buttonClassName={enPrimaryCtaClass}
                googleLaunchPulse={props.googleLaunchPulse}
                onGoogleLaunch={props.onGoogleLaunch}
                pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
                slotClassName="rounded-[4px]"
              >
                {props.authBusy ? props.connectingLabel : props.googleLoginLabel}
              </LandingGoogleCta>
              <a className="rounded-[4px] border border-[#d6d9e4] px-5 py-2.5 text-[0.82rem] text-[#393c4a] transition hover:border-[#1a5fa8] hover:text-[#1a5fa8]" href="#problem">
                Read more ↓
              </a>
            </div>
          </div>

          <div className="border-t border-[#d6d9e4] pt-6 text-center md:border-t-0 md:border-l md:pl-7 md:pt-0 md:text-center">
            <div className="mb-5">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Platform type
              </div>
              <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">Federated extension · Clinician-facing research platform</div>
            </div>
            <div className="mb-5">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Focus disease
              </div>
              <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">
                <strong className="font-medium text-[#111218]">Infectious keratitis</strong>
                <br />
                Bacterial vs fungal differentiation
              </div>
            </div>
            <div className="mb-5">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Keywords
              </div>
              <div className="flex flex-wrap gap-1.5 text-[0.65rem] text-[#1a5fa8]">
                {["leakage-aware benchmark", "keratitis", "MedSAM", "federated learning", "visit-level AI"].map((tag) => (
                  <span key={tag} className="rounded-[3px] bg-[rgba(26,95,168,0.08)] px-2 py-0.5">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="my-[18px] h-px bg-[#eceef5]" />
            <div className="mb-4">
              <div className="text-[2.1rem] leading-none text-[#1a5fa8] font-editorial">101</div>
              <div className="mt-1 text-[0.74rem] leading-[1.5] text-[#7c8095]">Patients in the founding study</div>
            </div>
            <div>
              <div className="text-[2.1rem] leading-none text-[#1a5fa8] font-editorial">0.677</div>
              <div className="mt-1 text-[0.74rem] leading-[1.5] text-[#7c8095]">Best visit-level AUROC under patient-disjoint evaluation</div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-white px-6 py-20 md:px-8" id="problem">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            The Problem
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Early diagnosis is difficult.
            <br />
            AI has shown promise.
            <br />
            External validation is still the bottleneck.
          </h2>
          <div className="mt-12 grid gap-14 md:grid-cols-[1fr_240px]">
            <div>
              <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Infectious keratitis remains one of the leading causes of preventable corneal blindness worldwide. Bacterial and fungal keratitis present with overlapping clinical features, making early differential diagnosis challenging even for experienced clinicians.</p>
              <p className="mt-3 max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">The founding K-ERA benchmark was intentionally strict: white-light images only, patient-disjoint 5-fold splitting, visit-level prediction, and leakage-aware controls. Under that setup, performance remained modest, which is exactly why larger and more heterogeneous cohorts matter.</p>
              <div className="mt-7 border border-[#d6d9e4] border-l-[3px] border-l-[#b5291c] bg-[#f7f8fc] px-[22px] py-[18px] text-[0.84rem] leading-[1.72] text-[#393c4a]">
                <strong className="font-medium text-[#b5291c]">The central constraint is not only model design. It is whether hospitals can build larger validation cohorts without moving raw patient data.</strong>
                <br />
                That is the gap K-ERA is trying to close: turn routine clinical cases into a shared validation and training pathway, while keeping raw images and identifiers local.
              </div>
            </div>
            <div className="flex flex-col">
              {enStats.map((stat) => (
                <div key={stat.number + stat.label} className="border-b border-[#eceef5] py-5 first:pt-0">
                  <div className="text-[2.2rem] leading-none text-[#1a5fa8] font-editorial">{stat.number}</div>
                  <div className="mt-1 text-[0.76rem] leading-[1.55] text-[#7c8095]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#1a5fa8] px-6 py-20 text-white md:px-8">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-white/50 font-mono-alt">
            The Approach
            <span className="h-px w-8 bg-white/15" />
          </div>
          <h2 className="mb-7 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Instead of over-claiming one hospital&apos;s model,
            <br />
            <em className="italic text-white/65">build the validation network first.</em>
          </h2>
          <div className="mb-11 max-w-[560px] text-[0.95rem] leading-[1.85] text-white/78">
            <p>K-ERA turns routine care into a reviewable research workflow. A single-center benchmark establishes the starting point; federated site rounds create the path toward broader validation, larger cohorts, and stronger CNN performance at scale.</p>
          </div>
          <div className="grid overflow-hidden rounded-[6px] border border-white/14 md:grid-cols-3">
            {enApproach.map((item) => (
              <div key={item.number} className="border-r border-white/10 bg-white/6 px-[22px] py-[26px] last:border-r-0">
                <div className="mb-2.5 text-[0.6rem] uppercase tracking-[0.14em] text-white/38 font-mono-alt">{item.number}</div>
                <div className="mb-2 text-[1.05rem] leading-[1.3] text-white font-editorial">{item.title}</div>
                <div className="text-[0.79rem] leading-[1.72] text-white/63">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-[#f7f8fc] px-6 py-20 md:px-8" id="platform">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            The Platform
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Designed for clinicians.
            <br />
            Structured enough for real research.
          </h2>
          <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">A research dataset grows through routine care, but the landing now draws a firmer line between what is already benchmarked, what the app already supports, and what the federated extension is still validating.</p>
          <div className="mt-11 grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-4">
            {enWorkflow.map((item) => (
              <div key={item.step} className="border-r border-[#d6d9e4] bg-white px-5 py-[26px] last:border-r-0">
                <div className="mb-2 text-[0.6rem] tracking-[0.12em] text-[#1a5fa8] font-mono-alt">{item.step}</div>
                <div className="mb-2 text-[0.88rem] font-medium">{item.title}</div>
                <div className="text-[0.77rem] leading-[1.65] text-[#7c8095]">{item.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-7 border-t border-[#eceef5] px-8 py-5 text-center text-[1.2rem] italic text-[#1a5fa8] font-editorial">
            Each approved case can become a research observation.
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-white px-6 py-20 md:px-8" id="technology">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            Core Technology
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Three rails.
            <br />
            One honest boundary between evidence and roadmap.
          </h2>
          <div className="mt-11 grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-3">
            {enTechnology.map((item) => (
              <div key={item.tag} className="border-r border-[#d6d9e4] bg-[#f7f8fc] px-6 py-7 last:border-r-0">
                <span className="mb-3 inline-block rounded-[3px] bg-[rgba(26,95,168,0.08)] px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.1em] text-[#1a5fa8]">{item.tag}</span>
                <div className="mb-2 text-[0.92rem] font-medium leading-[1.35]">{item.title}</div>
                <div className="text-[0.79rem] leading-[1.75] text-[#393c4a]">{item.body}</div>
                <div className="mt-3 border-t border-[#d6d9e4] pt-3 text-[0.74rem] leading-[1.65] text-[#7c8095]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-[#f7f8fc] px-6 py-20 md:px-8" id="network">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            The Network
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Today: a founding-site benchmark.
            <br />
            Next: a multi-center validation network.
          </h2>
          <div className="mt-11 grid gap-13 md:grid-cols-[1fr_280px]">
            <div>
              <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">The current public evidence starts at Jeju National University Hospital. The purpose of the network is to make the next step explicit: more sites, more heterogeneity, and cleaner external validation.</p>
              <p className="mt-3 max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Broader ophthalmic AI literature suggests CNN-based models usually improve as datasets expand. K-ERA is designed to test that expectation prospectively, rather than assume it from one internal study.</p>
              <div className="mt-6 rounded-[4px] border border-[#d6d9e4] bg-white px-5 py-[18px] text-[0.72rem] leading-[2.2] text-[#7c8095] font-mono-alt">
                <span className="text-[#1a5fa8]">Hospital A</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital B</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span> → <span className="text-[#1a5fa8]">Central review</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital C</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <br />
                <span className="text-[#1a5fa8]">FedAvg aggregation</span> → redistributed to approved nodes
              </div>
            </div>

            <div className="overflow-hidden rounded-[6px] border border-[#d6d9e4]">
              <div className="border-b border-[#d6d9e4] bg-white px-[18px] py-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#7c8095] font-mono-alt">
                Participating institutions
              </div>
              {institutions.map((institution, index) => (
                <div key={`${institution.label}-${index}`} className="flex items-center justify-between border-b border-[#eceef5] px-[18px] py-3 text-[0.78rem] last:border-b-0">
                  <span className="text-[#393c4a]">{institution.label}</span>
                  {institution.active ? (
                    <span className="text-[0.6rem] tracking-[0.06em] text-[#1a6b46] font-mono-alt">● Active</span>
                  ) : (
                    <span className="rounded-[3px] border border-[#d6d9e4] px-1.5 py-0.5 text-[0.6rem] tracking-[0.06em] text-[#7c8095] font-mono-alt">
                      Open
                    </span>
                  )}
                </div>
              ))}
              <div className="border-t border-[#d6d9e4] bg-[#f7f8fc] px-[18px] py-3 text-center text-[0.77rem] text-[#7c8095]">
                {institutionFooter}
                <br />
                <a className="text-[#1a5fa8]" href="mailto:kera-research@jnuh.ac.kr">
                  Contact us to join →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#d6d9e4] bg-white px-6 py-20 md:px-8">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-5 flex items-center gap-2.5 text-[0.63rem] uppercase tracking-[0.18em] text-[#1a5fa8] font-mono-alt">
            The Long-term Goal
            <span className="h-px w-8 bg-[rgba(26,95,168,0.18)]" />
          </div>
          <h2 className="mb-5 text-[clamp(1.65rem,2.6vw,2.3rem)] leading-[1.28] font-editorial">
            Build the infrastructure first,
            <br />
            then earn the larger model.
          </h2>
          <div className="mt-10 rounded-r-[4px] border-l-[3px] border-l-[#1a5fa8] bg-[#f7f8fc] px-10 py-8">
            <div className="mb-1 text-[1.3rem] italic leading-[1.65] text-[#111218] font-editorial">
              "Not by pretending one cohort is enough. By building the network that makes the next cohort possible."
            </div>
            <div className="text-[0.62rem] uppercase tracking-[0.1em] text-[#7c8095] font-mono-alt">
              K-ERA founding principle
            </div>
          </div>
          <div className="mt-9 grid gap-11 md:grid-cols-2">
            <p className="text-[0.92rem] leading-[1.88] text-[#393c4a]">The founding white-light benchmark is still modest. That is precisely the point. K-ERA is not presenting a finished answer; it is building the workflow, review logic, and site infrastructure required to produce stronger external evidence.</p>
            <p className="text-[0.92rem] leading-[1.88] text-[#393c4a]">If the broader CNN scaling pattern holds in this disease area as well, larger multi-center cohorts should improve robustness. The platform is designed so that claim can be tested transparently, under real governance constraints.</p>
          </div>
        </div>
      </section>

      <section className="bg-white px-6 py-20 md:px-8" id="invitation">
        <div className="mx-auto max-w-[600px] text-center">
          <div className="mx-auto mb-9 h-px w-9 bg-[#d6d9e4]" />
          <div className="mb-9 text-[1.18rem] leading-[2.2] text-[#393c4a] italic font-editorial">
            Research does not always begin
            <br />
            with a large grant.
            <br />
            <br />
            Sometimes it begins with
            <br />
            <em className="text-[#1a5fa8]">one patient.</em>
            <br />
            <em className="text-[#1a5fa8]">one visit.</em>
            <br />
            <em className="text-[#1a5fa8]">one image.</em>
          </div>
          <div className="mb-8 text-[1.45rem] italic text-[#111218] font-editorial">
            One careful case is where the network starts.
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <LandingGoogleCta
              buttonClassName={enPrimaryCtaClass}
              googleLaunchPulse={props.googleLaunchPulse}
              onGoogleLaunch={props.onGoogleLaunch}
              pulseClassName="ring-4 ring-[rgba(26,95,168,0.18)]"
              slotClassName="rounded-[4px]"
            >
              {props.authBusy ? props.connectingLabel : props.googleLoginLabel}
            </LandingGoogleCta>
            <a className="rounded-[4px] border border-[#d6d9e4] px-5 py-2.5 text-[0.82rem] text-[#393c4a] transition hover:border-[#1a5fa8] hover:text-[#1a5fa8]" href="#problem">
              Read from the beginning
            </a>
          </div>
          <div className="mt-4 text-[0.74rem] text-[#7c8095]">Open to ophthalmology departments · Contact: kera-research@jnuh.ac.kr</div>
        </div>
      </section>

      <footer className="flex flex-col items-center justify-between gap-2.5 border-t border-[#d6d9e4] bg-white px-5 py-[22px] text-center md:flex-row md:px-12">
        <div className="text-[1.05rem] font-semibold tracking-[0.04em] font-editorial">
          K<span className="text-[#1a5fa8]">-ERA</span>
        </div>
        <div className="text-[0.71rem] text-[#7c8095]">© 2026 K-ERA Research Network · Jeju National University Hospital · Ophthalmology</div>
        <div className="flex gap-[18px]">
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="/privacy">
            Privacy
          </a>
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="/terms">
            Terms
          </a>
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="mailto:kera-research@jnuh.ac.kr">
            Contact
          </a>
        </div>
      </footer>
    </main>
  );
}
