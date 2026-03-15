import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-10 text-ink sm:px-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-3xl place-items-center">
        <section className="w-full rounded-[32px] border border-border bg-surface/90 p-8 shadow-panel backdrop-blur-xl sm:p-12">
          <div className="w-fit rounded-full border border-brand/15 bg-brand-soft px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-brand">
            Not Found
          </div>
          <div className="mt-6 grid gap-4">
            <h1 className="font-serif text-[clamp(2.4rem,5vw,4rem)] leading-[0.94] tracking-[-0.05em]">
              The page you requested does not exist.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted sm:text-base">
              The address may be outdated, or the route may have moved during the redesign.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-brand/20 bg-linear-to-b from-brand to-brand-strong px-5 text-sm font-semibold text-[var(--accent-contrast)] shadow-[0_14px_28px_rgba(48,88,255,0.18)]"
            >
              Back Home
            </Link>
            <Link
              href="/admin-login"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-white/50 px-5 text-sm font-semibold text-ink shadow-card dark:bg-white/4"
            >
              Admin Login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
