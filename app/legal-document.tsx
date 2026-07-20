import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_EFFECTIVE_DATE = "July 20, 2026";

const LEGAL_LINKS = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Cookies & storage", "/cookies"],
  ["Accessibility", "/accessibility"],
  ["Attributions", "/attributions"],
  ["Support", "/support"],
] as const;

export function LegalDocument({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-page">
      <article className="legal-document">
        <header className="legal-header">
          <Link className="legal-brand" href="/" aria-label="Pas à Pas home">
            <span aria-hidden="true">p</span>
            Pas <em>à</em> Pas
          </Link>
          <nav aria-label="Legal and support">
            {LEGAL_LINKS.map(([label, href]) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {intro && <p className="legal-intro">{intro}</p>}
        <p className="legal-updated">Effective {LEGAL_EFFECTIVE_DATE}</p>

        <div className="legal-sections">{children}</div>

        <footer className="legal-footer">
          <Link className="primary-button" href="/">
            Back to learning
          </Link>
          <p>
            Questions or requests? <Link href="/support">Contact support</Link>.
          </p>
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
