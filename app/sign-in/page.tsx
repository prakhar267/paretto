import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { learnerAuthReadiness } from "@/app/learner-auth";
import { resolveLearnerAccountSession } from "@/app/server-auth";
import AuthForm from "./AuthForm";
import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learner sign-in — Paretto",
  description: "Access your Paretto learning account.",
  robots: { index: false, follow: false },
};

type SignInSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: SignInSearchParams;
} = {}) {
  const [readiness, requestHeaders, query] = await Promise.all([
    learnerAuthReadiness(),
    headers(),
    searchParams ??
      Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);
  const account = await resolveLearnerAccountSession(
    requestFromHeaders(requestHeaders, "/sign-in"),
  );
  if (!("error" in account) && account.session) {
    redirect("/");
  }
  const accountCheckUnavailable = "error" in account;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="account-title">
        <Link className={styles.brand} href="/" aria-label="Paretto home">
          <span aria-hidden="true">P</span>
          <strong>Paretto</strong>
        </Link>
        <p className={styles.eyebrow}>Your learning account</p>
        <h1 id="account-title">Keep every word with you.</h1>
        <p className={styles.intro}>
          Sign in to continue across browsers and devices. Progress already
          saved in this browser is connected automatically.
        </p>
        {accountCheckUnavailable || !readiness.configured ? (
          <p className={styles.notice} role="status">
            Account access is temporarily unavailable. Your current browser
            progress remains private and unchanged.
          </p>
        ) : (
          <AuthForm
            googleEnabled={readiness.google}
            appleEnabled={readiness.apple}
            accountCreationEnabled={readiness.emailAccountCreation}
            passwordResetEnabled={readiness.passwordReset}
            emailVerificationEnabled={readiness.emailVerification}
            initialError={socialCallbackError(query.error)}
          />
        )}
        <nav className={styles.links} aria-label="Account help">
          <Link href="/">Continue without an account</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
        </nav>
      </section>
    </main>
  );
}

function socialCallbackError(
  value: string | string[] | undefined,
): string {
  const code = Array.isArray(value) ? value[0] : value;
  if (!code) return "";
  if (code === "access_denied") {
    return "Social sign-in was cancelled. You can try again or use email.";
  }
  return "Social sign-in could not be completed. Please try again.";
}

function requestFromHeaders(
  requestHeaders: Headers,
  pathname: string,
): Request {
  const host = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000"
  )
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  return new Request(new URL(pathname, `${protocol}://${host}`), {
    headers: requestHeaders,
  });
}
