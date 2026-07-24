import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authorizeAdmin } from "@/app/server-auth";
import styles from "../admin.module.css";
import AdminLoginForm from "./AdminLoginForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administrator sign-in",
  description: "Secure access to curriculum and learner-support administration.",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const requestHeaders = await headers();
  const authorization = await authorizeAdmin(requestHeaders);
  if (authorization.ok) redirect("/admin");

  return (
    <main className={styles.accessPage}>
      <section className={styles.accessCard}>
        <p className={styles.eyebrow}>Administration</p>
        <h1>Sign in to the studio</h1>
        <p>
          This area contains unpublished curriculum, learner support, operations,
          and audit records. Use the generated access key from your password
          manager. Sessions expire automatically after eight hours.
        </p>
        <AdminLoginForm />
        <Link href="/">Return to the learning app</Link>
      </section>
    </main>
  );
}
