"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { authClient } from "@/app/auth-client";
import { transitionClaimedProgressCache } from "@/app/progress-cache";
import styles from "./auth.module.css";

type Mode = "sign-in" | "create" | "recover";

export default function AuthForm({
  googleEnabled,
  appleEnabled,
  accountCreationEnabled,
  passwordResetEnabled,
  emailVerificationEnabled,
  initialError = "",
}: {
  googleEnabled: boolean;
  appleEnabled: boolean;
  accountCreationEnabled: boolean;
  passwordResetEnabled: boolean;
  emailVerificationEnabled: boolean;
  initialError?: string;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const fields = formRef.current?.elements;
    if (fields) {
      const emailField = fields.namedItem("email");
      const passwordField = fields.namedItem("password");
      if (emailField instanceof HTMLInputElement && emailField.value) {
        setEmail(emailField.value);
      }
      if (passwordField instanceof HTMLInputElement && passwordField.value) {
        setPassword(passwordField.value);
      }
    }
    setHydrated(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = new FormData(event.currentTarget);
    const submittedName = String(submitted.get("name") ?? name).trim();
    const submittedEmail = String(submitted.get("email") ?? email);
    const submittedPassword = String(submitted.get("password") ?? password);
    setName(submittedName);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (mode === "recover") {
        const result = await authClient.requestPasswordReset({
          email: submittedEmail,
          redirectTo: "/reset-password",
        });
        if (result.error) throw new Error(result.error.message);
        setNotice(
          "If an account uses that email, a secure reset link is on its way.",
        );
        setSubmitting(false);
        return;
      }

      if (mode === "create" && !accountCreationEnabled) {
        throw new Error(
          "New email account registration is temporarily unavailable.",
        );
      }
      const result =
        mode === "create"
          ? await authClient.signUp.email({
              name: submittedName,
              email: submittedEmail,
              password: submittedPassword,
              callbackURL: "/auth/connected",
            })
          : await authClient.signIn.email({
              email: submittedEmail,
              password: submittedPassword,
              // Verified accounts are claimed below. Unverified accounts use
              // this same callback after the verification link auto-signs
              // them in, so their anonymous progress is never bypassed.
              callbackURL: "/auth/connected",
            });
      if (result.error) throw new Error(result.error.message);
      if (mode === "create" && emailVerificationEnabled) {
        setNotice(
          "Check your email to verify this account. Your browser progress will connect after verification.",
        );
        setPassword("");
        setSubmitting(false);
        return;
      }

      const claim = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
      if (!claim.ok) {
        throw new Error(
          "You are signed in, but browser progress could not be connected yet. Retry from Profile.",
        );
      }
      const cacheTransitioned = await transitionClaimedProgressCache(
        await claim.json(),
      );
      if (!cacheTransitioned) {
        throw new Error(
          "You are signed in, but this browser could not safely hand off its local progress. Allow site storage changes, then retry from Profile.",
        );
      }
      window.location.assign("/");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Account access could not be completed.",
      );
      setSubmitting(false);
    }
  }

  async function social(provider: "google" | "apple") {
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/auth/connected",
        errorCallbackURL: "/sign-in",
      });
      if (!result?.error) return;
      setError(result.error.message ?? "Social sign-in could not be started.");
      setSubmitting(false);
    } catch {
      setError(
        "Social sign-in could not be started. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div>
      {accountCreationEnabled ? (
        <div className={styles.tabs} role="tablist" aria-label="Account action">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            disabled={!hydrated || submitting}
            onClick={() => changeMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            disabled={!hydrated || submitting}
            onClick={() => changeMode("create")}
          >
            Create account
          </button>
        </div>
      ) : (
        <p className={styles.notice} role="status">
          New email account registration is temporarily unavailable. Existing
          learners can still sign in.
        </p>
      )}

      {(googleEnabled || appleEnabled) && mode !== "recover" && (
        <div className={styles.social}>
          {googleEnabled && (
            <button
              type="button"
              disabled={!hydrated || submitting}
              onClick={() => void social("google")}
            >
              Continue with Google
            </button>
          )}
          {appleEnabled && (
            <button
              type="button"
              disabled={!hydrated || submitting}
              onClick={() => void social("apple")}
            >
              Continue with Apple
            </button>
          )}
          <span>or use email</span>
        </div>
      )}

      <form
        ref={formRef}
        className={styles.form}
        onSubmit={submit}
        aria-describedby={error ? errorId : undefined}
      >
        {mode === "create" && (
          <label>
            <span>Name</span>
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              minLength={1}
              maxLength={80}
              required
            />
          </label>
        )}
        <label>
          <span>Email</span>
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        {mode !== "recover" && (
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "create" ? "new-password" : "current-password"
              }
              minLength={12}
              maxLength={128}
              required
            />
            {mode === "create" && (
              <small>Use at least 12 characters and a unique password.</small>
            )}
          </label>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        <button
          className={styles.submit}
          type="submit"
          disabled={!hydrated || submitting}
        >
          {submitting
            ? "Please wait…"
            : mode === "create"
              ? "Create and connect account"
              : mode === "recover"
                ? "Send secure reset link"
                : "Sign in and connect progress"}
        </button>
        {passwordResetEnabled && (
          <button
            className={styles.textButton}
            type="button"
            onClick={() =>
              changeMode(mode === "recover" ? "sign-in" : "recover")
            }
          >
            {mode === "recover" ? "Back to sign in" : "Forgot password?"}
          </button>
        )}
      </form>
    </div>
  );

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
  }
}
