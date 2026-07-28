"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/app/turnstile";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_LOAD_TIMEOUT_MS = 12_000;

type ChallengeStatus =
  | "loading"
  | "ready"
  | "complete"
  | "expired"
  | "error"
  | "unavailable";

type TurnstileClientApi = {
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
    turnstile?: TurnstileClientApi;
  }
}

export default function TurnstileWidget({
  siteKey,
  action,
  onTokenChange,
  resetKey = 0,
}: {
  siteKey: string | null;
  action: TurnstileAction;
  onTokenChange: (token: string) => void;
  resetKey?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ChallengeStatus>(
    siteKey ? "loading" : "unavailable",
  );
  const [message, setMessage] = useState(
    siteKey
      ? "Loading the security check…"
      : "The security check is temporarily unavailable.",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const callbackRef = useRef(onTokenChange);

  useEffect(() => {
    callbackRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    callbackRef.current("");
    if (!siteKey) {
      return;
    }

    let active = true;
    const script =
      document.getElementById(TURNSTILE_SCRIPT_ID) ??
      createTurnstileScript();
    const timeout = window.setTimeout(() => {
      if (!active || widgetRef.current) return;
      setStatus("error");
      setMessage(
        "The security check is taking too long. Reload it and try again.",
      );
    }, TURNSTILE_LOAD_TIMEOUT_MS);

    const render = () => {
      if (
        !active ||
        !window.turnstile ||
        !containerRef.current ||
        widgetRef.current
      ) {
        return;
      }
      window.clearTimeout(timeout);
      try {
        setStatus("ready");
        setMessage("Complete the security check to continue.");
        widgetRef.current = window.turnstile.render(
          containerRef.current,
          {
            sitekey: siteKey,
            action,
            theme: "auto",
            size: "flexible",
            callback: (token) => {
              if (!active) return;
              callbackRef.current(token);
              setStatus("complete");
              setMessage("Security check complete.");
            },
            "expired-callback": () => {
              if (!active) return;
              callbackRef.current("");
              setStatus("expired");
              setMessage(
                "The security check expired. Restart it to continue.",
              );
            },
            "error-callback": () => {
              if (!active) return;
              callbackRef.current("");
              setStatus("error");
              setMessage(
                "The security check could not load. Reload it and try again.",
              );
            },
          },
        );
      } catch {
        widgetRef.current = null;
        setStatus("error");
        setMessage(
          "The security check could not start. Reload it and try again.",
        );
      }
    };
    const scriptError = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      setStatus("error");
      setMessage(
        "The security check could not load. Reload it and try again.",
      );
    };
    script.addEventListener("load", render);
    script.addEventListener("error", scriptError);
    if (window.turnstile) render();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      script.removeEventListener("load", render);
      script.removeEventListener("error", scriptError);
      callbackRef.current("");
      if (window.turnstile && widgetRef.current) {
        try {
          window.turnstile.remove(widgetRef.current);
        } catch {
          // A failed third-party widget can already have removed itself.
        }
      }
      widgetRef.current = null;
    };
  }, [action, attempt, resetKey, siteKey]);

  function retry() {
    callbackRef.current("");
    setStatus("loading");
    setMessage("Reloading the security check…");
    if (!window.turnstile) {
      document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
    }
    setAttempt((current) => current + 1);
  }

  return (
    <div className="turnstile-widget">
      <div
        ref={containerRef}
        className="turnstile-container"
        role="group"
        aria-label="Security check"
      />
      <div className="turnstile-feedback">
        <p className="turnstile-status" aria-live="polite">
          {siteKey
            ? message
            : "The security check is temporarily unavailable."}
        </p>
        {siteKey && (status === "error" || status === "expired") && (
          <button
            className="text-button turnstile-retry"
            type="button"
            onClick={retry}
          >
            {status === "expired"
              ? "Restart security check"
              : "Reload security check"}
          </button>
        )}
      </div>
    </div>
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
