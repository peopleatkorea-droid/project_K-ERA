"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { devLogin, fetchSites, login } from "../../lib/api";
import { LocaleToggle, pick, translateApiError, useI18n } from "../../lib/i18n";
import { cacheSiteRecords } from "../home-page-auth-shared";
import styles from "./page.module.css";

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
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const allowDevRecovery = Boolean(process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL) || process.env.NODE_ENV !== "production";

  const copy = {
    eyebrow: pick(locale, "Operator Sign-In", "운영 계정 로그인"),
    heroTitle: pick(locale, "Admin Access", "관리자 접근"),
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
    researchUserSignIn: pick(locale, "Research user sign-in", "연구 사용자 로그인"),
  };

  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;

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
    <main className={styles.shell}>
      <div className={styles.shellToolbar}>
        <LocaleToggle />
      </div>

      <section className={styles.hero}>
        <article className={`${styles.heroCard} ${styles.heroCopy}`}>
          <div>
            <div className={styles.eyebrow}>{copy.eyebrow}</div>
            <h1>{copy.heroTitle}</h1>
            <p>{copy.body}</p>
          </div>
        </article>

        <section className={`${styles.heroCard} ${styles.loginPanel}`}>
          <div className={styles.eyebrow}>{copy.eyebrow}</div>
          <h2>{copy.title}</h2>
          <p className={styles.muted}>{copy.body}</p>

          <form className={styles.stack} onSubmit={handleLocalLogin}>
            <div className={styles.field}>
              <label htmlFor="username">{copy.username}</label>
              <input
                id="username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password">{copy.password}</label>
              <input
                id="password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>

            {error ? <div className={styles.error}>{error}</div> : null}

            <button className={styles.primaryButton} type="submit" disabled={authBusy}>
              {authBusy ? copy.signingIn : copy.signIn}
            </button>
          </form>

          <div className={styles.dividerLine}>{copy.researchUserSignIn}</div>
          <Link href="/" className={styles.secondaryButton}>
            {copy.backToMain}
          </Link>

          {allowDevRecovery ? (
            <div className={styles.loginUtilityLinks}>
              <button className={styles.textButton} type="button" disabled={authBusy} onClick={handleDevLogin}>
                {authBusy ? copy.signingIn : copy.devSignIn}
              </button>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
