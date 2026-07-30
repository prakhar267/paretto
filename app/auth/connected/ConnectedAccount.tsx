"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_AUTH_RETURN,
  safeAuthReturn,
} from "@/app/auth-return";
import { transitionClaimedProgressCache } from "@/app/progress-cache";

export default function ConnectedAccount({
  returnTo = DEFAULT_AUTH_RETURN,
}: {
  returnTo?: string;
}) {
  const [error, setError] = useState("");
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const destination = safeAuthReturn(returnTo);

  useEffect(() => {
    let active = true;
    async function connect() {
      try {
        const response = await fetch("/api/account/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Progress connection failed.");
        const cacheTransitioned = await transitionClaimedProgressCache(
          await response.json(),
        );
        if (!cacheTransitioned) {
          throw new Error("Local progress handoff failed.");
        }
        window.location.replace(destination);
      } catch {
        if (active) {
          setError(
            "You are signed in, but progress could not be connected. Return to Profile and retry.",
          );
        }
      }
    }
    void connect();
    return () => {
      active = false;
    };
  }, [destination]);

  useEffect(() => {
    if (!error) return;
    errorHeadingRef.current?.focus({ preventScroll: true });
  }, [error]);

  return (
    <main className="recovery-shell">
      <section className="recovery-card" aria-live="polite">
        <p className="eyebrow">Paretto account</p>
        <h1 ref={errorHeadingRef} tabIndex={error ? -1 : undefined}>
          {error ? "Connection needs another try." : "Connecting your progress…"}
        </h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Link href={destination}>Return to Paretto</Link>
          </>
        ) : (
          <p>Please keep this page open for a moment.</p>
        )}
      </section>
    </main>
  );
}
