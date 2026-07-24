import Link from "next/link";

export const metadata = { title: "Page not found — Loquivo" };

export default function NotFound() {
  return (
    <main className="recovery-screen">
      <div className="recovery-card">
        <p className="eyebrow">Wrong turn</p>
        <h1>This stop isn’t on the route.</h1>
        <p>The page may have moved, but your learning progress is unaffected.</p>
        <Link className="primary-button large" href="/">Return to Loquivo</Link>
      </div>
    </main>
  );
}
