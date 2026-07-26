"use client";

import { useEffect, useState } from "react";
import { retireLegacyProgressCache } from "@/app/progress-cache";

export default function ProgressIdentityGate({
  rotateAnonymousProfile,
}: {
  rotateAnonymousProfile: boolean;
}) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rotateAnonymousProfile) return;
    let active = true;

    async function rotate() {
      retireLegacyProgressCache();
      try {
        const response = await fetch("/api/account/browser-profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error("A fresh browser profile could not be created.");
        }
        window.location.replace("/");
      } catch {
        if (active) {
          setError(
            "Paretto could not create a fresh private browser profile. Check your connection, then retry.",
          );
        }
      }
    }

    void rotate();
    return () => {
      active = false;
    };
  }, [rotateAnonymousProfile]);

  return (
    <main className="recovery-shell">
      <section className="recovery-card" aria-live="polite">
        <p className="eyebrow">Private learning profile</p>
        <h1>
          {error
            ? "Your learning profile needs another try."
            : rotateAnonymousProfile
              ? "Preparing a fresh browser profile…"
              : "Your learning profile is temporarily unavailable."}
        </h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </>
        ) : (
          <p>
            {rotateAnonymousProfile
              ? "No account or previous learner cache will be shown while the identity changes."
              : "Please refresh after the account service is available again."}
          </p>
        )}
      </section>
    </main>
  );
}
