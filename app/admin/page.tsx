import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

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
  const authorization = await authorizeAdmin(requestHeaders);

  if (!authorization.ok && authorization.status === 401) {
    redirect("/admin/login");
  }
  if (!authorization.ok) {
    return (
      <main className={styles.accessPage}>
        <section className={styles.accessCard}>
          <p className={styles.eyebrow}>Pas à Pas administration</p>
          <h1>Access unavailable</h1>
          <p>
            Administrator authentication is not configured. Verify the
            allowlisted email, password verifier, and session secret.
          </p>
          <Link href="/">Return to the learning app</Link>
        </section>
      </main>
    );
  }

  return <AdminConsole adminEmail={authorization.email} />;
}
