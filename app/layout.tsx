import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const protocol = (
    requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  )
    .split(",")[0]
    .trim();
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: "Pas à Pas — Learn French, one region at a time",
    description:
      "Build lasting French vocabulary with five-minute lessons, adaptive reviews, pronunciation, and a cultural journey through all 18 regions of France.",
    applicationName: "Pas à Pas",
    icons: { icon: "/favicon.svg" },
    keywords: [
      "learn French",
      "French vocabulary",
      "spaced repetition",
      "French pronunciation",
      "language learning",
    ],
    openGraph: {
      title: "Pas à Pas — Your five-minute French journey",
      description:
        "Remember useful French and travel through all 18 regions, one small session at a time.",
      siteName: "Pas à Pas",
      type: "website",
      url: metadataBase,
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "Pas à Pas — French, one region at a time.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Pas à Pas — Your five-minute French journey",
      description:
        "Remember useful French and travel through all 18 regions, one small session at a time.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17233b",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${fraunces.variable}`}>{children}</body>
    </html>
  );
}
