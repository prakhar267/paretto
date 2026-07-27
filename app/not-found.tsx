export const metadata = { title: "Page not found — Paretto" };

export default function NotFound() {
  return (
    <main className="recovery-screen">
      <div className="recovery-card">
        <p className="eyebrow">Wrong turn</p>
        <h1>This stop isn’t on the route.</h1>
        <p>The page may have moved, but your learning progress is unaffected.</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Recovery deliberately uses a fresh document after a failed route. */}
        <a className="primary-button large" href="/">Return to Paretto</a>
      </div>
    </main>
  );
}
