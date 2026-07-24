const ADMIN_COOKIE_NAME = "__Host-admin-session";
const SESSION_VERSION = 1;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const VERIFIER_PATTERN = /^sha256\$([A-Za-z0-9_-]{43})$/;

export type AdminAuthConfiguration = {
  emails: ReadonlySet<string>;
  passwordVerifiers: ReadonlyMap<string, PasswordVerifier>;
  sessionSecret: string;
};

type PasswordVerifier = {
  digest: Uint8Array;
};

export function adminAuthConfiguration(value: {
  ADMIN_EMAILS?: unknown;
  ADMIN_PASSWORD_VERIFIER?: unknown;
  ADMIN_PASSWORD_VERIFIERS?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
}): AdminAuthConfiguration | null {
  const emails = parseAdminAllowlist(value.ADMIN_EMAILS);
  if (
    emails.size < 1 ||
    emails.size > 25 ||
    typeof value.ADMIN_SESSION_SECRET !== "string" ||
    value.ADMIN_SESSION_SECRET.length < 32
  ) {
    return null;
  }

  const passwordVerifiers = parsePasswordVerifiers(value, emails);
  if (!passwordVerifiers) {
    return null;
  }

  return {
    emails,
    passwordVerifiers,
    sessionSecret: value.ADMIN_SESSION_SECRET,
  };
}

export async function loadAdminAuthConfiguration(): Promise<AdminAuthConfiguration | null> {
  const { env } = await import("cloudflare:workers");
  return adminAuthConfiguration(
    env as unknown as {
      ADMIN_EMAILS?: unknown;
      ADMIN_PASSWORD_VERIFIER?: unknown;
      ADMIN_PASSWORD_VERIFIERS?: unknown;
      ADMIN_SESSION_SECRET?: unknown;
    },
  );
}

export async function verifyAdminCredentials(
  submittedEmail: unknown,
  submittedPassword: unknown,
  configuration: AdminAuthConfiguration,
): Promise<{ ok: true; email: string } | { ok: false }> {
  if (
    typeof submittedPassword !== "string" ||
    submittedPassword.length < 32 ||
    submittedPassword.length > 256
  ) {
    return { ok: false };
  }

  const email = normalizeEmail(submittedEmail);
  const passwordVerifier =
    (email ? configuration.passwordVerifiers.get(email) : undefined) ??
    configuration.passwordVerifiers.values().next().value;
  if (!passwordVerifier) return { ok: false };
  const derived = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(submittedPassword),
    ),
  );

  return email &&
    configuration.emails.has(email) &&
    constantTimeEqual(derived, passwordVerifier.digest)
    ? { ok: true, email }
    : { ok: false };
}

export async function createAdminSessionCookie(
  configuration: AdminAuthConfiguration,
  email: string,
  now = Date.now(),
): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !configuration.emails.has(normalizedEmail)) {
    throw new Error("Administrator identity is not configured.");
  }
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: SESSION_VERSION,
        email: normalizedEmail,
        iat: now,
        exp: now + SESSION_LIFETIME_MS,
        nonce: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
      }),
    ),
  );
  const signature = await hmac(
    configuration.sessionSecret,
    `admin-session:${payload}`,
  );
  return [
    `${ADMIN_COOKIE_NAME}=${payload}.${encodeBase64Url(signature)}`,
    "Path=/",
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function clearAdminSessionCookie(): string {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export async function verifyAdminSession(
  requestHeaders: Pick<Headers, "get">,
  configuration: AdminAuthConfiguration,
  now = Date.now(),
): Promise<{ ok: true; email: string } | { ok: false }> {
  const rawCookie = readUniqueCookie(
    requestHeaders.get("cookie"),
    ADMIN_COOKIE_NAME,
  );
  if (!rawCookie || rawCookie.length > 2_048) return { ok: false };
  const parts = rawCookie.split(".");
  if (parts.length !== 2 || parts.some((part) => !part)) return { ok: false };

  let signature: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    signature = decodeBase64Url(parts[1]);
    payloadBytes = decodeBase64Url(parts[0]);
  } catch {
    return { ok: false };
  }
  if (signature.byteLength !== 32 || payloadBytes.byteLength > 1_024) {
    return { ok: false };
  }

  const key = await importHmacKey(configuration.sessionSecret);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    arrayBufferCopy(signature),
    new TextEncoder().encode(`admin-session:${parts[0]}`),
  );
  if (!validSignature) return { ok: false };

  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    );
  } catch {
    return { ok: false };
  }
  if (
    !isRecord(payload) ||
    payload.v !== SESSION_VERSION ||
    !configuration.emails.has(normalizeEmail(payload.email) ?? "") ||
    typeof payload.iat !== "number" ||
    !Number.isInteger(payload.iat) ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + CLOCK_SKEW_MS ||
    payload.exp <= now ||
    payload.exp - payload.iat !== SESSION_LIFETIME_MS ||
    typeof payload.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(payload.nonce)
  ) {
    return { ok: false };
  }

  return { ok: true, email: normalizeEmail(payload.email)! };
}

export async function hmacAdminLoginIp(
  sessionSecret: string,
  ipAddress: string,
): Promise<string> {
  const digest = await hmac(
    sessionSecret,
    `admin-login-ip:${ipAddress.slice(0, 128)}`,
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseAdminAllowlist(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((entry) => normalizeEmail(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
}

function parsePasswordVerifiers(
  value: {
    ADMIN_PASSWORD_VERIFIER?: unknown;
    ADMIN_PASSWORD_VERIFIERS?: unknown;
  },
  emails: ReadonlySet<string>,
): Map<string, PasswordVerifier> | null {
  if (typeof value.ADMIN_PASSWORD_VERIFIERS === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.ADMIN_PASSWORD_VERIFIERS);
    } catch {
      return null;
    }
    if (!isRecord(parsed) || Object.keys(parsed).length !== emails.size) {
      return null;
    }
    const verifiers = new Map<string, PasswordVerifier>();
    for (const [rawEmail, rawVerifier] of Object.entries(parsed)) {
      const email = normalizeEmail(rawEmail);
      if (
        !email ||
        email !== rawEmail ||
        !emails.has(email) ||
        typeof rawVerifier !== "string" ||
        verifiers.has(email)
      ) {
        return null;
      }
      const verifier = parsePasswordVerifier(rawVerifier);
      if (!verifier) return null;
      verifiers.set(email, verifier);
    }
    return verifiers.size === emails.size ? verifiers : null;
  }

  if (
    emails.size !== 1 ||
    typeof value.ADMIN_PASSWORD_VERIFIER !== "string"
  ) {
    return null;
  }
  const verifier = parsePasswordVerifier(value.ADMIN_PASSWORD_VERIFIER);
  return verifier
    ? new Map([[emails.values().next().value!, verifier]])
    : null;
}

function parsePasswordVerifier(value: string): PasswordVerifier | null {
  const match = value.match(VERIFIER_PATTERN);
  if (!match) return null;
  let digest: Uint8Array;
  try {
    digest = decodeBase64Url(match[1]);
  } catch {
    return null;
  }
  return digest.byteLength === 32 ? { digest } : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function readUniqueCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return matches.length === 1 ? matches[0] : null;
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
