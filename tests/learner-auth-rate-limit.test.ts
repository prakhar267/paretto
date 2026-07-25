import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBetterAuthRateLimitStorage,
  requiredBetterAuthRateLimitSecret,
  validBetterAuthRateLimitSecret,
} from "../app/learner-auth-rate-limit";

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE learner_auth_rate_limits (
        bucket_hash TEXT PRIMARY KEY NOT NULL,
        request_count INTEGER NOT NULL CHECK (request_count >= 1),
        last_request_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
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

  async first<T>() {
    return (
      (this.sqlite
        .prepare(this.sql)
        .get(...this.bindings()) as T | undefined) ?? null
    );
  }

  async run() {
    const result = this.sqlite
      .prepare(this.sql)
      .run(...this.bindings());
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  private bindings() {
    return this.values as Array<
      string | number | bigint | null | Uint8Array
    >;
  }
}

const RATE_LIMIT_SECRET =
  "test-better-auth-rate-limit-secret-with-32-characters";

describe("Better Auth private atomic rate limiter", () => {
  const databases: SqliteD1[] = [];

  afterEach(() => {
    for (const database of databases) database.sqlite.close();
    databases.length = 0;
  });

  function database() {
    const value = new SqliteD1();
    databases.push(value);
    return value;
  }

  it("atomically admits only the configured maximum under concurrency", async () => {
    const db = database();
    const storage = createBetterAuthRateLimitStorage(
      db as unknown as D1Database,
      RATE_LIMIT_SECRET,
      () => 1_000_000,
    );

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.consume!("203.0.113.7:/sign-in/email", {
          window: 10,
          max: 3,
        }),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(17);
    expect(
      db.sqlite
        .prepare(
          "SELECT request_count FROM learner_auth_rate_limits",
        )
        .get(),
    ).toEqual({ request_count: 3 });
  });

  it("persists only an opaque HMAC bucket, never an IP, path, or email", async () => {
    const db = database();
    const storage = createBetterAuthRateLimitStorage(
      db as unknown as D1Database,
      RATE_LIMIT_SECRET,
      () => 2_000_000,
    );
    const rawIp = "2001:db8:85a3::8a2e:370:7334";
    const rawPath = "/request-password-reset";
    const rawEmail = "private-learner@example.test";
    const opaqueRuntimeKey = `${rawIp}:${rawPath}:${rawEmail}`;

    await storage.consume!(opaqueRuntimeKey, { window: 60, max: 3 });

    const row = db.sqlite
      .prepare("SELECT * FROM learner_auth_rate_limits")
      .get() as Record<string, unknown>;
    const serialized = JSON.stringify(row);
    expect(row.bucket_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(serialized).not.toContain(rawIp);
    expect(serialized).not.toContain(rawPath);
    expect(serialized).not.toContain(rawEmail);
    expect(
      db.sqlite
        .prepare("PRAGMA table_info(learner_auth_rate_limits)")
        .all()
        .map((column) => (column as { name: string }).name),
    ).toEqual([
      "bucket_hash",
      "request_count",
      "last_request_at",
      "updated_at",
    ]);
  });

  it("keeps route/client buckets independent and resets after the window", async () => {
    const db = database();
    let now = 3_000_000;
    const storage = createBetterAuthRateLimitStorage(
      db as unknown as D1Database,
      RATE_LIMIT_SECRET,
      () => now,
    );
    const rule = { window: 10, max: 1 };

    expect(
      await storage.consume!("203.0.113.1:/sign-in/email", rule),
    ).toEqual({ allowed: true, retryAfter: null });
    expect(
      await storage.consume!("203.0.113.1:/sign-in/email", rule),
    ).toEqual({ allowed: false, retryAfter: 10 });
    expect(
      await storage.consume!("203.0.113.1:/sign-up/email", rule),
    ).toEqual({ allowed: true, retryAfter: null });
    expect(
      await storage.consume!("203.0.113.2:/sign-in/email", rule),
    ).toEqual({ allowed: true, retryAfter: null });

    now += 10_001;
    expect(
      await storage.consume!("203.0.113.1:/sign-in/email", rule),
    ).toEqual({ allowed: true, retryAfter: null });
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM learner_auth_rate_limits",
        )
        .get(),
    ).toEqual({ total: 3 });
  });

  it("requires an independent production secret but provides a local-only fallback", () => {
    const bindings = {
      BETTER_AUTH_RATE_LIMIT_SECRET: RATE_LIMIT_SECRET,
      USER_KEY_SECRET:
        "independent-user-key-secret-with-at-least-32-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "independent-support-secret-with-at-least-32-characters",
      BETTER_AUTH_SECRET:
        "independent-auth-secret-with-at-least-32-characters",
      ADMIN_SESSION_SECRET:
        "independent-admin-secret-with-at-least-32-characters",
    };
    expect(validBetterAuthRateLimitSecret(bindings)).toBe(true);
    expect(requiredBetterAuthRateLimitSecret(bindings)).toBe(
      RATE_LIMIT_SECRET,
    );
    expect(
      validBetterAuthRateLimitSecret({
        ...bindings,
        BETTER_AUTH_RATE_LIMIT_SECRET: bindings.ADMIN_SESSION_SECRET,
      }),
    ).toBe(false);
    expect(requiredBetterAuthRateLimitSecret({})).toBe(
      "local-only-paretto-better-auth-rate-limit-never-deploy",
    );
  });
});
