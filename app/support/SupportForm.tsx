"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_LOAD_TIMEOUT_MS = 12_000;

const CATEGORIES = [
  ["technical", "Technical or account-access problem"],
  ["content", "French content or audio"],
  ["feedback", "Product feedback"],
  ["privacy", "Privacy request"],
  ["other", "Something else"],
] as const;

type FormState = {
  category: (typeof CATEGORIES)[number][0];
  subject: string;
  body: string;
  replyEmail: string;
};

type ChallengeStatus =
  | "loading"
  | "ready"
  | "complete"
  | "expired"
  | "error"
  | "unavailable";

const INITIAL_FORM: FormState = {
  category: "technical",
  subject: "",
  body: "",
  replyEmail: "",
};

export default function SupportForm({
  turnstileSiteKey = null,
}: {
  turnstileSiteKey?: string | null;
}) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(
    turnstileSiteKey ? "loading" : "unavailable",
  );
  const [challengeMessage, setChallengeMessage] = useState(
    turnstileSiteKey
      ? "Loading the security check…"
      : "The security check is temporarily unavailable.",
  );
  const challengeContainerRef = useRef<HTMLDivElement>(null);
  const challengeWidgetRef = useRef<string | null>(null);
  const restartChallengeRef = useRef<(() => void) | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const receiptRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    // The server-rendered form is usable before React finishes hydrating. Capture
    // anything a fast learner typed so the first Turnstile state update cannot
    // replace it with the initial controlled values.
    const fields = formRef.current?.elements;
    if (!fields) return;
    const category = fields.namedItem("category");
    const subject = fields.namedItem("subject");
    const body = fields.namedItem("body");
    const replyEmail = fields.namedItem("replyEmail");
    if (
      !(category instanceof HTMLSelectElement) ||
      !(subject instanceof HTMLInputElement) ||
      !(body instanceof HTMLTextAreaElement) ||
      !(replyEmail instanceof HTMLInputElement)
    ) {
      return;
    }
    const hydratedForm: FormState = {
      category: CATEGORIES.some(([value]) => value === category.value)
        ? (category.value as FormState["category"])
        : INITIAL_FORM.category,
      subject: subject.value,
      body: body.value,
      replyEmail: replyEmail.value,
    };
    if (
      hydratedForm.category !== INITIAL_FORM.category ||
      hydratedForm.subject ||
      hydratedForm.body ||
      hydratedForm.replyEmail
    ) {
      setForm(hydratedForm);
    }
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || ticket) return;
    let active = true;
    const script =
      document.getElementById(TURNSTILE_SCRIPT_ID) ??
      createTurnstileScript();
    const loadTimeout = window.setTimeout(() => {
      if (!active || challengeWidgetRef.current) return;
      setChallengeStatus("error");
      setChallengeMessage(
        "The security check is taking too long to load. Reload it and try again.",
      );
    }, TURNSTILE_LOAD_TIMEOUT_MS);

    const renderChallenge = () => {
      if (
        !active ||
        !window.turnstile ||
        !challengeContainerRef.current ||
        challengeWidgetRef.current
      ) {
        return;
      }
      window.clearTimeout(loadTimeout);
      try {
        setChallengeStatus("ready");
        setChallengeMessage("Complete the security check to send.");
        challengeWidgetRef.current = window.turnstile.render(
          challengeContainerRef.current,
          {
            sitekey: turnstileSiteKey,
            action: "support_submit",
            theme: "auto",
            size: "flexible",
            callback: (token) => {
              if (!active) return;
              setTurnstileToken(token);
              setChallengeStatus("complete");
              setChallengeMessage("Security check complete.");
            },
            "expired-callback": () => {
              if (!active) return;
              setTurnstileToken("");
              setChallengeStatus("expired");
              setChallengeMessage(
                "The security check expired. Restart it to send your request.",
              );
            },
            "error-callback": () => {
              if (!active) return;
              setTurnstileToken("");
              setChallengeStatus("error");
              setChallengeMessage(
                "The security check could not load. Reload it and try again.",
              );
            },
          },
        );
      } catch {
        challengeWidgetRef.current = null;
        setChallengeStatus("error");
        setChallengeMessage(
          "The security check could not start. Reload it and try again.",
        );
      }
    };
    const handleScriptError = () => {
      if (active) {
        window.clearTimeout(loadTimeout);
        setChallengeStatus("error");
        setChallengeMessage(
          "The security check could not load. Reload it and try again.",
        );
      }
    };
    const restartChallenge = () => {
      if (!active || !window.turnstile) return;
      if (challengeWidgetRef.current) {
        try {
          window.turnstile.remove(challengeWidgetRef.current);
        } catch {
          // A failed third-party widget can already have removed itself.
        }
      }
      challengeWidgetRef.current = null;
      renderChallenge();
    };
    restartChallengeRef.current = restartChallenge;

    script.addEventListener("load", renderChallenge);
    script.addEventListener("error", handleScriptError);
    if (window.turnstile) renderChallenge();

    return () => {
      active = false;
      window.clearTimeout(loadTimeout);
      script.removeEventListener("load", renderChallenge);
      script.removeEventListener("error", handleScriptError);
      if (restartChallengeRef.current === restartChallenge) {
        restartChallengeRef.current = null;
      }
      if (window.turnstile && challengeWidgetRef.current) {
        try {
          window.turnstile.remove(challengeWidgetRef.current);
        } catch {
          // A failed third-party widget can already have removed itself.
        }
      }
      challengeWidgetRef.current = null;
    };
  }, [challengeAttempt, ticket, turnstileSiteKey]);

  useEffect(() => {
    if (ticket) receiptRef.current?.focus();
  }, [ticket]);

  function retryChallenge() {
    setTurnstileToken("");
    setChallengeStatus("loading");
    setChallengeMessage("Reloading the security check…");
    if (window.turnstile && restartChallengeRef.current) {
      restartChallengeRef.current();
      return;
    }
    if (!window.turnstile) {
      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    }
    setChallengeAttempt((current) => current + 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          subject: form.subject,
          body: form.body,
          turnstileToken,
          ...(form.replyEmail.trim() ? { replyEmail: form.replyEmail.trim() } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; request?: { id?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error ??
            (response.status === 401
              ? "Your browser session could not be established. Refresh and try again."
              : "The request could not be submitted. Please try again."),
        );
      }
      if (!payload?.request?.id) throw new Error("The support receipt was incomplete.");
      setTicket(payload.request.id);
      setForm(INITIAL_FORM);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request could not be submitted.");
    } finally {
      setTurnstileToken("");
      if (window.turnstile && challengeWidgetRef.current) {
        try {
          window.turnstile.reset(challengeWidgetRef.current);
          setChallengeStatus("ready");
          setChallengeMessage("Complete the security check to send.");
        } catch {
          setChallengeStatus("error");
          setChallengeMessage(
            "The security check could not restart. Reload it and try again.",
          );
        }
      }
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <>
        <section
          ref={receiptRef}
          className="support-receipt"
          aria-labelledby="support-receipt-title"
          role="status"
          tabIndex={-1}
        >
          <span aria-hidden="true">✓</span>
          <div>
            <h2 id="support-receipt-title">Request received</h2>
            <p>
              Keep this reference if you need to follow up: <code>{ticket}</code>
            </p>
            <button type="button" className="text-button" onClick={() => setTicket(null)}>
              Send another request
            </button>
          </div>
        </section>
        <SupportStatusLookup initialReference={ticket} />
      </>
    );
  }

  return (
    <>
      <section className="support-form-section" aria-labelledby="support-form-title">
        <h2 id="support-form-title">Create a support request</h2>
        <form ref={formRef} className="support-form" onSubmit={submit}>
        <label>
          What can we help with?
          <select
            name="category"
            value={form.category}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                category: event.target.value as FormState["category"],
              }))
            }
          >
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          Subject
          <input
            name="subject"
            required
            minLength={3}
            maxLength={120}
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            placeholder="A short summary"
          />
        </label>

        <label>
          Message
          <textarea
            name="body"
            aria-label="Message"
            aria-describedby="support-message-count"
            required
            minLength={10}
            maxLength={4000}
            rows={7}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            placeholder="What happened, what did you expect, and which device or lesson were you using?"
          />
          <small id="support-message-count">{form.body.length}/4,000 characters</small>
        </label>

        <label>
          Reply email <span>(optional)</span>
          <input
            name="replyEmail"
            type="email"
            maxLength={254}
            autoComplete="email"
            value={form.replyEmail}
            onChange={(event) => setForm((current) => ({ ...current, replyEmail: event.target.value }))}
            placeholder="you@example.com"
          />
        </label>

        <div
          ref={challengeContainerRef}
          className="turnstile-container"
          role="group"
          aria-label="Security check"
        />
        <div className="turnstile-feedback">
          <p className="turnstile-status" aria-live="polite">
            {challengeMessage}
          </p>
          {(challengeStatus === "error" || challengeStatus === "expired") && (
            <button
              className="text-button turnstile-retry"
              type="button"
              onClick={retryChallenge}
            >
              {challengeStatus === "expired"
                ? "Restart security check"
                : "Reload security check"}
            </button>
          )}
        </div>

        {error && <p className="support-error" role="alert">{error}</p>}

        <button
          className="primary-button large"
          type="submit"
          disabled={busy || !turnstileToken}
        >
          {busy ? "Sending…" : "Send securely"}
        </button>
        </form>
      </section>
      <SupportStatusLookup />
    </>
  );
}

