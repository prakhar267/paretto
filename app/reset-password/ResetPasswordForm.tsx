"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { authClient } from "@/app/auth-client";
import styles from "../sign-in/auth.module.css";

export default function ResetPasswordForm() {
  const search = useSearchParams();
  const token = search.get("token") ?? "";
  const invalidToken = Boolean(search.get("error"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const field = formRef.current?.elements.namedItem("password");
    if (field instanceof HTMLInputElement && field.value) {
      setPassword(field.value);
    }
    setHydrated(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedPassword = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );
    setPassword(submittedPassword);
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.resetPassword({
        newPassword: submittedPassword,
        token,
      });
      if (result.error) {
        setError(
          result.error.message ?? "This reset link is invalid or expired.",
        );
        setSubmitting(false);
        return;
      }
      setComplete(true);
    } catch {
      setError(
        "The password could not be updated. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Account recovery</p>
        <h1>{complete ? "Password updated." : "Choose a new password."}</h1>
        {complete ? (
          <p>
            Your other sessions were revoked for safety.{" "}
            <Link href="/sign-in">Sign in again</Link>.
          </p>
        ) : token ? (
          <form ref={formRef} className={styles.form} onSubmit={submit}>
            <label>
              <span>New password</span>
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <small>Use at least 12 characters and a unique password.</small>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              className={styles.submit}
              type="submit"
              disabled={!hydrated || submitting}
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : (
          <p role="alert">
            {invalidToken
              ? "This reset link is invalid or expired. "
              : "This reset link is incomplete. "}
            <Link href="/sign-in">Request another link</Link>.
          </p>
        )}
      </section>
    </main>
  );
}
