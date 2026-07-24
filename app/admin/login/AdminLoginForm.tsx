"use client";

import { useState } from "react";

import styles from "../admin.module.css";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Sign-in could not be completed.");
      }
      window.location.assign("/admin");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sign-in could not be completed.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={submit}>
      <label>
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          maxLength={254}
          required
        />
      </label>
      <label>
        <span>Admin access key</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          minLength={32}
          maxLength={256}
          required
        />
      </label>
      {error && (
        <p className={styles.loginError} role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in securely"}
      </button>
    </form>
  );
}
