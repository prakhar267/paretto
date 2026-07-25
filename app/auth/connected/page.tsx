import type { Metadata } from "next";
import ConnectedAccount from "./ConnectedAccount";

export const metadata: Metadata = {
  title: "Connecting account — Paretto",
  robots: { index: false, follow: false },
};

export default function ConnectedAccountPage() {
  return <ConnectedAccount />;
}
