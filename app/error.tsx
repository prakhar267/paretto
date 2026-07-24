"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "route_render_failed",
        digest: error.digest ?? null,
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <main className="recovery-screen">
      <div className="recovery-card" role="alert">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-name">Paretto</span>
        </div>
        <p className="eyebrow">A page slipped out of the journal</p>
        <h1>Let’s reopen this step.</h1>
        <p>
          Your saved learning progress has not been deleted. Retry the page; if
          it happens again, send the reference below to Support.
        </p>
        <button className="primary-button large" type="button" onClick={reset}>
          Try again
        </button>
        {error.digest && <small>Reference: {error.digest}</small>}
      </div>
    </main>
  );
}
