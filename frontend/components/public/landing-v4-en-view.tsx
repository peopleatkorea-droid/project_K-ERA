import type { SiteRecord } from "../../lib/api";

type EnglishLandingViewProps = {
  authBusy: boolean;
  googleLoginLabel: string;
  connectingLabel: string;
  googleLaunchPulse: boolean;
  publicSites: SiteRecord[];
  onGoogleLaunch: () => void;
  onLocaleChange: (locale: "ko") => void;
};

const enStats = [
  {
    number: "~1M",
    label: "Annual cases of infectious keratitis globally. A leading cause of preventable visual impairment.",
  },
  {
    number: "<30%",
    label: "Of published keratitis AI models report external validation results.",
  },
  {
    number: "633",
    label: "Images per class in the K-ERA founding dataset — typical of single-center studies.",
  },
  {
    number: "5,000+",
    label: "Images per class needed for clinically meaningful generalisation — achievable only through collaboration.",
  },
];

const enApproach = [
  {
    number: "Enables 01",
    title: "Large-scale multi-center datasets",
    body: "Clinical volume aggregated across hospitals — without data transfer or central storage of patient information.",
  },
  {
    number: "Enables 02",
    title: "Continuous external validation",
    body: "Every new participating hospital constitutes a natural external validation cohort, embedded directly in the research workflow.",
  },
  {
    number: "Enables 03",
    title: "Privacy-preserving collaboration",
    body: "Federated learning allows model weights — not patient data — to be shared. Compliant with institutional data governance requirements.",
  },
];

const enWorkflow = [
  {
    step: "Step 01",
    title: "Register patient visit",
    body: "Enter basic case information via web interface. No CSV files. No dataset manifests. Google account only.",
  },
  {
    step: "Step 02",
    title: "Upload slit-lamp images",
    body: "White light, fluorescein, and slit beam images from the clinical visit. Multiple images per visit are supported and recommended.",
  },
  {
    step: "Step 03",
    title: "AI analysis",
    body: "MedSAM automatically localises the lesion. The model generates a probability estimate for bacterial vs fungal aetiology.",
  },
  {
    step: "Step 04",
    title: "Dataset generation",
    body: "The case is automatically indexed as a research observation. Contribution to the federated model requires institutional approval.",
  },
];

const enTechnology = [
  {
    tag: "Lesion localisation",
    title: "Automated segmentation via MedSAM",
    body: "MedSAM (Meta AI, 2024) automatically identifies the corneal lesion region from a simple bounding box. The pipeline eliminates manual ROI cropping — previously requiring hours of expert time per dataset.",
    detail:
      "Grad-CAM visualisation is generated alongside each prediction, enabling inspection of the spatial basis for the model's output.",
  },
  {
    tag: "Multimodal classification",
    title: "Visit-level analysis across imaging modalities",
    body: "Rather than selecting one best image, K-ERA analyses all images from a clinical visit — white light, fluorescein, and slit beam — and aggregates predictions at the visit level. This reduces sensitivity to image quality variation and specular artefact.",
    detail:
      "An ensemble of two models — whole-image context and lesion-focused — contributes to the final visit-level estimate.",
  },
  {
    tag: "Federated learning",
    title: "Secure weight sharing without data transfer",
    body: "Each hospital runs a local node. After fine-tuning on local cases, only the weight delta is transmitted to the central server — encrypted and accompanied by a SHA-256 hash. Raw images and patient identifiers never leave the institution.",
    detail:
      "Central aggregation uses Federated Averaging (FedAvg). Updated model weights are redistributed to all participating nodes.",
  },
];

