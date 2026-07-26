import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/turnstile", () => ({
  turnstileConfiguration: vi.fn(() => null),
  verifySupportTurnstile: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../app/support-notification-outbox", () => ({
  enqueueSupportCreatedNotifications: vi.fn(() => []),
  scheduleSupportNotificationDelivery: vi.fn(),
}));

import { POST } from "../app/api/support/route";
import {
  SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS,
  SUPPORT_IP_RATE_LIMIT_WINDOW_MS,
} from "../app/support-rate-limit";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE support_requests (
        id TEXT PRIMARY KEY NOT NULL,
        user_key TEXT NOT NULL,
        reply_email TEXT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE support_rate_limits (
        bucket_hash TEXT PRIMARY KEY NOT NULL,
        window_started_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL
          CHECK (request_count >= 1 AND request_count <= 20),
        last_reservation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE learner_deletion_jobs (
        user_id TEXT PRIMARY KEY NOT NULL,
        user_key TEXT NOT NULL
      );
    `);
  }

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings());
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  private bindings() {
    return this.values as Array<string | number | bigint | null | Uint8Array>;
  }
}

const USER_KEY_SECRET =
  "test-user-key-secret-with-more-than-thirty-two-characters";
const SUPPORT_RATE_LIMIT_SECRET =
  "test-support-rate-limit-secret-with-more-than-thirty-two-characters";
const CLIENT_IP = "203.0.113.91";

describe("support IP abuse quota", () => {
  let database: SqliteD1;
  let now: number;

  beforeEach(() => {
    database = new SqliteD1();
    now = Date.UTC(2026, 6, 25, 9);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET,
      SUPPORT_RATE_LIMIT_SECRET,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.sqlite.close();
  });

  it("cannot be bypassed by rotating the anonymous learner cookie", async () => {
    for (let index = 0; index < SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS; index += 1) {
      const response = await POST(supportRequest(index, CLIENT_IP));
      expect(response.status).toBe(201);
    }

    const blocked = await POST(
      supportRequest(SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS, CLIENT_IP),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS total FROM support_requests")
        .get(),
    ).toEqual({ total: SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS });
    expect(
      database.sqlite
        .prepare(
          "SELECT request_count FROM support_rate_limits",
        )
        .get(),
    ).toEqual({ request_count: SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS });
  });

  it("does not charge rejected same-user attempts to other learners behind the same IP", async () => {
    const sameUserToken = sessionToken(900);
    for (let index = 0; index < 5; index += 1) {
      const response = await POST(
        supportRequest(index, CLIENT_IP, { sessionToken: sameUserToken }),
      );
      expect(response.status).toBe(201);
    }

    for (let index = 5; index < 12; index += 1) {
      const rejected = await POST(
        supportRequest(index, CLIENT_IP, { sessionToken: sameUserToken }),
      );
      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("3600");
    }
    expect(
      database.sqlite
        .prepare("SELECT request_count FROM support_rate_limits")
        .get(),
    ).toEqual({ request_count: 5 });

    const otherNatUser = await POST(supportRequest(50, CLIENT_IP));
    expect(otherNatUser.status).toBe(201);
    expect(
      database.sqlite
        .prepare("SELECT request_count FROM support_rate_limits")
        .get(),
    ).toEqual({ request_count: 6 });
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS total FROM support_requests")
        .get(),
    ).toEqual({ total: 6 });
  });

  it("opens a fresh quota window after one hour", async () => {
    for (let index = 0; index < SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS; index += 1) {
      expect((await POST(supportRequest(index, CLIENT_IP))).status).toBe(201);
    }
    expect((await POST(supportRequest(20, CLIENT_IP))).status).toBe(429);

    now += SUPPORT_IP_RATE_LIMIT_WINDOW_MS;
    expect((await POST(supportRequest(21, CLIENT_IP))).status).toBe(201);
    expect(
      database.sqlite
        .prepare(
          `SELECT window_started_at, request_count
           FROM support_rate_limits`,
        )
        .get(),
    ).toEqual({ window_started_at: now, request_count: 1 });
  });

  it("persists only an opaque HMAC bucket, never the raw IP or support fields", async () => {
    const rawIp = "2001:db8:85a3::8a2e:370:7334";
    const rawEmail = "learner-private@example.test";
    const rawBody = "My private support details must not enter rate-limit data.";
    const response = await POST(
      supportRequest(0, rawIp, {
        replyEmail: rawEmail,
        body: rawBody,
      }),
    );
    expect(response.status).toBe(201);

    const row = database.sqlite
      .prepare("SELECT * FROM support_rate_limits")
      .get() as Record<string, unknown>;
    expect(row.bucket_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(rawIp);
    expect(JSON.stringify(row)).not.toContain(rawEmail);
    expect(JSON.stringify(row)).not.toContain(rawBody);
    expect(
      database.sqlite
        .prepare("PRAGMA table_info(support_rate_limits)")
        .all()
        .map((column) => (column as { name: string }).name),
    ).not.toContain("ip_address");
  });

  it("uses one opaque unknown bucket when Cloudflare provides no client IP", async () => {
    expect((await POST(supportRequest(0, null))).status).toBe(201);
    expect((await POST(supportRequest(1, null))).status).toBe(201);

    const rows = database.sqlite
      .prepare(
        "SELECT bucket_hash, request_count FROM support_rate_limits",
      )
      .all() as Array<{ bucket_hash: string; request_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      bucket_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      request_count: 2,
    });
  });

  it("fails closed when the production limiter secret is missing or reused", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    try {
      setCloudflareEnv({
        DB: database,
        USER_KEY_SECRET,
      });
      expect((await POST(supportRequest(0, CLIENT_IP))).status).toBe(503);

      setCloudflareEnv({
        DB: database,
        USER_KEY_SECRET,
        SUPPORT_RATE_LIMIT_SECRET: USER_KEY_SECRET,
      });
      expect((await POST(supportRequest(1, CLIENT_IP))).status).toBe(503);
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS total FROM support_requests")
          .get(),
      ).toEqual({ total: 0 });
    } finally {
      vi.unstubAllEnvs();
      consoleError.mockRestore();
    }
  });
});

function supportRequest(
  index: number,
  clientIp: string | null,
  overrides: {
    replyEmail?: string;
    body?: string;
    sessionToken?: string;
  } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    cookie: `__Host-learner-session=${overrides.sessionToken ?? sessionToken(index)}`,
  });
  if (clientIp) headers.set("cf-connecting-ip", clientIp);
  return new Request("https://paretto.test/api/support", {
    method: "POST",
    headers,
    body: JSON.stringify({
      category: "technical",
      subject: `Support request ${index}`,
      body:
        overrides.body ??
        "The lesson audio stopped unexpectedly and I need help.",
      replyEmail: overrides.replyEmail,
      turnstileToken: "test-turnstile-token",
    }),
  });
}

function sessionToken(index: number): string {
  return `${index.toString(36)}${"x".repeat(43)}`.slice(0, 43);
}
