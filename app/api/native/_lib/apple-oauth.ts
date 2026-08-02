import { isRecord } from "@/app/api/_lib/api-utils";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const CLIENT_SECRET_LIFETIME_SECONDS = 5 * 60;
const MAX_APPLE_RESPONSE_BYTES = 32 * 1024;

export type AppleOAuthConfiguration = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
};

export function applePrivateKeyFromBindings(value: {
  APPLE_PRIVATE_KEY?: unknown;
  APPLE_PRIVATE_KEY_BASE64?: unknown;
}): string | undefined {
  if (typeof value.APPLE_PRIVATE_KEY === "string") {
    return value.APPLE_PRIVATE_KEY;
  }
  if (
    typeof value.APPLE_PRIVATE_KEY_BASE64 !== "string" ||
    value.APPLE_PRIVATE_KEY_BASE64.length < 100 ||
    value.APPLE_PRIVATE_KEY_BASE64.length > 16_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.APPLE_PRIVATE_KEY_BASE64)
  ) {
    return undefined;
  }
  try {
    const decoded = Uint8Array.from(
      atob(value.APPLE_PRIVATE_KEY_BASE64),
      (character) => character.charCodeAt(0),
    );
    const privateKey = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    return privateKey.length >= 100 && privateKey.length <= 10_000
      ? privateKey
      : undefined;
  } catch {
    return undefined;
  }
}

export type AppleServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid_grant" | "unavailable" };

export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
  configuration: AppleOAuthConfiguration,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<
  AppleServiceResult<{ refreshToken: string; identityToken: string }>
> {
  if (!validAppleOpaqueToken(authorizationCode)) {
    return { ok: false, reason: "invalid_grant" };
  }
  const clientSecret = await createAppleClientSecret(
    configuration,
    options.now,
  );
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: "authorization_code",
  });
  const response = await appleRequest(
    APPLE_TOKEN_URL,
    body,
    options.fetcher ?? fetch,
  );
  if (!response.ok) return response;
  const value = response.value;
  if (
    !isRecord(value) ||
    !validAppleOpaqueToken(value.refresh_token) ||
    typeof value.id_token !== "string" ||
    value.id_token.length < 64 ||
    value.id_token.length > 16_384 ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    !Number.isInteger(value.expires_in) ||
    Number(value.expires_in) < 1 ||
    Number(value.expires_in) > 86_400
  ) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    value: {
      refreshToken: value.refresh_token,
      identityToken: value.id_token,
    },
  };
}

export async function revokeAppleRefreshToken(
  refreshToken: string,
  configuration: AppleOAuthConfiguration,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<AppleServiceResult<null>> {
  if (!validAppleOpaqueToken(refreshToken)) {
    return { ok: false, reason: "invalid_grant" };
  }
  const clientSecret = await createAppleClientSecret(
    configuration,
    options.now,
  );
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  const response = await (options.fetcher ?? fetch)(APPLE_REVOKE_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response) return { ok: false, reason: "unavailable" };
  if (response.ok) return { ok: true, value: null };
  return {
    ok: false,
    reason: await appleFailureReason(response),
  };
}

export async function createAppleClientSecret(
  configuration: AppleOAuthConfiguration,
  now = Date.now(),
): Promise<string> {
  const nowSeconds = Math.floor(now / 1000);
  const encodedHeader = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ alg: "ES256", kid: configuration.keyId }),
    ),
  );
  const encodedPayload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: configuration.teamId,
        iat: nowSeconds,
        exp: nowSeconds + CLIENT_SECRET_LIFETIME_SECONDS,
        aud: APPLE_AUDIENCE,
        sub: configuration.clientId,
      }),
    ),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importApplePrivateKey(configuration.privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const bytes = new Uint8Array(signature);
  if (bytes.byteLength !== 64) {
    throw new Error("Apple client-secret signature has an unsupported format");
  }
  return `${signingInput}.${base64Url(bytes)}`;
}

