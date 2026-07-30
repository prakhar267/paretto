"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { authClient } from "@/app/auth-client";
import {
  authDestination,
  DEFAULT_AUTH_RETURN,
  safeAuthReturn,
} from "@/app/auth-return";
import {
  normalizeParettoId,
  PARETTO_ID_MAX_LENGTH,
  PARETTO_ID_MIN_LENGTH,
} from "@/app/account-id";
import { transitionClaimedProgressCache } from "@/app/progress-cache";
import TurnstileWidget from "@/app/TurnstileWidget";
import type { TurnstileAction } from "@/app/turnstile";
import styles from "./auth.module.css";

type Mode = "create" | "sign-in" | "recover";
type RecoveryReceipt = {
  kind: "created" | "recovered";
  username: string;
  codes: string[];
};
type AccountResponse = {
  error?: string;
  code?: string;
  account?: { username?: string };
  username?: string;
  recoveryCodes?: unknown;
};

export default function AuthForm({
  googleEnabled,
  appleEnabled,
  accountCreationEnabled,
  recoveryEnabled,
  turnstileSiteKey,
  initialError = "",
  returnTo = DEFAULT_AUTH_RETURN,
}: {
  googleEnabled: boolean;
  appleEnabled: boolean;
  accountCreationEnabled: boolean;
  recoveryEnabled: boolean;
  turnstileSiteKey: string | null;
  initialError?: string;
  returnTo?: string;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [challengeReset, setChallengeReset] = useState(0);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [receipt, setReceipt] = useState<RecoveryReceipt | null>(null);
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [receiptStatus, setReceiptStatus] = useState("");
  const errorId = useId();
  const modeHeadingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const modeHeadingRef = useRef<HTMLHeadingElement>(null);
  const modeChangedRef = useRef(false);
  const destination = safeAuthReturn(returnTo);

  useLayoutEffect(() => {
    const fields = formRef.current?.elements;
    if (fields) {
      const usernameField = fields.namedItem("username");
      const passwordField = fields.namedItem("password");
      if (
        usernameField instanceof HTMLInputElement &&
        usernameField.value
      ) {
        setUsername(usernameField.value);
      }
      if (
        passwordField instanceof HTMLInputElement &&
        passwordField.value
      ) {
        setPassword(passwordField.value);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!receipt) return;
    receiptHeadingRef.current?.focus({ preventScroll: true });
    const clearSecrets = () => {
      setReceipt(null);
      setReceiptSaved(false);
      setReceiptStatus("");
    };
    window.addEventListener("pagehide", clearSecrets);
    return () => window.removeEventListener("pagehide", clearSecrets);
  }, [receipt]);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    if (!modeChangedRef.current || receipt) return;
    modeHeadingRef.current?.focus({ preventScroll: true });
  }, [mode, receipt]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = new FormData(event.currentTarget);
    const submittedUsername = normalizeParettoId(
      String(submitted.get("username") ?? username),
    );
    const submittedPassword = String(
      submitted.get("password") ?? password,
    );
    const submittedRecoveryCode = String(
      submitted.get("recoveryCode") ?? recoveryCode,
    );
    setUsername(submittedUsername);
    setPassword(submittedPassword);
    setRecoveryCode(submittedRecoveryCode);
    setSubmitting(true);
    setError("");
    setNotice("");
    let producedReceipt = false;

    try {
      if (mode === "create") {
        const payload = await accountRequest("/api/account/register", {
          username: submittedUsername,
          password: submittedPassword,
          turnstileToken,
        });
        const codes = parseRecoveryCodes(payload.recoveryCodes);
        if (!codes || payload.account?.username !== submittedUsername) {
          throw new Error(
            "The account was created, but its recovery receipt was incomplete. Sign in, then replace recovery codes from Profile.",
          );
        }
        producedReceipt = true;
        setReceipt({
          kind: "created",
          username: submittedUsername,
          codes,
        });
        setPassword("");
        setRecoveryCode("");
        setTurnstileToken("");
        return;
      }

      if (mode === "recover") {
        const payload = await accountRequest("/api/account/recover", {
          username: submittedUsername,
          recoveryCode: submittedRecoveryCode,
          password: submittedPassword,
          turnstileToken,
        });
        const codes = parseRecoveryCodes(payload.recoveryCodes);
        if (!codes || payload.username !== submittedUsername) {
          throw new Error(
            "The password was updated, but the new recovery receipt was incomplete. Sign in and replace recovery codes from Profile.",
          );
        }
        producedReceipt = true;
        setReceipt({
          kind: "recovered",
          username: submittedUsername,
          codes,
        });
        setPassword("");
        setRecoveryCode("");
        setTurnstileToken("");
        return;
      }

      await accountRequest("/api/account/sign-in", {
        username: submittedUsername,
        password: submittedPassword,
        turnstileToken,
      });
      await connectProgress();
      window.location.assign(destination);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Account access could not be completed.",
      );
    } finally {
      if (!producedReceipt) {
        setTurnstileToken("");
        setChallengeReset((current) => current + 1);
      }
      setSubmitting(false);
    }
  }

  async function social(provider: "google" | "apple") {
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: authDestination("/auth/connected", destination),
        errorCallbackURL: authDestination("/sign-in", destination),
      });
      if (!result?.error) return;
      setError(result.error.message ?? "Social sign-in could not be started.");
    } catch {
      setError(
        "Social sign-in could not be started. Check your connection and try again.",
      );
    }
    setSubmitting(false);
  }

  async function copyRecoveryCodes() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(recoveryReceiptText(receipt));
      setReceiptStatus("Recovery codes copied.");
    } catch {
      setReceiptStatus(
        "Copy was blocked. Select the visible codes or download them instead.",
      );
    }
  }

  function downloadRecoveryCodes() {
    if (!receipt) return;
    const blob = new Blob([recoveryReceiptText(receipt)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paretto-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setReceiptStatus("Recovery-code file downloaded.");
  }

  function finishReceipt() {
    if (!receipt || !receiptSaved) return;
    const kind = receipt.kind;
    const savedUsername = receipt.username;
    setReceipt(null);
    setReceiptSaved(false);
    setReceiptStatus("");
    setUsername(savedUsername);
    setMode("sign-in");
    setNotice(
      kind === "created"
        ? "Account created. Sign in to connect this browser’s progress."
        : "Password updated and other sessions signed out. Sign in with your new password.",
    );
    window.requestAnimationFrame(() =>
      usernameRef.current?.focus({ preventScroll: true }),
    );
  }

  if (receipt) {
    return (
      <section
        className={styles.recoveryReceipt}
        aria-labelledby="recovery-receipt-title"
      >
        <p className={styles.receiptEyebrow}>
          {receipt.kind === "created"
            ? "Account created"
            : "Access recovered"}
        </p>
        <h2
          id="recovery-receipt-title"
          ref={receiptHeadingRef}
          tabIndex={-1}
        >
          Save your recovery codes now.
        </h2>
        <p>
          These codes are shown once. Each code can recover{" "}
          <strong>{receipt.username}</strong>, and using one replaces the
          entire old set. Paretto Support cannot retrieve them.
        </p>
        <ol className={styles.recoveryCodes} aria-label="Recovery codes">
          {receipt.codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <div className={styles.receiptActions}>
          <button type="button" onClick={() => void copyRecoveryCodes()}>
            Copy all
          </button>
          <button type="button" onClick={downloadRecoveryCodes}>
            Download codes
          </button>
        </div>
        {receiptStatus && (
          <p className={styles.receiptStatus} role="status">
            {receiptStatus}
          </p>
        )}
        <label className={styles.savedCheck}>
          <input
            type="checkbox"
            checked={receiptSaved}
            onChange={(event) => setReceiptSaved(event.target.checked)}
          />
          <span>I saved these recovery codes somewhere private.</span>
        </label>
        <button
          className={styles.submit}
          type="button"
          disabled={!receiptSaved}
          onClick={finishReceipt}
        >
          Continue to sign in
        </button>
      </section>
    );
  }

  const action = challengeAction(mode);

  return (
    <div>
      <div className={styles.tabs} role="group" aria-label="Account action">
        <button
          type="button"
          aria-pressed={mode === "sign-in"}
          disabled={!hydrated || submitting}
          onClick={() => changeMode("sign-in")}
        >
          Sign in
        </button>
        {accountCreationEnabled && (
          <button
            type="button"
            aria-pressed={mode === "create"}
            disabled={!hydrated || submitting}
            onClick={() => changeMode("create")}
          >
            Create account
          </button>
        )}
      </div>

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
          <span>or use a Paretto ID</span>
        </div>
      )}

      <form
        ref={formRef}
        className={styles.form}
        onSubmit={submit}
        aria-describedby={error ? errorId : undefined}
        aria-labelledby={modeHeadingId}
        aria-busy={submitting}
      >
        <h2
          id={modeHeadingId}
          ref={modeHeadingRef}
          className={styles.formHeading}
          tabIndex={-1}
        >
          {mode === "create"
            ? "Choose a Paretto ID"
            : mode === "recover"
              ? "Recover your account"
              : "Welcome back"}
        </h2>
        <label>
          <span>Paretto ID</span>
          <input
            ref={usernameRef}
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={PARETTO_ID_MIN_LENGTH}
            maxLength={PARETTO_ID_MAX_LENGTH}
            required
          />
          {mode === "create" && (
            <small>
              {PARETTO_ID_MIN_LENGTH}–{PARETTO_ID_MAX_LENGTH} letters,
              numbers, periods, hyphens, or underscores. It is permanent and
              is saved in lowercase.
            </small>
          )}
        </label>
        {mode === "recover" && (
          <label>
            <span>Unused recovery code</span>
            <input
              name="recoveryCode"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              required
            />
          </label>
        )}
        <label>
          <span>
            {mode === "recover" ? "New password" : "Password"}
          </span>
          <input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            minLength={mode === "sign-in" ? 1 : 12}
            maxLength={128}
            required
          />
          {mode !== "sign-in" && (
            <small>
              Use at least 12 characters and a unique password.
            </small>
          )}
        </label>
        {mode === "create" && (
          <p className={styles.accountPromise}>
            No email is required. You will receive one-time recovery codes;
            save them because Support cannot recover them for you.
          </p>
        )}
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          action={action}
          resetKey={challengeReset}
          onTokenChange={setTurnstileToken}
        />
        {error && (
          <p
            id={errorId}
            ref={errorRef}
            className={styles.error}
            role="alert"
            tabIndex={-1}
          >
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
          disabled={!hydrated || submitting || !turnstileToken}
        >
          {submitting
            ? "Please wait…"
            : mode === "create"
              ? "Create account"
              : mode === "recover"
                ? "Recover and replace codes"
                : "Sign in and connect progress"}
        </button>
        {recoveryEnabled && mode !== "create" && (
          <button
            className={styles.textButton}
            type="button"
            disabled={submitting}
            onClick={() =>
              changeMode(mode === "recover" ? "sign-in" : "recover")
            }
          >
            {mode === "recover"
              ? "Back to sign in"
              : "Use a recovery code"}
          </button>
        )}
      </form>
    </div>
  );

  function changeMode(next: Mode) {
    modeChangedRef.current = true;
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setRecoveryCode("");
    setTurnstileToken("");
    setChallengeReset((current) => current + 1);
  }
}

async function accountRequest(
  path: string,
  body: Record<string, string>,
): Promise<AccountResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | AccountResponse
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error ??
        (response.status === 401
          ? "The Paretto ID or password is incorrect."
          : "Account access could not be completed. Please retry."),
    );
  }
  if (!payload) throw new Error("The account response was incomplete.");
  return payload;
}

function parseRecoveryCodes(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 8 ||
    !value.every(
      (code) =>
        typeof code === "string" &&
        /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}$/.test(code),
    )
  ) {
    return null;
  }
  return [...value];
}

function challengeAction(mode: Mode): TurnstileAction {
  if (mode === "create") return "account_create";
  if (mode === "recover") return "account_recover";
  return "account_sign_in";
}

async function connectProgress() {
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
}

function recoveryReceiptText(receipt: RecoveryReceipt): string {
  return [
    "Paretto recovery codes",
    `Paretto ID: ${receipt.username}`,
    "",
    ...receipt.codes,
    "",
    "Each code can be used once. Using one replaces this entire set.",
    "Keep these codes private. Paretto Support cannot retrieve them.",
  ].join("\n");
}
