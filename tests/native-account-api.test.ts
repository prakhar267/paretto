import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "../app/api/native/account/route";
import { encryptAppleRefreshToken } from "../app/api/native/_lib/apple-oauth";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class NativeAccountMemoryD1 {
  deletedTables: string[] = [];

  constructor(
    readonly accountId: string,
    readonly encryptedRefreshToken: string,
  ) {}

  prepare(sql: string) {
    return new NativeAccountStatement(this, sql);
  }

  async batch(statements: NativeAccountStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class NativeAccountStatement {
  private readonly sql: string;

  constructor(
    private readonly database: NativeAccountMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    void values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM NATIVE_SESSIONS AS SESSIONS")) {
      return {
        account_id: this.database.accountId,
        email: "relay@example.com",
        display_name: "Camille",
        expires_at: Date.now() + 60_000,
      } as T;
    }
    if (this.sql.includes("FROM NATIVE_APPLE_CREDENTIALS")) {
      return {
        refresh_token_ciphertext: this.database.encryptedRefreshToken,
      } as T;
    }
    throw new Error(`Unexpected native account first SQL: ${this.sql}`);
  }

  async run() {
    const match = this.sql.match(/^DELETE FROM ([A-Z_]+)/);
    if (!match) throw new Error(`Unexpected native account run SQL: ${this.sql}`);
    this.database.deletedTables.push(match[1].toLowerCase());
    return { meta: { changes: 1 } };
  }
}

const SESSION_SECRET = "native-session-secret-with-at-least-32-chars";
const ENCRYPTION_SECRET = "independent-apple-encryption-secret-32-chars";
const ACCOUNT_ID = "account-identifier";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native account deletion", () => {
  it("revokes the Apple refresh token before deleting every account record", async () => {
    const configuration = await testConfiguration();
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      ...configuration,
    });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("token")).toBe("refresh-token-with-enough-length");
      expect(body.get("token_type_hint")).toBe("refresh_token");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(204);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(database.deletedTables).toEqual([
      "native_learning_state",
      "native_sessions",
      "native_apple_credentials",
      "native_accounts",
    ]);
  });

  it("keeps the account intact when Apple revocation cannot complete", async () => {
    const configuration = await testConfiguration();
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      ...configuration,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider failure", { status: 503 })),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(503);
    expect(database.deletedTables).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not strand deletion when Apple no longer accepts the stored token", async () => {
    const configuration = await testConfiguration();
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      ...configuration,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(204);
    expect(database.deletedTables).toEqual([
      "native_learning_state",
      "native_sessions",
      "native_apple_credentials",
      "native_accounts",
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("native_apple_revocation_invalid_grant_local_delete"),
    );
  });

  it("does not mistake an Apple client-configuration error for an expired user grant", async () => {
    const configuration = await testConfiguration();
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      ...configuration,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "invalid_client" }, { status: 400 }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(503);
    expect(database.deletedTables).toEqual([]);
  });
});

function accountRequest() {
  return new Request("https://loquivo.test/api/native/account", {
    method: "DELETE",
    headers: { authorization: `Bearer ${"A".repeat(43)}` },
  });
}

async function testConfiguration() {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const encoded = Buffer.from(privateKey).toString("base64");
  const lines = encoded.match(/.{1,64}/g)?.join("\n") ?? encoded;
  return {
    APPLE_CLIENT_ID: "com.loquivo.app",
    APPLE_TEAM_ID: "TEAMID1234",
    APPLE_KEY_ID: "KEYID12345",
    APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`,
    APPLE_TOKEN_ENCRYPTION_SECRET: ENCRYPTION_SECRET,
    NATIVE_SESSION_SECRET: SESSION_SECRET,
  };
}