export async function encryptAppleRefreshToken(
  refreshToken: string,
  encryptionSecret: string,
  accountId: string,
): Promise<string> {
  if (!validAppleOpaqueToken(refreshToken)) {
    throw new Error("Apple refresh token is malformed");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(accountId),
    },
    await appleTokenEncryptionKey(encryptionSecret),
    new TextEncoder().encode(refreshToken),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptAppleRefreshToken(
  encryptedToken: string,
  encryptionSecret: string,
  accountId: string,
): Promise<string | null> {
  try {
    if (encryptedToken.length > 24_000) return null;
    const [version, encodedIv, encodedCiphertext, extra] = encryptedToken.split(".");
    if (version !== "v1" || extra !== undefined) return null;
    const iv = decodeBase64Url(encodedIv);
    const ciphertext = decodeBase64Url(encodedCiphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: arrayBufferCopy(iv),
        additionalData: new TextEncoder().encode(accountId),
      },
      await appleTokenEncryptionKey(encryptionSecret),
      arrayBufferCopy(ciphertext),
    );
    const token = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    return validAppleOpaqueToken(token) ? token : null;
  } catch {
    return null;
  }
}

export function validAppleOAuthConfiguration(
  value: Partial<Record<keyof AppleOAuthConfiguration, unknown>>,
): value is AppleOAuthConfiguration {
  if (typeof value.privateKey !== "string") return false;
  const normalizedPrivateKey = value.privateKey.trim().replaceAll("\\n", "\n");
  const privateKeyMatch = normalizedPrivateKey.match(
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----$/,
  );
  return (
    typeof value.clientId === "string" &&
    /^[A-Za-z0-9.-]{3,255}$/.test(value.clientId) &&
    typeof value.teamId === "string" &&
    /^[A-Z0-9]{10}$/.test(value.teamId) &&
    typeof value.keyId === "string" &&
    /^[A-Z0-9]{10}$/.test(value.keyId) &&
    value.privateKey.length >= 100 &&
    value.privateKey.length <= 10_000 &&
    privateKeyMatch !== null &&
    privateKeyMatch[1].replace(/\s+/g, "").length >= 80 &&
    privateKeyMatch[1].replace(/\s+/g, "").length <= 8_000
  );
}

async function appleRequest(
  url: string,
  body: URLSearchParams,
  fetcher: typeof fetch,
): Promise<AppleServiceResult<unknown>> {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response) return { ok: false, reason: "unavailable" };
  const raw = await response.text().catch(() => "");
  if (raw.length > MAX_APPLE_RESPONSE_BYTES) {
    return { ok: false, reason: "unavailable" };
  }
  let value: unknown = null;
  try {
    value = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status === 400 &&
        isRecord(value) &&
        value.error === "invalid_grant"
          ? "invalid_grant"
          : "unavailable",
    };
  }
  return { ok: true, value };
}

async function appleFailureReason(
  response: Response,
): Promise<"invalid_grant" | "unavailable"> {
  if (response.status !== 400) return "unavailable";
  const raw = await response.text().catch(() => "");
  if (!raw || raw.length > MAX_APPLE_RESPONSE_BYTES) return "unavailable";
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.error === "invalid_grant"
      ? "invalid_grant"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.trim().replaceAll("\\n", "\n");
  const match = normalized.match(
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----$/,
  );
  if (!match) throw new Error("Apple private key is not PKCS#8 PEM");
  const encoded = match[1].replace(/\s+/g, "");
  if (encoded.length < 80 || encoded.length > 8_000) {
    throw new Error("Apple private key has an unsupported size");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  );
  return crypto.subtle.importKey(
    "pkcs8",
    arrayBufferCopy(bytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function appleTokenEncryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32 || secret.length > 4_096) {
    throw new Error("Apple token encryption secret is not configured");
  }
  const material = await crypto.subtle.digest(
    "SHA-256",
    // Stable legacy KDF context: renaming it would invalidate issued refresh
    // token hashes during the Paretto brand transition.
    new TextEncoder().encode(`pas-a-pas:apple-refresh-token:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function validAppleOpaqueToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 16_384 &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
