import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "../app/api/native/session/route";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Session = {
  tokenHash: string;
  accountId: string;
  expiresAt: number;
  revokedAt: number | null;
};

class NativeSessionMemoryD1 {
  readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  prepare(sql: string) {
    return new NativeSessionStatement(this, sql);
  }
}

class NativeSessionStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: NativeSessionMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (!this.sql.includes("FROM NATIVE_SESSIONS AS SESSIONS")) {
      throw new Error(`Unexpected native session query: ${this.sql}`);
    }
    const [tokenHash, now] = this.values;
    const session = this.database.session;
    if (
      session.tokenHash !== tokenHash ||
      session.revokedAt !== null ||
      session.expiresAt <= Number(now)
    ) {
      return null;
    }
    return {
      account_id: session.accountId,
      email: "relay@example.com",
      display_name: "Camille",
      expires_at: session.expiresAt,
    } as T;
  }

  async run() {
    if (!this.sql.startsWith("UPDATE NATIVE_SESSIONS SET REVOKED_AT")) {
      throw new Error(`Unexpected native session mutation: ${this.sql}`);
    }
    const [revokedAt, tokenHash, accountId] = this.values;
    const session = this.database.session;
    if (
      session.tokenHash !== tokenHash ||
      session.accountId !== accountId ||
      session.revokedAt !== null
    ) {
      return { meta: { changes: 0 } };
    }
    session.revokedAt = Number(revokedAt);
    return { meta: { changes: 1 } };
  }
}

const SESSION_SECRET = "native-session-secret-with-at-least-32-chars";
const ACCESS_TOKEN = "A".repeat(43);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("native session revocation", () => {
  it("hashes and revokes only the authenticated bearer session", async () => {
    const tokenHash = await nativeSessionHash(ACCESS_TOKEN);
    const database = new NativeSessionMemoryD1({
      tokenHash,
      accountId: "account-identifier",
      expiresAt: Date.now() + 60_000,
      revokedAt: null,
    });
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
    });

    const response = await DELETE(sessionRequest(ACCESS_TOKEN));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(database.session.revokedAt).toEqual(expect.any(Number));

    const reused = await DELETE(sessionRequest(ACCESS_TOKEN));
    expect(reused.status).toBe(401);
  });

  it("rejects a different bearer without touching the stored session", async () => {
    const tokenHash = await nativeSessionHash(ACCESS_TOKEN);
    const database = new NativeSessionMemoryD1({
      tokenHash,
      accountId: "account-identifier",
      expiresAt: Date.now() + 60_000,
      revokedAt: null,
    });
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
    });

    const response = await DELETE(sessionRequest("B".repeat(43)));

    expect(response.status).toBe(401);
    expect(database.session.revokedAt).toBeNull();
  });
});

function sessionRequest(token: string) {
  return new Request("https://pas-a-pas.test/api/native/session", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function nativeSessionHash(token: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`native-session:${token}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