export function EnglishLandingView(props: EnglishLandingViewProps) {
  const institutions = [
    ...props.publicSites.slice(0, 1).map((site) => ({ label: site.display_name, active: true })),
    ...Array.from({ length: Math.max(0, 5 - props.publicSites.slice(0, 1).length) }, (_, index) => ({
      label: `Institution ${index + 2}`,
      active: false,
    })),
  ];

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
            className="border-l border-white/25 px-3.5 py-1 text-[0.63rem] tracking-[0.1em] text-white/55 transition hover:bg-white/10 hover:text-white font-mono-alt"
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
        <button
          className={`rounded-[4px] bg-[#1a5fa8] px-5 py-2 text-[0.78rem] tracking-[0.03em] text-white transition hover:bg-[#144e94] ${props.googleLaunchPulse ? "ring-4 ring-[rgba(26,95,168,0.18)]" : ""}`}
          type="button"
          onClick={props.onGoogleLaunch}
        >
          {props.authBusy ? props.connectingLabel : "Join the network"}
        </button>
      </nav>

      <section className="border-b border-[#d6d9e4] px-6 pb-16 pt-[72px] md:px-8">
        <div className="mx-auto grid max-w-[900px] gap-15 md:grid-cols-[1fr_300px]">
          <div className="text-center md:text-center">
            <div className="mb-6 flex items-center justify-center gap-2.5 text-[0.63rem] uppercase tracking-[0.16em] text-[#7c8095] font-mono-alt">
              <span className="h-px w-5 bg-[#d6d9e4]" />
              A collaborative AI research platform
            </div>
            <h1 className="mb-6 text-[clamp(1.9rem,3.8vw,3rem)] leading-[1.22] tracking-[-0.015em] font-editorial">
              Can clinicians build a global keratitis AI <em className="italic text-[#1a5fa8]">together?</em>
            </h1>
            <div className="mx-auto mb-8 max-w-[500px] text-[0.95rem] leading-[1.85] text-[#393c4a]">
              <p>Most AI studies in infectious keratitis are built on small, single-center datasets — producing models that rarely generalise beyond the institution where they were trained.</p>
              <p className="mt-2.5">What if clinicians across hospitals could contribute cases from routine practice, and build one shared intelligence?</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button className="rounded-[4px] bg-[#1a5fa8] px-[22px] py-2.5 text-[0.82rem] tracking-[0.03em] text-white transition hover:bg-[#144e94]" type="button" onClick={props.onGoogleLaunch}>
                {props.authBusy ? props.connectingLabel : props.googleLoginLabel}
              </button>
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
              <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">Federated learning · Clinician-facing research platform</div>
            </div>
            <div className="mb-5">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Focus disease
              </div>
              <div className="text-[0.8rem] leading-[1.6] text-[#393c4a]">
                <strong className="font-medium text-[#111218]">Infectious keratitis</strong>
                <br />
                Bacterial vs Fungal differentiation
              </div>
            </div>
            <div className="mb-5">
              <div className="mb-1 text-[0.6rem] uppercase tracking-[0.13em] text-[#7c8095] font-mono-alt">
                Keywords
              </div>
              <div className="flex flex-wrap gap-1.5 text-[0.65rem] text-[#1a5fa8]">
                {["federated learning", "keratitis", "MedSAM", "multi-center", "slit-lamp AI"].map((tag) => (
                  <span key={tag} className="rounded-[3px] bg-[rgba(26,95,168,0.08)] px-2 py-0.5">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="my-[18px] h-px bg-[#eceef5]" />
            <div className="mb-4">
              <div className="text-[2.1rem] leading-none text-[#1a5fa8] font-editorial">
                77%
              </div>
              <div className="mt-1 text-[0.74rem] leading-[1.5] text-[#7c8095]">Single-center cross-validation accuracy (initial model)</div>
            </div>
            <div>
              <div className="text-[2.1rem] leading-none text-[#1a5fa8] font-editorial">
                85%+
              </div>
              <div className="mt-1 text-[0.74rem] leading-[1.5] text-[#7c8095]">Projected accuracy at scale (≥5,000 images per class)</div>
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
            But most models do not generalise.
          </h2>
          <div className="mt-12 grid gap-14 md:grid-cols-[1fr_240px]">
            <div>
              <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Infectious keratitis remains one of the leading causes of preventable corneal blindness worldwide. Bacterial and fungal keratitis present with overlapping clinical features, making early differential diagnosis challenging even for experienced clinicians.</p>
              <p className="mt-3 max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Deep learning models trained on slit-lamp images have shown promising results in internal validation. However, a consistent pattern has emerged: models trained on single-center datasets frequently fail when applied to new institutions. Variation in imaging equipment, patient demographics, and clinical practice limits generalisability.</p>
              <div className="mt-7 border border-[#d6d9e4] border-l-[3px] border-l-[#b5291c] bg-[#f7f8fc] px-[22px] py-[18px] text-[0.84rem] leading-[1.72] text-[#393c4a]">
                <strong className="font-medium text-[#b5291c]">The fundamental barrier is not algorithmic. It is structural.</strong>
                <br />
                Patient data cannot leave the hospital. Model checkpoints cannot be shared without risk. Most studies therefore remain trapped within a single institution, never reaching the scale needed for clinical adoption.
              </div>
            </div>
            <div className="flex flex-col">
              {enStats.map((stat) => (
                <div key={stat.number + stat.label} className="border-b border-[#eceef5] py-5 first:pt-0">
                  <div className="text-[2.2rem] leading-none text-[#1a5fa8] font-editorial">
                    {stat.number}
                  </div>
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
            Instead of building AI in isolated labs,
            <br />
            <em className="italic text-white/65">build it together with clinicians.</em>
          </h2>
          <div className="mb-11 max-w-[560px] text-[0.95rem] leading-[1.85] text-white/78">
            <p>K-ERA proposes a collaborative model. Each hospital contributes cases from routine clinical practice. Each patient visit becomes a research observation. AI models learn locally and improve collectively — without any raw patient data leaving the institution.</p>
          </div>
          <div className="grid overflow-hidden rounded-[6px] border border-white/14 md:grid-cols-3">
            {enApproach.map((item) => (
              <div key={item.number} className="border-r border-white/10 bg-white/6 px-[22px] py-[26px] last:border-r-0">
                <div className="mb-2.5 text-[0.6rem] uppercase tracking-[0.14em] text-white/38 font-mono-alt">
                  {item.number}
                </div>
                <div className="mb-2 text-[1.05rem] leading-[1.3] text-white font-editorial">
                  {item.title}
                </div>
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
            No coding. No dataset engineering.
          </h2>
          <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">A research dataset grows naturally through routine clinical care. The workflow maps directly onto existing clinical practice — no additional technical infrastructure is required at the point of care.</p>
          <div className="mt-11 grid overflow-hidden rounded-[6px] border border-[#d6d9e4] md:grid-cols-4">
            {enWorkflow.map((item) => (
              <div key={item.step} className="border-r border-[#d6d9e4] bg-white px-5 py-[26px] last:border-r-0">
                <div className="mb-2 text-[0.6rem] tracking-[0.12em] text-[#1a5fa8] font-mono-alt">
                  {item.step}
                </div>
                <div className="mb-2 text-[0.88rem] font-medium">{item.title}</div>
                <div className="text-[0.77rem] leading-[1.65] text-[#7c8095]">{item.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-7 border-t border-[#eceef5] px-8 py-5 text-center text-[1.2rem] italic text-[#1a5fa8] font-editorial">
            Every case becomes research data.
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
            Three components.
            <br />
            No manual intervention required.
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
            Not a single-center project.
            <br />
            A collaborative research network.
          </h2>
          <div className="mt-11 grid gap-13 md:grid-cols-[1fr_280px]">
            <div>
              <p className="max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">Participating clinicians contribute cases from real clinical practice. As more hospitals join, two effects compound simultaneously: the training dataset grows, and the model undergoes continuous external validation in heterogeneous clinical environments.</p>
              <p className="mt-3 max-w-[620px] text-[0.92rem] leading-[1.88] text-[#393c4a]">This transforms what would otherwise be isolated single-center studies into a form of distributed, collective intelligence — built incrementally through routine care rather than through dedicated data collection efforts.</p>
              <div className="mt-6 rounded-[4px] border border-[#d6d9e4] bg-white px-5 py-[18px] text-[0.72rem] leading-[2.2] text-[#7c8095] font-mono-alt">
                <span className="text-[#1a5fa8]">Hospital A</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital B</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span> ──→ <span className="text-[#1a5fa8]">Aggregation</span>
                <br />
                <span className="text-[#1a5fa8]">Hospital C</span> → local training → <span className="text-[#1a5fa8]">Δ weights</span>
                <br />
                <br />
                <span className="text-[#1a5fa8]">Updated global model</span> → redistributed to all nodes
              </div>
            </div>

            <div className="overflow-hidden rounded-[6px] border border-[#d6d9e4]">
              <div className="border-b border-[#d6d9e4] bg-white px-[18px] py-3 text-[0.6rem] uppercase tracking-[0.12em] text-[#7c8095] font-mono-alt">
                Participating institutions
              </div>
              {institutions.map((institution) => (
                <div key={institution.label} className="flex items-center justify-between border-b border-[#eceef5] px-[18px] py-3 text-[0.78rem] last:border-b-0">
                  <span className="text-[#393c4a]">{institution.label}</span>
                  {institution.active ? (
                    <span className="text-[0.6rem] tracking-[0.06em] text-[#1a6b46] font-mono-alt">
                      ● Active
                    </span>
                  ) : (
                    <span className="rounded-[3px] border border-[#d6d9e4] px-1.5 py-0.5 text-[0.6rem] tracking-[0.06em] text-[#7c8095] font-mono-alt">
                      Open
                    </span>
                  )}
                </div>
              ))}
              <div className="border-t border-[#d6d9e4] bg-[#f7f8fc] px-[18px] py-3 text-center text-[0.77rem] text-[#7c8095]">
                Ophthalmology departments invited.
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
            To build the largest real-world AI dataset
            <br />
            for infectious keratitis.
          </h2>
          <div className="mt-10 rounded-r-[4px] border-l-[3px] border-l-[#1a5fa8] bg-[#f7f8fc] px-10 py-8">
            <div className="mb-1 text-[1.3rem] italic leading-[1.65] text-[#111218] font-editorial">
              "Not in one lab. But across the clinicians who see these patients every day."
            </div>
            <div className="text-[0.62rem] uppercase tracking-[0.1em] text-[#7c8095] font-mono-alt">
              K-ERA founding principle
            </div>
          </div>
          <div className="mt-9 grid gap-11 md:grid-cols-2">
            <p className="text-[0.92rem] leading-[1.88] text-[#393c4a]">The dataset that would make a clinically meaningful keratitis AI is not out of reach. It exists — distributed across the image archives of ophthalmology departments throughout Korea and beyond. The challenge is not data volume. It is infrastructure and incentive alignment.</p>
            <p className="text-[0.92rem] leading-[1.88] text-[#393c4a]">K-ERA addresses both. The platform removes the technical barrier to participation. The federated architecture removes the data governance barrier. And the network effect — where every new participant simultaneously benefits from and contributes to the shared model — creates a self-reinforcing incentive for continued engagement.</p>
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
            <em className="text-[#1a5fa8]">One visit.</em>
            <br />
            <em className="text-[#1a5fa8]">One image.</em>
          </div>
          <div className="mb-8 text-[1.45rem] italic text-[#111218] font-editorial">
            Research begins with one case.
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <button className="rounded-[4px] bg-[#1a5fa8] px-[22px] py-2.5 text-[0.82rem] tracking-[0.03em] text-white transition hover:bg-[#144e94]" type="button" onClick={props.onGoogleLaunch}>
              {props.authBusy ? props.connectingLabel : "Join the K-ERA research network"}
            </button>
            <a className="rounded-[4px] border border-[#d6d9e4] px-5 py-2.5 text-[0.82rem] text-[#393c4a] transition hover:border-[#1a5fa8] hover:text-[#1a5fa8]" href="#problem">
              Read from the beginning
            </a>
          </div>
          <div className="mt-4 text-[0.74rem] text-[#7c8095]">Open to ophthalmology departments · Contact: kera-research@jnuh.ac.kr</div>
          <div className="absolute left-[-9999px] h-px w-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
            <div data-google-slot />
          </div>
        </div>
      </section>

      <footer className="flex flex-col items-center justify-between gap-2.5 border-t border-[#d6d9e4] bg-white px-5 py-[22px] text-center md:flex-row md:px-12">
        <div className="text-[1.05rem] font-semibold tracking-[0.04em] font-editorial">
          K<span className="text-[#1a5fa8]">-ERA</span>
        </div>
        <div className="text-[0.71rem] text-[#7c8095]">© 2026 K-ERA Research Network · Jeju National University Hospital · Ophthalmology</div>
        <div className="flex gap-[18px]">
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#">
            Privacy
          </a>
          <a className="text-[0.71rem] text-[#7c8095] transition hover:text-[#1a5fa8]" href="#">
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
