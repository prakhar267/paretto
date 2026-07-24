import { isRecord } from "@/app/api/_lib/api-utils";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SUPPORT_ACTION = "support_submit";
const MAX_TOKEN_LENGTH = 2_048;
const MAX_RESPONSE_BYTES = 32 * 1_024;
const DEVELOPMENT_SITE_KEY = "1x00000000000000000000AA";
const DEVELOPMENT_SECRET = "1x0000000000000000000000000000000AA";

export type TurnstileConfiguration = {
  siteKey: string;
  secret: string;
};

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; status: 400 | 503; error: string };

export function turnstileConfiguration(
  value: {
    TURNSTILE_SITE_KEY?: unknown;
    TURNSTILE_SECRET?: unknown;
  },
  options: { allowDevelopmentFallback?: boolean } = {},
): TurnstileConfiguration | null {
  if (
    isBoundedCredential(value.TURNSTILE_SITE_KEY) &&
    isBoundedCredential(value.TURNSTILE_SECRET)
  ) {
    return {
      siteKey: value.TURNSTILE_SITE_KEY,
      secret: value.TURNSTILE_SECRET,
    };
  }
  return options.allowDevelopmentFallback
    ? { siteKey: DEVELOPMENT_SITE_KEY, secret: DEVELOPMENT_SECRET }
    : null;
}

export async function loadTurnstileConfiguration(): Promise<TurnstileConfiguration | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return turnstileConfiguration(
      env as unknown as {
        TURNSTILE_SITE_KEY?: unknown;
        TURNSTILE_SECRET?: unknown;
      },
      { allowDevelopmentFallback: process.env.NODE_ENV === "development" },
    );
  } catch {
    return turnstileConfiguration(
      {},
      { allowDevelopmentFallback: process.env.NODE_ENV === "development" },
    );
  }
}

export async function loadTurnstilePublicSiteKey(): Promise<string | null> {
  return (await loadTurnstileConfiguration())?.siteKey ?? null;
}

export async function verifySupportTurnstile(
  token: unknown,
  request: Request,
  options: {
    configuration?: TurnstileConfiguration | null;
    fetcher?: typeof fetch;
  } = {},
): Promise<TurnstileVerification> {
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > MAX_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    return challengeRejected();
  }

  const configuration =
    options.configuration === undefined
      ? await loadTurnstileConfiguration()
      : options.configuration;
  if (!configuration) {
    return {
      ok: false,
      status: 503,
      error: "The security check is temporarily unavailable.",
    };
  }
  if (
    process.env.NODE_ENV === "development" &&
    configuration.siteKey === DEVELOPMENT_SITE_KEY &&
    configuration.secret === DEVELOPMENT_SECRET
  ) {
    return { ok: true };
  }

  const url = new URL(request.url);
  const form = new URLSearchParams({
    secret: configuration.secret,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  const remoteIp = normalizedClientIp(
    request.headers.get("cf-connecting-ip"),
  );
  if (remoteIp) form.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return verificationUnavailable();
  }
  if (!response.ok) return verificationUnavailable();

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    return verificationUnavailable();
  }

  let raw: string;
  let result: unknown;
  try {
    raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      return verificationUnavailable();
    }
    result = JSON.parse(raw);
  } catch {
    return verificationUnavailable();
  }
  if (
    !isRecord(result) ||
    result.success !== true ||
    result.action !== SUPPORT_ACTION ||
    typeof result.hostname !== "string" ||
    normalizeHostname(result.hostname) !== normalizeHostname(url.hostname)
  ) {
    return challengeRejected();
  }

  return { ok: true };
}

function isBoundedCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 256 &&
    !/\s/.test(value)
  );
}

function normalizedClientIp(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  return candidate.length >= 3 && candidate.length <= 128
    ? candidate
    : null;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function challengeRejected(): TurnstileVerification {
  return {
    ok: false,
    status: 400,
    error: "The security check expired or could not be verified. Please try again.",
  };
}

function verificationUnavailable(): TurnstileVerification {
  return {
    ok: false,
    status: 503,
    error: "The security check is temporarily unavailable.",
  };
}
