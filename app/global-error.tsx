"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#17233b", padding: 24 }}>
          <section style={{ width: "min(100%, 560px)", borderRadius: 24, background: "#fff8ee", padding: 42, textAlign: "center", color: "#17233b" }} role="alert">
            <p style={{ color: "#315c8c", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".12em" }}>Paretto</p>
            <h1 style={{ fontSize: 42, lineHeight: 1.05 }}>The journal needs a fresh page.</h1>
            <p>Your saved server progress remains separate from this display error.</p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 18, marginTop: 24 }}>
              <button style={{ minHeight: 48, border: 0, borderRadius: 12, background: "#315c8c", padding: "0 22px", color: "white", fontWeight: 800 }} type="button" onClick={reset}>Reload the app</button>
              <a style={{ minHeight: 48, display: "inline-flex", alignItems: "center", color: "#315c8c", fontWeight: 800, textUnderlineOffset: 3 }} href="/support">Contact Support</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
