import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "../app/api/native/account/route";
import { encryptAppleRefreshToken } from "../app/api/native/_lib/apple-oauth";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class NativeAccountMemoryD1 {
  deletedTables: string[] = [];
  deletionJob: {
    userId: string;
    userKey: string;
    nativeAccountId: string | null;
    status: "pending" | "held" | "completed";
    requestedAt: number;
  } | null = null;
  learnerUserExists: boolean;
  nativeAccountExists = true;
  failCredentialLookup = false;

  constructor(
    readonly accountId: string,
    readonly encryptedRefreshToken: string | null,
    readonly learnerUserId: string | null = null,
  ) {
    this.learnerUserExists = learnerUserId !== null;
  }

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
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: NativeAccountMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM NATIVE_SESSIONS AS SESSIONS")) {
      return {
        account_id: this.database.accountId,
        learner_user_id: this.database.learnerUserId,
        email: "relay@example.com",
        display_name: "Camille",
        expires_at: Date.now() + 60_000,
        created_at: Date.UTC(2026, 6, 25),
      } as T;
    }
    if (this.sql.includes("FROM NATIVE_APPLE_CREDENTIALS")) {
      if (this.database.failCredentialLookup) {
        throw new Error("simulated credential lookup failure");
      }
      return (this.database.encryptedRefreshToken
        ? {
            refresh_token_ciphertext: this.database.encryptedRefreshToken,
          }
        : null) as T;
    }
    if (
      this.sql.startsWith(
        "SELECT USER_ID, USER_KEY, NATIVE_ACCOUNT_ID, STATUS, REQUESTED_AT FROM LEARNER_DELETION_JOBS",
      )
    ) {
      if (
        !this.database.deletionJob ||
        this.database.deletionJob.userId !== String(this.values[0])
      ) {
        return null;
      }
      return {
        user_id: this.database.deletionJob.userId,
        user_key: this.database.deletionJob.userKey,
        native_account_id: this.database.deletionJob.nativeAccountId,
        status: this.database.deletionJob.status,
        requested_at: this.database.deletionJob.requestedAt,
      } as T;
    }
    if (this.sql.startsWith("SELECT ID FROM LEARNER_USER")) {
      return (this.database.learnerUserExists
        ? { id: String(this.values[0]) }
        : null) as T;
    }
    if (
      this.sql.startsWith(
        "SELECT STATUS FROM LEARNER_DELETION_JOBS",
      )
    ) {
      return (this.database.deletionJob
        ? { status: this.database.deletionJob.status }
        : null) as T;
    }
    throw new Error(`Unexpected native account first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO LEARNER_DELETION_JOBS")) {
      this.database.deletionJob = {
        userId: String(this.values[0]),
        userKey: String(this.values[1]),
        nativeAccountId:
          typeof this.values[2] === "string" ? this.values[2] : null,
        status: "pending",
        requestedAt: Number(this.values[3]),
      };
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE LEARNER_DELETION_JOBS")) {
      if (this.database.deletionJob) {
        this.database.deletionJob.status = "completed";
      }
      return { meta: { changes: this.database.deletionJob ? 1 : 0 } };
    }
    if (this.sql.startsWith("DELETE FROM LEARNER_DELETION_JOBS")) {
      const canCancel =
        this.database.learnerUserExists || this.database.nativeAccountExists;
      if (canCancel) this.database.deletionJob = null;
      return { meta: { changes: canCancel ? 1 : 0 } };
    }
    const match = this.sql.match(/^DELETE FROM ([A-Z_]+)/);
    if (!match) throw new Error(`Unexpected native account run SQL: ${this.sql}`);
    const table = match[1].toLowerCase();
    this.database.deletedTables.push(table);
    if (table === "learner_user") {
      this.database.learnerUserExists = false;
    }
    if (table === "native_accounts") {
      this.database.nativeAccountExists = false;
    }
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
    expect(database.deletionJob?.status).toBe("completed");
    expect(database.deletedTables).toEqual(
      expect.arrayContaining([
        "learning_state",
        "product_events",
        "support_requests",
        "native_learning_state",
        "native_sessions",
        "native_apple_credentials",
        "native_learner_links",
        "native_accounts",
      ]),
    );
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
    expect(database.deletionJob).toBeNull();
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
    expect(database.deletionJob?.status).toBe("completed");
    expect(database.deletedTables).toEqual(
      expect.arrayContaining([
        "native_learning_state",
        "native_sessions",
        "native_apple_credentials",
        "native_accounts",
      ]),
    );
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
    expect(database.deletionJob).toBeNull();
  });

  it("deletes shared web data and Better Auth ownership for a unified account", async () => {
    const configuration = await testConfiguration();
    const encrypted = await encryptAppleRefreshToken(
      "refresh-token-with-enough-length",
      ENCRYPTION_SECRET,
      ACCOUNT_ID,
    );
    const database = new NativeAccountMemoryD1(
      ACCOUNT_ID,
      encrypted,
      "learner-user-id",
    );
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      USER_KEY_SECRET:
        "shared-account-delete-secret-with-at-least-32-characters",
      ...configuration,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(204);
    expect(database.deletionJob?.status).toBe("completed");
    expect(database.deletedTables).toEqual(
      expect.arrayContaining([
        "learner_user",
        "learning_state",
        "support_requests",
        "product_events",
        "native_learner_links",
        "native_accounts",
      ]),
    );
    expect(database.deletedTables.indexOf("learner_user")).toBeLessThan(
      database.deletedTables.indexOf("learning_state"),
    );
  });

  it("finishes local deletion without native sign-in or Apple credentials", async () => {
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, null);
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "false",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(204);
    expect(fetcher).not.toHaveBeenCalled();
    expect(database.deletionJob?.status).toBe("completed");
    expect(database.nativeAccountExists).toBe(false);
  });

  it("rolls back a staged tombstone if deletion fails before identity removal", async () => {
    const database = new NativeAccountMemoryD1(ACCOUNT_ID, null);
    database.failCredentialLookup = true;
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "false",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await DELETE(accountRequest());

    expect(response.status).toBe(503);
    expect(database.deletionJob).toBeNull();
    expect(database.nativeAccountExists).toBe(true);
    expect(database.deletedTables).toEqual([]);
  });
});

function accountRequest() {
  return new Request("https://paretto.test/api/native/account", {
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
    APPLE_CLIENT_ID: "com.paretto.app",
    APPLE_TEAM_ID: "TEAMID1234",
    APPLE_KEY_ID: "KEYID12345",
    APPLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`,
    APPLE_TOKEN_ENCRYPTION_SECRET: ENCRYPTION_SECRET,
    NATIVE_SESSION_SECRET: SESSION_SECRET,
  };
}
