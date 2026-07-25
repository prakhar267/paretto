import { afterEach, describe, expect, it, vi } from "vitest";

import { exchangeAppleIdentity } from "../app/api/native/_lib/native-auth";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class IdentityBridgeMemoryD1 {
  readonly statements: IdentityBridgeStatement[] = [];

  prepare(sql: string) {
    const statement = new IdentityBridgeStatement(sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: IdentityBridgeStatement[]) {
    expect(statements).toHaveLength(7);
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

class IdentityBridgeStatement {
  values: unknown[] = [];
  readonly normalizedSQL: string;

  constructor(sql: string) {
    this.normalizedSQL = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (
      this.normalizedSQL.startsWith(
        "SELECT ACCOUNTS.CREATED_AT, LINKS.LEARNER_USER_ID FROM NATIVE_ACCOUNTS AS ACCOUNTS",
      )
    ) {
      return {
        learner_user_id: "learner-user-id",
        created_at: Date.UTC(2026, 6, 25),
      } as T;
    }
    throw new Error(`Unexpected identity bridge query: ${this.normalizedSQL}`);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native Apple identity provisioning", () => {
  it("creates and links only the exact verified Apple provider identity", async () => {
    const now = Date.now();
    const rawNonce = "native_nonce_1234567890_abcdefghijklmnop";
    const rsaKeys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey("jwk", rsaKeys.publicKey);
    const nonceDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawNonce),
    );
    const identityToken = await signJWT(
      {
        iss: "https://appleid.apple.com",
        aud: "com.paretto.app",
        sub: "exact-apple-provider-subject",
        email: "relay@example.test",
        email_verified: true,
        iat: Math.floor(now / 1000) - 5,
        exp: Math.floor(now / 1000) + 300,
        nonce: base64URL(new Uint8Array(nonceDigest)),
      },
      rsaKeys.privateKey,
    );
    const database = new IdentityBridgeMemoryD1();
    const configuration = await appleConfiguration();
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      ...configuration,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/keys")) {
          return Response.json({
            keys: [
              {
                ...publicJwk,
                kid: "native-bridge-key",
                alg: "RS256",
                use: "sig",
              },
            ],
          });
        }
        if (url.endsWith("/auth/token")) {
          return Response.json({
            access_token: "apple-access-token-with-enough-length",
            token_type: "Bearer",
            expires_in: 3_600,
            refresh_token: "apple-refresh-token-with-enough-length",
            id_token: identityToken,
          });
        }
        throw new Error(`Unexpected Apple request: ${url}`);
      }),
    );

    const result = await exchangeAppleIdentity(
      identityToken,
      "one-time-authorization-code-with-enough-length",
      rawNonce,
      "Camille Martin",
    );

    expect(result).toMatchObject({
      ok: true,
      displayName: "Camille Martin",
      syncScope: "unified",
      accountScope: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const sql = database.statements.map((statement) => statement.normalizedSQL);
    expect(sql).toEqual(
      expect.arrayContaining([
        expect.stringContaining("INSERT OR IGNORE INTO LEARNER_USER"),
        expect.stringContaining("INSERT OR IGNORE INTO LEARNER_ACCOUNT"),
        expect.stringContaining("INSERT OR IGNORE INTO NATIVE_LEARNER_LINKS"),
      ]),
    );
    const userInsert = database.statements.find((statement) =>
      statement.normalizedSQL.includes("INTO LEARNER_USER"),
    );
    const providerInsert = database.statements.find((statement) =>
      statement.normalizedSQL.includes("INTO LEARNER_ACCOUNT"),
    );
    const linkInsert = database.statements.find((statement) =>
      statement.normalizedSQL.includes("INTO NATIVE_LEARNER_LINKS"),
    );
    expect(userInsert?.normalizedSQL).toContain(
      "NOT EXISTS ( SELECT 1 FROM LEARNER_USER WHERE EMAIL = ? )",
    );
    expect(providerInsert?.values).toContain("exact-apple-provider-subject");
    expect(linkInsert?.values).toContain("exact-apple-provider-subject");
  });
});

async function signJWT(
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> {
  const header = base64URL(
    new TextEncoder().encode(
      JSON.stringify({ alg: "RS256", kid: "native-bridge-key" }),
    ),
  );
  const payload = base64URL(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const message = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64URL(new Uint8Array(signature))}`;
}

function base64URL(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function appleConfiguration() {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const encoded = Buffer.from(privateKey).toString("base64");
  const lines = encoded.match(/.{1,64}/g)?.join("\n") ?? encoded;
  return {
    APPLE_CLIENT_ID: "com.paretto.app",
    APPLE_TEAM_ID: "TEAMID1234",
    APPLE_KEY_ID: "KEYID12345",
    APPLE_PRIVATE_KEY:
      `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`,
    APPLE_TOKEN_ENCRYPTION_SECRET:
      "native-bridge-encryption-secret-with-at-least-32-characters",
    NATIVE_SESSION_SECRET:
      "native-bridge-session-secret-with-at-least-32-characters",
  };
}
