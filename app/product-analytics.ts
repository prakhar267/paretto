"use client";

export type ProductEventName =
  | "app_opened"
  | "onboarding_completed"
  | "navigation_changed"
  | "lesson_started"
  | "lesson_completed"
  | "challenge_started"
  | "challenge_completed"
  | "audio_played"
  | "audio_fallback"
  | "analytics_consent_updated";

export type ProductEventProperties = Record<
  string,
  string | number | boolean | null
>;

let sessionId: string | null = null;

export function trackProductEvent(
  enabled: boolean,
  event: ProductEventName,
  properties: ProductEventProperties = {},
) {
  if (!enabled || typeof window === "undefined") return;

  sessionId ??= createOpaqueSessionId();

  const body = JSON.stringify({
    event,
    sessionId,
    occurredAt: new Date().toISOString(),
    properties,
  });

  try {
    if (navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        "/api/events",
        new Blob([body], { type: "application/json" }),
      );
      if (accepted) return;
    }

    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics is deliberately best-effort and must never interrupt learning.
  }
}

function createOpaqueSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
