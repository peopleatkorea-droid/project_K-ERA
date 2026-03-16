import Link from "next/link";

type LegalSection = {
  koTitle: string;
  enTitle: string;
  koItems: string[];
  enItems: string[];
};

type LegalDocumentProps = {
  titleKo: string;
  titleEn: string;
  introKo: string;
  introEn: string;
  sections: LegalSection[];
};

function LegalSectionCard({ section }: { section: LegalSection }) {
  return (
    <section className="rounded-[30px] border border-[#d8e1ef] bg-white/92 px-6 py-7 shadow-[0_24px_60px_rgba(24,30,41,0.06)] sm:px-8 sm:py-8">
      <div className="grid gap-6">
        <div className="grid gap-1.5">
          <h2 className="text-[clamp(1.45rem,2.8vw,2rem)] font-semibold tracking-[-0.03em] text-[#0f172f]">
            {section.koTitle}
          </h2>
          <p className="text-[clamp(1rem,1.8vw,1.25rem)] font-semibold tracking-[-0.02em] text-[#334a6b]">
            {section.enTitle}
          </p>
        </div>

        <div className="grid gap-6">
          <div className="grid gap-3">
            <div className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#6d7f9d]">Korean</div>
            <ul className="grid gap-3 pl-6 text-[1rem] leading-8 text-[#17233d] marker:text-[#395f97] sm:text-[1.02rem]">
              {section.koItems.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="h-px bg-[#e6ebf4]" />

          <div className="grid gap-3">
            <div className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#6d7f9d]">English</div>
            <ul className="grid gap-3 pl-6 text-[0.98rem] leading-8 text-[#42506a] marker:text-[#395f97] sm:text-[1rem]">
              {section.enItems.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LegalDocument({ titleKo, titleEn, introKo, introEn, sections }: LegalDocumentProps) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f9fd_0%,#eef3f9_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-4xl gap-4">
            <div className="grid gap-2">
              <h1 className="text-[clamp(2.7rem,5vw,4rem)] font-semibold tracking-[-0.05em] text-[#0f172f]">
                {titleKo}
              </h1>
              <p className="text-[clamp(1.15rem,2vw,1.45rem)] text-[#47617f]">{titleEn}</p>
            </div>
            <div className="grid gap-3 text-[1rem] leading-8 text-[#17233d] sm:text-[1.04rem]">
              <p>{introKo}</p>
              <p className="text-[#4c5e78]">{introEn}</p>
            </div>
          </div>

          <Link
            className="inline-flex min-h-11 items-center rounded-full border border-[#d8e1ef] bg-white px-4 text-sm font-semibold text-[#17233d] transition duration-150 ease-out hover:border-[#aebdd6] hover:bg-[#f8fbff]"
            href="/"
          >
            Back to Home
          </Link>
        </div>

        <div className="grid gap-6">
          {sections.map((section) => (
            <LegalSectionCard key={section.koTitle} section={section} />
          ))}
        </div>
      </div>
    </main>
  );
}
