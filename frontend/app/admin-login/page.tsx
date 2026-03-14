"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { LocaleToggle, pick, translateApiError, useI18n } from "../../lib/i18n";
import { login } from "../../lib/api";

const TOKEN_KEY = "kera_web_token";

export default function AdminLoginPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [nextPath, setNextPath] = useState("/");

  const copy = {
    eyebrow: pick(locale, "Administrator Recovery", "관리자 복구"),
    title: pick(locale, "Local admin sign-in", "로컬 관리자 로그인"),
    body: pick(
      locale,
      "Use this path only for administrator recovery, setup, or incident response. Research users should return to Google sign-in.",
      "이 경로는 관리자 복구, 초기 설정, 장애 대응용으로만 사용하세요. 연구 사용자는 Google 로그인을 이용해야 합니다."
    ),
    username: pick(locale, "Username", "아이디"),
    password: pick(locale, "Password", "비밀번호"),
    signIn: pick(locale, "Enter admin recovery", "관리자 복구로 입장"),
    signingIn: pick(locale, "Connecting...", "연결 중..."),
    loginFailed: pick(locale, "Login failed.", "로그인에 실패했습니다."),
    backToMain: pick(locale, "Back to Google sign-in", "Google 로그인으로 돌아가기"),
  };

  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("next");
    if (candidate && candidate.startsWith("/") && !candidate.startsWith("//")) {
      setNextPath(candidate);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      router.replace(nextPath);
    }
  }, [nextPath, router]);

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      const auth = await login(loginForm.username, loginForm.password);
      window.localStorage.setItem(TOKEN_KEY, auth.access_token);
      router.replace(nextPath);
    } catch (nextError) {
      setError(describeError(nextError, copy.loginFailed));
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main className="shell">
      <div className="shell-toolbar">
        <LocaleToggle />
      </div>
      <section className="hero">
        <article className="hero-card hero-copy">
          <div>
            <div className="eyebrow">{copy.eyebrow}</div>
            <h1>{pick(locale, "Admin Access", "관리자 접근")}</h1>
            <p>{copy.body}</p>
          </div>
        </article>

        <section className="hero-card login-panel">
          <div className="eyebrow">{copy.eyebrow}</div>
          <h2>{copy.title}</h2>
          <p className="muted">{copy.body}</p>
          <form className="stack" onSubmit={handleLocalLogin}>
            <div className="field">
              <label htmlFor="username">{copy.username}</label>
              <input
                id="username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{copy.password}</label>
              <input
                id="password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
            {error ? <div className="error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={authBusy}>
              {authBusy ? copy.signingIn : copy.signIn}
            </button>
          </form>
          <div className="divider-line">{pick(locale, "Research user sign-in", "연구 사용자 로그인")}</div>
          <Link href="/" className="secondary-button">
            {copy.backToMain}
          </Link>
        </section>
      </section>
    </main>
  );
}