type SupportStatus = {
  id: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  createdAt: string;
  updatedAt: string;
};

function SupportStatusLookup({
  initialReference = "",
}: {
  initialReference?: string;
}) {
  const [reference, setReference] = useState(initialReference);
  const [result, setResult] = useState<SupportStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const statusFormRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const field = statusFormRef.current?.elements.namedItem("reference");
    if (field instanceof HTMLInputElement && field.value !== initialReference) {
      setReference(field.value);
    }
    setHydrated(true);
  }, [initialReference]);

  useEffect(() => {
    if (result || error) resultRef.current?.focus();
  }, [error, result]);

  async function checkStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedReference = String(
      new FormData(event.currentTarget).get("reference") ?? "",
    ).trim();
    setReference(submittedReference);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `/api/support/${encodeURIComponent(submittedReference)}`,
        { headers: { accept: "application/json" } },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; request?: SupportStatus }
        | null;
      if (!response.ok || !payload?.request) {
        throw new Error(
          payload?.error ?? "The support status could not be checked.",
        );
      }
      setResult(payload.request);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The support status could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="support-form-section support-status-section"
      aria-labelledby="support-status-title"
    >
      <h2 id="support-status-title">Track a request</h2>
      <p>
        Use the same browser or signed-in learner account that sent the
        request.
      </p>
      <form
        ref={statusFormRef}
        className="support-status-form"
        onSubmit={checkStatus}
      >
        <label>
          Support reference
          <input
            name="reference"
            required
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            pattern="[0-9a-fA-F-]{36}"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="00000000-0000-4000-8000-000000000000"
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !hydrated}
        >
          {busy ? "Checking…" : "Check status"}
        </button>
      </form>
      {(result || error) && (
        <article
          ref={resultRef}
          className={error ? "support-error" : "support-status-result"}
          role={error ? "alert" : "status"}
          tabIndex={-1}
        >
          {error ? (
            error
          ) : (
            <>
              <strong>{humanSupportStatus(result!.status)}</strong>
              <span>{result!.subject}</span>
              <small>
                Updated {new Date(result!.updatedAt).toLocaleString()}
              </small>
            </>
          )}
        </article>
      )}
    </section>
  );
}

function humanSupportStatus(status: SupportStatus["status"]) {
  const labels: Record<SupportStatus["status"], string> = {
    open: "Open",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status];
}

function createTurnstileScript(): HTMLScriptElement {
  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  return script;
}
