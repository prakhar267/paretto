import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { authorizeAdmin } from "@/app/server-auth";
import AdminConsole from "./AdminConsole";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Curriculum studio — Pas à Pas",
  description: "Secure curriculum and learner-support administration.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const authorization = await authorizeAdmin(
    requestHeaders,
    new URL(`${protocol}://${host}/admin`),
  );

  if (!authorization.ok && authorization.status === 401) {
    redirect(chatGPTSignInPath("/admin"));
  }
  if (!authorization.ok) {
    return (
      <main className={styles.accessPage}>
        <section className={styles.accessCard}>
          <p className={styles.eyebrow}>Pas à Pas administration</p>
          <h1>Access unavailable</h1>
          <p>
            This account is not on the administrator allowlist, or the
            ADMIN_EMAILS environment binding has not been configured.
          </p>
          <Link href="/">Return to the learning app</Link>
        </section>
      </main>
    );
  }

  return <AdminConsole adminEmail={authorization.email} />;
}
