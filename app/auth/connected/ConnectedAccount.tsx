"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { transitionClaimedProgressCache } from "@/app/progress-cache";

export default function ConnectedAccount() {
  const [error, setError] = useState("");

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
        window.location.replace("/");
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
  }, []);

  return (
    <main className="recovery-shell">
      <section className="recovery-card" aria-live="polite">
        <p className="eyebrow">Paretto account</p>
        <h1>{error ? "Connection needs another try." : "Connecting your progress…"}</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Link href="/">Return to Paretto</Link>
          </>
        ) : (
          <p>Please keep this page open for a moment.</p>
        )}
      </section>
    </main>
  );
}
