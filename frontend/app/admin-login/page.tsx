"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { SectionHeader } from "../../components/ui/section-header";
import { devLogin, fetchSites, login } from "../../lib/api";
import { LocaleToggle, pick, translateApiError, useI18n } from "../../lib/i18n";
import { isOperatorUiEnabled } from "../../lib/ui-mode";
import { cacheSiteRecords } from "../home-page-auth-shared";

const TOKEN_KEY = "kera_web_token";
const DEFAULT_POST_LOGIN_PATH = "/";

function getSafePostLoginPath() {
  if (typeof window === "undefined") {
    return DEFAULT_POST_LOGIN_PATH;
  }
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("next");
  if (candidate && candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  return DEFAULT_POST_LOGIN_PATH;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const operatorUiEnabled = isOperatorUiEnabled();
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const allowDevRecovery = Boolean(process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL) || process.env.NODE_ENV !== "production";

  const copy = {
    eyebrow: pick(locale, "Operator Sign-In", "운영 계정 로그인"),
    title: pick(locale, "Local admin / site admin sign-in", "로컬 admin / site admin 로그인"),
    body: pick(
      locale,
      "Use this path for admin and site admin accounts. Research users should return to Google sign-in.",
      "이 경로는 admin 및 site admin 계정 전용입니다. 연구 사용자는 Google 로그인으로 돌아가야 합니다."
    ),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "비밀번호"),
    signIn: pick(locale, "Enter operator workspace", "운영 계정으로 입장"),
    devSignIn: pick(locale, "Enter local dev admin", "로컬 개발 관리자 입장"),
    signingIn: pick(locale, "Connecting...", "연결 중..."),
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    backToMain: pick(locale, "Back to Google sign-in", "Google 로그인으로 돌아가기"),
    safetyTitle: pick(locale, "Restricted entry", "제한된 진입"),
    safetyBody: pick(
      locale,
      "This route bypasses the standard researcher flow. Use it only for operational accounts.",
      "이 경로는 일반 연구자 흐름을 우회합니다. 운영 계정에만 사용하세요."
    ),
    safetyFootnote: pick(
      locale,
      "Admin and site admin accounts should sign in here with passwords.",
      "admin 및 site admin 계정은 이곳에서 비밀번호로 로그인해야 합니다."
    ),
    researchUserSignIn: pick(locale, "Research user sign-in", "연구 사용자 로그인"),
    devFootnote: pick(
      locale,
      "Use the development shortcut only on a local machine with development auth enabled.",
      "개발용 단축 진입은 로컬 PC에서 개발 인증이 켜진 경우에만 사용하세요."
    ),
  };

  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;

  if (!operatorUiEnabled) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_36%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-4xl justify-end">
          <LocaleToggle />
        </div>
        <section className="mx-auto mt-6 grid w-full max-w-4xl gap-5">
          <Card as="section" variant="surface" className="grid gap-5 p-6 sm:p-8">
            <SectionHeader
              eyebrow={
                <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                  {pick(locale, "Researcher build", "연구자 전용 빌드")}
                </span>
              }
              title={pick(locale, "Operator sign-in is hidden in this build", "이 빌드에서는 운영 계정 로그인을 숨겼습니다")}
              description={pick(
                locale,
                "This installer exposes only the researcher workspace. Use the full operator build when admin or site admin access is required.",
                "이 설치본은 연구자 워크스페이스만 노출합니다. admin 또는 site admin 접근이 필요하면 전체 운영 빌드를 사용하세요."
              )}
            />
            <div className="flex justify-start">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-white/55 px-[18px] text-sm font-semibold tracking-[-0.01em] text-ink transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted dark:bg-white/4"
              >
                {pick(locale, "Back to main sign-in", "메인 로그인으로 돌아가기")}
              </Link>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  async function warmApprovedSiteCache(token: string) {
    try {
      const sites = await fetchSites(token);
      if (sites.length > 0) {
        cacheSiteRecords(sites);
      }
    } catch {
      // Keep the login flow moving even if the site-label cache warmup fails.
    }
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      const destination = getSafePostLoginPath();
      void warmApprovedSiteCache(stored).finally(() => {
        router.replace(destination);
      });
    }
  }, [router]);

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    const destination = getSafePostLoginPath();
    try {
      const auth = await login(loginForm.username, loginForm.password);
      window.localStorage.setItem(TOKEN_KEY, auth.access_token);
      await warmApprovedSiteCache(auth.access_token);
      router.replace(destination);
    } catch (nextError) {
      setError(describeError(nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDevLogin() {
    setAuthBusy(true);
    setError(null);
    const destination = getSafePostLoginPath();
    try {
      const auth = await devLogin();
      window.localStorage.setItem(TOKEN_KEY, auth.access_token);
      await warmApprovedSiteCache(auth.access_token);
      router.replace(destination);
    } catch (nextError) {
      setError(describeError(nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(48,88,255,0.14),transparent_36%),linear-gradient(180deg,var(--surface-muted),var(--surface))] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl justify-end">
        <LocaleToggle />
      </div>

      <section className="mx-auto mt-6 grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Card as="article" variant="surface" className="flex min-h-[540px] flex-col justify-between gap-8 p-6 sm:p-8">
          <SectionHeader
            eyebrow={
              <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                {copy.eyebrow}
              </span>
            }
            title={pick(locale, "Admin Access", "관리자 접근")}
            description={copy.body}
          />

          <div className="grid gap-4">
            <Card as="div" variant="nested" className="grid gap-3 p-5">
              <strong className="text-sm font-semibold text-ink">{copy.safetyTitle}</strong>
              <p className="m-0 text-sm leading-6 text-muted">{copy.safetyBody}</p>
              <p className="m-0 text-sm leading-6 text-muted">{copy.safetyFootnote}</p>
            </Card>
          </div>
        </Card>

        <Card as="section" variant="panel" className="grid gap-6 p-6 sm:p-8">
          <SectionHeader
            title={copy.title}
            description={copy.body}
            eyebrow={
              <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                {copy.eyebrow}
              </span>
            }
          />

          <form className="grid gap-4" onSubmit={handleLocalLogin}>
            <Field as="div" label={copy.username} htmlFor="username">
              <input
                id="username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
              />
            </Field>

            <Field as="div" label={copy.password} htmlFor="password">
              <input
                id="password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </Field>

            {error ? (
              <div className="rounded-[18px] border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            ) : null}

            <Button type="submit" variant="primary" className="w-full" disabled={authBusy}>
              {authBusy ? copy.signingIn : copy.signIn}
            </Button>

            {allowDevRecovery ? (
              <>
                <Button type="button" variant="ghost" className="w-full" disabled={authBusy} onClick={handleDevLogin}>
                  {authBusy ? copy.signingIn : copy.devSignIn}
                </Button>
                <p className="m-0 text-xs leading-5 text-muted">{copy.devFootnote}</p>
              </>
            ) : null}
          </form>

          <div className="grid gap-3">
            <div className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
              {copy.researchUserSignIn}
            </div>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-white/55 px-[18px] text-sm font-semibold tracking-[-0.01em] text-ink transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted dark:bg-white/4"
            >
              {copy.backToMain}
            </Link>
          </div>
        </Card>
      </section>
    </main>
  );
}
