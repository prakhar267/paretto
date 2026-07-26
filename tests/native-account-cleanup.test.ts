import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareNativeIdentityBeforeLearnerDeletion,
} from "../app/api/native/_lib/native-account-cleanup";
import { encryptAppleRefreshToken } from "../app/api/native/_lib/apple-oauth";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class CleanupMemoryD1 {
  readonly deletedTables: string[] = [];

  constructor(
    readonly accountId: string | null,
    readonly encryptedRefreshToken: string | null,
  ) {}

  prepare(sql: string) {
    return new CleanupStatement(this, sql);
  }

  async batch(statements: CleanupStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class CleanupStatement {
  private readonly sql: string;

  constructor(
    private readonly database: CleanupMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    void values;
    return this;
  }

  async first<T>() {
    if (!this.sql.includes("FROM NATIVE_LEARNER_LINKS AS LINKS")) {
      throw new Error(`Unexpected native cleanup query: ${this.sql}`);
    }
    if (!this.database.accountId) return null;
    return {
      native_account_id: this.database.accountId,
      refresh_token_ciphertext: this.database.encryptedRefreshToken,
    } as T;
  }

  async run() {
    const match = this.sql.match(/^DELETE FROM ([A-Z_]+)/);
    if (!match) throw new Error(`Unexpected native cleanup mutation: ${this.sql}`);
    this.database.deletedTables.push(match[1].toLowerCase());
    return { meta: { changes: 1 } };
  }
}

const ACCOUNT_ID = "native-account-id";
const ENCRYPTION_SECRET = "native-cleanup-encryption-secret-32-characters";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web-initiated linked native account cleanup", () => {
  it("does nothing when the learner has no linked native identity", async () => {
    const database = new CleanupMemoryD1(null, null);
    setCloudflareEnv({ NATIVE_API_ENABLED: "false" });

    await expect(
      prepareNativeIdentityBeforeLearnerDeletion(
        database as unknown as D1Database,
        "learner-user-id",
      ),
    ).resolves.toBeNull();
    expect(database.deletedTables).toEqual([]);
  });

  it("revokes Apple before returning the native identity for durable cleanup", async () => {
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new CleanupMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      NATIVE_API_ENABLED: "false",
      DB: database,
      ...(await appleConfiguration()),
    });
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      prepareNativeIdentityBeforeLearnerDeletion(
        database as unknown as D1Database,
        "learner-user-id",
      ),
    ).resolves.toBe(ACCOUNT_ID);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(database.deletedTables).toEqual([]);
  });

  it("fails closed and leaves the account intact during an Apple outage", async () => {
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new CleanupMemoryD1(ACCOUNT_ID, encrypted);
    setCloudflareEnv({
      NATIVE_API_ENABLED: "true",
      DB: database,
      ...(await appleConfiguration()),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    await expect(
      prepareNativeIdentityBeforeLearnerDeletion(
        database as unknown as D1Database,
        "learner-user-id",
      ),
    ).rejects.toThrow("could not be revoked");
    expect(database.deletedTables).toEqual([]);
  });

  it("allows auditable local deletion when a historical credential is missing", async () => {
    const database = new CleanupMemoryD1(ACCOUNT_ID, null);
    setCloudflareEnv({ NATIVE_API_ENABLED: "false" });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      prepareNativeIdentityBeforeLearnerDeletion(
        database as unknown as D1Database,
        "learner-user-id",
      ),
    ).resolves.toBe(ACCOUNT_ID);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("learner_delete_apple_credential_unavailable"),
    );
  });
});

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
    APPLE_TOKEN_ENCRYPTION_SECRET: ENCRYPTION_SECRET,
    NATIVE_SESSION_SECRET: "native-session-secret-with-at-least-32-chars",
  };
}
