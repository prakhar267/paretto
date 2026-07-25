import { describe, expect, it } from "vitest";

import { POST as APPLE_AUTH_POST } from "../app/api/native/auth/apple/route";
import { verifyAppleIdentityToken } from "../app/api/native/_lib/native-auth";
import {
  createAppleClientSecret,
  decryptAppleRefreshToken,
  encryptAppleRefreshToken,
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  type AppleOAuthConfiguration,
  validAppleOAuthConfiguration,
} from "../app/api/native/_lib/apple-oauth";
import {
  initialNativeLearningState,
  validateNativeLearningState,
} from "../app/api/native/_lib/native-progress";
import { MAX_ACTIVE_REWARD_REPLICAS } from "../app/learning-engine";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

describe("native API security contracts", () => {
  it("requires a one-time Apple authorization code at the HTTP boundary", async () => {
    setCloudflareEnv({ NATIVE_API_ENABLED: "true" });
    const response = await APPLE_AUTH_POST(
      new Request("https://paretto.test/api/native/auth/apple", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identityToken: `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`,
          rawNonce: "nonce_1234567890_abcdefghijklmnop",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts the shipped native state shape and rejects malformed progress", () => {
    const state = initialNativeLearningState();
    expect(validateNativeLearningState(state)).toBe(true);
    const stateWithoutOptionalDay = { ...state };
    delete (stateWithoutOptionalDay as { lastActiveDate?: unknown }).lastActiveDate;
    expect(validateNativeLearningState(stateWithoutOptionalDay)).toBe(true);
    const legacyState = { ...state } as Record<string, unknown>;
    delete legacyState.activeCourseId;
    delete legacyState.courseProgress;
    expect(validateNativeLearningState(legacyState)).toBe(true);
    expect(
      validateNativeLearningState({
        ...state,
        activeCourseId: "unpublished-course",
      }),
    ).toBe(false);
    expect(validateNativeLearningState({ ...state, schemaVersion: 2 })).toBe(false);
    expect(validateNativeLearningState({ ...state, analyticsIdentifier: "hidden-pii" })).toBe(false);
    expect(validateNativeLearningState({ ...state, dailyGoal: "5" })).toBe(false);
    expect(validateNativeLearningState({ ...state, dailyGoal: 6 })).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        rewardJournal: {
          ...state.rewardJournal,
          replicas: Object.fromEntries(
            Array.from(
              { length: MAX_ACTIVE_REWARD_REPLICAS + 1 },
              (_, index) => [
                `ios2:${index.toString(36)}:00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
                { xpEarned: 0, coinsEarned: 0, coinsSpent: 0 },
              ],
            ),
          ),
        },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        currentRegionID: "normandie",
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        settings: { ...state.settings, analytics: "yes" },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        settings: { ...state.settings, advertisingId: "not-allowed" },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        sessions: Array.from({ length: 101 }, () => ({})),
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        sessions: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            mode: "review",
            regionID: "ile-de-france",
            wordIDs: ["idf-metro"],
            correct: 2,
            xpEarned: 10,
            completedAt: new Date().toISOString(),
          },
        ],
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        wordProgress: {
          "idf-metro": {
            stage: 7,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: new Date(Date.now() + 60_000).toISOString(),
            lastReviewedAt: new Date().toISOString(),
          },
        },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        challenge: { bestScore: 4, hiddenNote: "not-allowed" },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        challenge: { bestScore: 4, lastPlayedDate: "2026-02-30" },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        dice: {
          lastPlayedDate: "2026-07-25",
          lastPlayedResult: {
            date: "2026-07-25",
            stake: 3,
            multiplier: 2,
            xp: 72,
          },
        },
      }),
    ).toBe(true);
    expect(
      validateNativeLearningState({
        ...state,
        dice: {
          lastPlayedDate: "2026-07-25",
          lastPlayedResult: {
            date: "2026-07-24",
            stake: 3,
            multiplier: 2,
            xp: 72,
          },
        },
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        updatedAt: "2026-02-30T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        collectibles: ["metro-ticket", "metro-ticket"],
      }),
    ).toBe(false);
    expect(
      validateNativeLearningState({
        ...state,
        sessions: [
          {
            id: "10000000-0000-4000-8000-000000000002",
            mode: "challenge",
            regionID: "ile-de-france",
            wordIDs: ["idf-metro"],
            correct: 1,
            xpEarned: 35,
            completedAt: new Date().toISOString(),
          },
        ],
      }),
    ).toBe(true);
  });

  it("verifies Apple issuer, audience, signature, expiry, and nonce", async () => {
    const now = Date.UTC(2026, 6, 21, 10, 0, 0);
    const rawNonce = "nonce_1234567890_abcdefghijklmnop";
    const keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const nonceDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawNonce),
    );
    const nonce = base64Url(new Uint8Array(nonceDigest));
    const baseClaims = {
      iss: "https://appleid.apple.com",
      aud: "com.paretto.app",
      sub: "apple-user-opaque-subject",
      email: "relay@example.com",
      email_verified: true,
      iat: Math.floor(now / 1000) - 5,
      exp: Math.floor(now / 1000) + 300,
      nonce,
    };
    const token = await signJwt(baseClaims, keys.privateKey);
    await expect(
      verifyAppleIdentityToken(token, rawNonce, {
        clientId: "com.paretto.app",
        now,
        fetcher,
      }),
    ).resolves.toEqual({
      subject: "apple-user-opaque-subject",
      email: "relay@example.com",
    });
    await expect(
      verifyAppleIdentityToken(token, `${rawNonce}x`, {
        clientId: "com.paretto.app",
        now,
        fetcher,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyAppleIdentityToken(token, rawNonce, {
        clientId: "wrong.client",
        now,
        fetcher,
      }),
    ).resolves.toBeNull();

    const expired = await signJwt(
      { ...baseClaims, exp: Math.floor(now / 1000) - 120 },
      keys.privateKey,
    );
    await expect(
      verifyAppleIdentityToken(expired, rawNonce, {
        clientId: "com.paretto.app",
        now,
        fetcher,
      }),
    ).resolves.toBeNull();

    const rotated = await signJwt(
      {
        ...baseClaims,
        iat: Math.floor((now + 6 * 60_000) / 1000) - 5,
        exp: Math.floor((now + 6 * 60_000) / 1000) + 300,
      },
      keys.privateKey,
      "rotated-key",
    );
    let rotationFetches = 0;
    const rotationFetcher = (async () => {
      rotationFetches += 1;
      return new Response(
        JSON.stringify({
          keys: [
            {
              ...publicJwk,
              kid: "rotated-key",
              alg: "RS256",
              use: "sig",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await expect(
      verifyAppleIdentityToken(rotated, rawNonce, {
        clientId: "com.paretto.app",
        now: now + 6 * 60_000,
        fetcher: rotationFetcher,
      }),
    ).resolves.toEqual({
      subject: "apple-user-opaque-subject",
      email: "relay@example.com",
    });
    expect(rotationFetches).toBe(1);
  });

  it("creates Apple client credentials, exchanges codes, revokes, and encrypts refresh tokens", async () => {
    const now = Date.UTC(2026, 6, 21, 10, 0, 0);
    const keys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const privateKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
    const configuration: AppleOAuthConfiguration = {
      clientId: "com.paretto.app",
      teamId: "TEAMID1234",
      keyId: "KEYID12345",
      privateKey: pkcs8Pem(privateKey),
    };
    expect(validAppleOAuthConfiguration(configuration)).toBe(true);
    expect(
      validAppleOAuthConfiguration({
        ...configuration,
        privateKey: `${configuration.privateKey}\nuntrusted-trailer`,
      }),
    ).toBe(false);
    expect(
      validAppleOAuthConfiguration({
        ...configuration,
        privateKey: configuration.privateKey.replace(
          "-----END PRIVATE KEY-----",
          "",
        ),
      }),
    ).toBe(false);
    const clientSecret = await createAppleClientSecret(configuration, now);
    const [header, payload, signature] = clientSecret.split(".");
    expect(JSON.parse(base64UrlText(header))).toEqual({
      alg: "ES256",
      kid: "KEYID12345",
    });
    expect(JSON.parse(base64UrlText(payload))).toEqual({
      iss: "TEAMID1234",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 300,
      aud: "https://appleid.apple.com",
      sub: "com.paretto.app",
    });
    await expect(
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.publicKey,
        Buffer.from(signature.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true);

    const observedRequests: Array<{ url: string; body: URLSearchParams }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      observedRequests.push({ url: String(input), body });
      if (String(input).endsWith("/auth/token")) {
        return Response.json({
          access_token: "access-token-with-enough-length",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-token-with-enough-length",
          id_token: `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`,
        });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await expect(
      exchangeAppleAuthorizationCode(
        "authorization-code-with-enough-length",
        configuration,
        { fetcher, now },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { refreshToken: "refresh-token-with-enough-length" },
    });
    await expect(
      revokeAppleRefreshToken(
        "refresh-token-with-enough-length",
        configuration,
        { fetcher, now },
      ),
    ).resolves.toEqual({ ok: true, value: null });
    expect(observedRequests[0].url).toBe("https://appleid.apple.com/auth/token");
    expect(observedRequests[0].body.get("grant_type")).toBe("authorization_code");
    expect(observedRequests[0].body.get("code")).toBe(
      "authorization-code-with-enough-length",
    );
    expect(observedRequests[1].url).toBe("https://appleid.apple.com/auth/revoke");
    expect(observedRequests[1].body.get("token_type_hint")).toBe("refresh_token");

    const encryptionSecret = "test-only-independent-encryption-secret-123456";
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      encryptionSecret,
      "account-a",
    );
    expect(encrypted).not.toContain("refresh-token");
    await expect(
      decryptAppleRefreshToken(encrypted, encryptionSecret, "account-a"),
    ).resolves.toBe("refresh-token-with-enough-length");
    await expect(
      decryptAppleRefreshToken(encrypted, encryptionSecret, "account-b"),
    ).resolves.toBeNull();
  });
});

async function signJwt(
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
  kid = "test-key",
): Promise<string> {
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })),
  );
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const message = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlText(value: string): string {
  return Buffer.from(
    value.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  ).toString("utf8");
}

function pkcs8Pem(value: ArrayBuffer): string {
  const encoded = Buffer.from(value).toString("base64");
  const lines = encoded.match(/.{1,64}/g)?.join("\n") ?? encoded;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}
