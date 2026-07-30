import type { Metadata } from "next";
import { safeAuthReturn } from "@/app/auth-return";
import ConnectedAccount from "./ConnectedAccount";

export const metadata: Metadata = {
  title: "Connecting account — Paretto",
  robots: { index: false, follow: false },
};

type ConnectedSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function ConnectedAccountPage({
  searchParams,
}: {
  searchParams?: ConnectedSearchParams;
} = {}) {
  const query =
    (await searchParams) ??
    {};
  return <ConnectedAccount returnTo={safeAuthReturn(query.returnTo)} />;
}
