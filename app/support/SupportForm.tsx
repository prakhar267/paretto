"use client";

import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto";
      size: "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const CATEGORIES = [
  ["technical", "Technical problem"],
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
  const [challengeMessage, setChallengeMessage] = useState(
    turnstileSiteKey
      ? "Loading the security check…"
      : "The security check is temporarily unavailable.",
  );
  const challengeContainerRef = useRef<HTMLDivElement>(null);
  const challengeWidgetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey || ticket) return;
    let active = true;
    const script =
      document.getElementById(TURNSTILE_SCRIPT_ID) ??
      createTurnstileScript();

    const renderChallenge = () => {
      if (
        !active ||
        !window.turnstile ||
        !challengeContainerRef.current ||
        challengeWidgetRef.current
      ) {
        return;
      }
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
            setChallengeMessage("Security check complete.");
          },
          "expired-callback": () => {
            if (!active) return;
            setTurnstileToken("");
            setChallengeMessage(
              "The security check expired. Complete it again.",
            );
          },
          "error-callback": () => {
            if (!active) return;
            setTurnstileToken("");
            setChallengeMessage(
              "The security check could not load. Please retry.",
            );
          },
        },
      );
    };
    const handleScriptError = () => {
      if (active) {
        setChallengeMessage(
          "The security check could not load. Please retry.",
        );
      }
    };

    script.addEventListener("load", renderChallenge);
    script.addEventListener("error", handleScriptError);
    if (window.turnstile) renderChallenge();

    return () => {
      active = false;
      script.removeEventListener("load", renderChallenge);
      script.removeEventListener("error", handleScriptError);
      if (window.turnstile && challengeWidgetRef.current) {
        window.turnstile.remove(challengeWidgetRef.current);
      }
      challengeWidgetRef.current = null;
      setTurnstileToken("");
    };
  }, [ticket, turnstileSiteKey]);

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
        window.turnstile.reset(challengeWidgetRef.current);
        setChallengeMessage("Complete the security check to send.");
      }
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <section className="support-receipt" aria-labelledby="support-receipt-title" role="status">
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
    );
  }

  return (
    <section className="support-form-section" aria-labelledby="support-form-title">
      <h2 id="support-form-title">Create a support request</h2>
      <form className="support-form" onSubmit={submit}>
        <label>
          What can we help with?
          <select
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
            required
            minLength={10}
            maxLength={4000}
            rows={7}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            placeholder="What happened, what did you expect, and which device or lesson were you using?"
          />
          <small>{form.body.length}/4,000 characters</small>
        </label>

        <label>
          Reply email <span>(optional)</span>
          <input
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
        <p className="turnstile-status" aria-live="polite">
          {challengeMessage}
        </p>

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
  );
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
