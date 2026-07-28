import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Reset password — Paretto",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  redirect("/sign-in");
}
