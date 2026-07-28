import { timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_SCHEME = "pbkdf2-sha256-peppered-v3";
// Cloudflare Workers rejects a single Web Crypto PBKDF2 operation above
// 100,000 iterations. An independently stored, versioned secret is first used
// as an HMAC pepper, so a database-only breach still cannot perform an offline
// password attack.
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_DERIVED_BYTES = 32;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_PEPPER_DOMAIN = "paretto-password-pepper:v3";
const PASSWORD_PEPPER_CONFIGURATION_MAX_LENGTH = 256;
const PASSWORD_PEPPER_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;
const PASSWORD_PEPPER_MAX_KEYS = 3;
const PASSWORD_PEPPER_SECRET_MIN_LENGTH = 32;
const PASSWORD_PEPPER_SECRET_MAX_LENGTH = 128;
const encoder = new TextEncoder();

type PasswordPepperKeyring = {
  current: string;
  keys: ReadonlyMap<string, string>;
};

export type ParettoPasswordVerification = {
  valid: boolean;
  needsRehash: boolean;
};

export async function hashParettoPassword(password: string): Promise<string> {
  if (password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error("Password length is outside the supported range.");
  }
  const keyring = await requiredPasswordPepperKeyring();
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const derived = await derivePassword(
    password,
    salt,
    keyring.current,
    keyring.keys.get(keyring.current)!,
  );
  return [
    PASSWORD_HASH_SCHEME,
    String(PASSWORD_HASH_ITERATIONS),
    keyring.current,
    base64Url(salt),
    base64Url(derived),
  ].join("$");
}

export async function verifyParettoPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  return (await verifyParettoPasswordWithStatus(password, encodedHash)).valid;
}

export async function verifyParettoPasswordWithStatus(
  password: string,
  encodedHash: string,
): Promise<ParettoPasswordVerification> {
  if (password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    return invalidVerification();
  }
  const match = encodedHash.match(
    /^pbkdf2-sha256-peppered-v3\$100000\$([A-Za-z0-9_-]{1,16})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/,
  );
  if (!match) return invalidVerification();
  const [, keyId, encodedSalt, encodedDerived] = match;
  const salt = fromBase64Url(encodedSalt, PASSWORD_SALT_BYTES);
  const expected = fromBase64Url(encodedDerived, PASSWORD_DERIVED_BYTES);
  if (!salt || !expected) return invalidVerification();
  const keyring = await requiredPasswordPepperKeyring();
  const pepper = keyring.keys.get(keyId);
  if (!pepper) return invalidVerification();
  const actual = await derivePassword(password, salt, keyId, pepper);
  const valid = constantTimeEqual(actual, expected);
  return {
    valid,
    needsRehash: valid && keyId !== keyring.current,
  };
}

export async function parettoPasswordVerifierNeedsRehash(
  encodedHash: string,
): Promise<boolean> {
  const keyId = encodedHash.match(
    /^pbkdf2-sha256-peppered-v3\$100000\$([A-Za-z0-9_-]{1,16})\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
  )?.[1];
  if (!keyId) return false;
  const keyring = await requiredPasswordPepperKeyring();
  return keyring.keys.has(keyId) && keyId !== keyring.current;
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  keyId: string,
  pepper: string,
): Promise<Uint8Array> {
  const pepperKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const passwordKeyMaterial = await crypto.subtle.sign(
    "HMAC",
    pepperKey,
    encoder.encode(
      `${PASSWORD_PEPPER_DOMAIN}\u0000${keyId}\u0000${password}`,
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    passwordKeyMaterial,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer,
      iterations: PASSWORD_HASH_ITERATIONS,
    },
    key,
    PASSWORD_DERIVED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export function validParettoPasswordPepperConfiguration(
  value: unknown,
): boolean {
  return parsePasswordPepperKeyring(value) !== null;
}

async function requiredPasswordPepperKeyring(): Promise<PasswordPepperKeyring> {
  const { env } = await import("cloudflare:workers");
  const configured = (env as { PARETTO_PASSWORD_PEPPERS?: unknown })
    .PARETTO_PASSWORD_PEPPERS;
  const keyring = parsePasswordPepperKeyring(configured);
  if (keyring) return keyring;
  throw new Error(
    "PARETTO_PASSWORD_PEPPERS is not configured as a valid password-pepper keyring.",
  );
}

function parsePasswordPepperKeyring(
  value: unknown,
): PasswordPepperKeyring | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > PASSWORD_PEPPER_CONFIGURATION_MAX_LENGTH ||
    value !== value.trim()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const rootKeys = Object.keys(parsed);
    if (
      rootKeys.length !== 2 ||
      !rootKeys.includes("current") ||
      !rootKeys.includes("keys") ||
      typeof parsed.current !== "string" ||
      !PASSWORD_PEPPER_KEY_ID_PATTERN.test(parsed.current) ||
      !isRecord(parsed.keys)
    ) {
      return null;
    }
    const entries = Object.entries(parsed.keys);
    if (entries.length < 1 || entries.length > PASSWORD_PEPPER_MAX_KEYS) {
      return null;
    }
    const keys = new Map<string, string>();
    const secrets = new Set<string>();
    for (const [keyId, secret] of entries) {
      if (
        !PASSWORD_PEPPER_KEY_ID_PATTERN.test(keyId) ||
        typeof secret !== "string" ||
        secret.length < PASSWORD_PEPPER_SECRET_MIN_LENGTH ||
        secret.length > PASSWORD_PEPPER_SECRET_MAX_LENGTH ||
        secret !== secret.trim() ||
        secrets.has(secret)
      ) {
        return null;
      }
      keys.set(keyId, secret);
      secrets.add(secret);
    }
    if (!keys.has(parsed.current)) return null;
    return { current: parsed.current, keys };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidVerification(): ParettoPasswordVerification {
  return { valid: false, needsRehash: false };
}

function constantTimeEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  return timingSafeEqual(first, second);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(
  value: string,
  expectedBytes: number,
): Uint8Array | null {
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    if (binary.length !== expectedBytes) return null;
    const decoded = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    if (base64Url(decoded) !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}
