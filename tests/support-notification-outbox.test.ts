import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueSupportCreatedNotifications,
  enqueueSupportStatusNotification,
  processSupportNotificationOutbox,
  scheduleSupportNotificationDelivery,
} from "../app/support-notification-outbox";
import {
  setCloudflareEnv,
  waitUntilPromises,
} from "./cloudflare-workers-mock";

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE learner_user (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_verified INTEGER NOT NULL
      );
      CREATE TABLE support_requests (
        id TEXT PRIMARY KEY,
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
      CREATE TABLE support_notification_jobs (
        id TEXT PRIMARY KEY,
        support_request_id TEXT NOT NULL
          REFERENCES support_requests(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        support_revision INTEGER NOT NULL,
        support_status TEXT NOT NULL,
        recipient_email TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at INTEGER NOT NULL,
        lease_expires_at INTEGER,
        last_error TEXT,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (support_request_id, event_type, support_revision)
      );
      CREATE TABLE learner_deletion_jobs (
        user_id TEXT PRIMARY KEY,
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
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  rows<T extends Record<string, unknown>>(sql: string): T[] {
    return this.sqlite.prepare(sql).all() as T[];
  }

  row<T extends Record<string, unknown>>(sql: string): T | undefined {
    return this.sqlite.prepare(sql).get() as T | undefined;
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

  async all<T>() {
    return {
      results: this.sqlite
        .prepare(this.sql)
        .all(...this.bindings()) as T[],
      success: true,
      meta: {},
    };
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

const EMAIL_BINDINGS = {
  RESEND_API_KEY: "re_test_only",
  AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
  SUPPORT_NOTIFICATION_EMAIL: "care@paretto.test",
};

describe("durable support notification outbox", () => {
  beforeEach(() => {
    setCloudflareEnv(EMAIL_BINDINGS);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("enqueues requester mail only for the exact verified signed-in address", async () => {
    const database = new SqliteD1();
    const now = Date.UTC(2026, 6, 25, 6);
    database.sqlite.exec(`
      INSERT INTO learner_user VALUES
        ('verified', 'verified@example.test', 1),
        ('unverified', 'unverified@example.test', 0);
    `);

    await createSupport(database, {
      id: "verified-ticket",
      userKey: "verified-user-key",
      replyEmail: "verified@example.test",
      accountId: "verified",
      now,
    });
    await createSupport(database, {
      id: "unverified-ticket",
      userKey: "unverified-user-key",
      replyEmail: "unverified@example.test",
      accountId: "unverified",
      now: now + 1,
    });
    await createSupport(database, {
      id: "mismatch-ticket",
      userKey: "mismatch-user-key",
      replyEmail: "other@example.test",
      accountId: "verified",
      now: now + 2,
    });
    await createSupport(database, {
      id: "anonymous-ticket",
      userKey: "anonymous-user-key",
      replyEmail: "anonymous@example.test",
      accountId: null,
      now: now + 3,
    });

    expect(
      database.rows<{
        support_request_id: string;
        event_type: string;
        recipient_email: string | null;
      }>(
        `SELECT support_request_id, event_type, recipient_email
         FROM support_notification_jobs
         ORDER BY support_request_id, event_type`,
      ),
    ).toEqual([
      {
        support_request_id: "anonymous-ticket",
        event_type: "operator_created",
        recipient_email: null,
      },
      {
        support_request_id: "mismatch-ticket",
        event_type: "operator_created",
        recipient_email: null,
      },
      {
        support_request_id: "unverified-ticket",
        event_type: "operator_created",
        recipient_email: null,
      },
      {
        support_request_id: "verified-ticket",
        event_type: "operator_created",
        recipient_email: null,
      },
      {
        support_request_id: "verified-ticket",
        event_type: "requester_created",
        recipient_email: "verified@example.test",
      },
    ]);
  });

  it("records provider failure without losing the ticket and retries idempotently", async () => {
    const database = new SqliteD1();
    const now = Date.UTC(2026, 6, 25, 7);
    await createSupport(database, {
      id: "durable-ticket",
      userKey: "anonymous-user-key",
      replyEmail: "reply@example.test",
      accountId: null,
      now,
      body: "private support body must never enter the email outbox",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      processSupportNotificationOutbox(
        database as unknown as D1Database,
        now,
      ),
    ).resolves.toEqual({
      examined: 1,
      claimed: 1,
      completed: 0,
      failed: 1,
    });
    expect(
      database.row<{
        status: string;
        attempts: number;
        last_error: string | null;
      }>(
        "SELECT status, attempts, last_error FROM support_notification_jobs",
      ),
    ).toEqual({
      status: "failed",
      attempts: 1,
      last_error: "Transactional email failed with 503.",
    });
    expect(database.rows("SELECT id FROM support_requests")).toEqual([
      { id: "durable-ticket" },
    ]);

    const retryAt = now + 15 * 60 * 1000;
    await expect(
      processSupportNotificationOutbox(
        database as unknown as D1Database,
        retryAt,
      ),
    ).resolves.toEqual({
      examined: 1,
      claimed: 1,
      completed: 1,
      failed: 0,
    });
    expect(
      database.row<{
        status: string;
        attempts: number;
        completed_at: number;
      }>(
        "SELECT status, attempts, completed_at FROM support_notification_jobs",
      ),
    ).toEqual({
      status: "completed",
      attempts: 2,
      completed_at: retryAt,
    });

    const calls = fetchMock.mock.calls as unknown as Array<
      [RequestInfo | URL, RequestInit]
    >;
    const firstKey = new Headers(calls[0][1].headers).get("idempotency-key");
    expect(firstKey).toMatch(/^support-notification:/);
    expect(new Headers(calls[1][1].headers).get("idempotency-key")).toBe(
      firstKey,
    );
    expect(calls.map(([, init]) => String(init.body)).join("\n")).not.toContain(
      "private support body",
    );
  });

  it("enqueues a status message only when creation established a verified recipient", async () => {
    const database = new SqliteD1();
    const now = Date.UTC(2026, 6, 25, 8);
    database.sqlite.exec(
      "INSERT INTO learner_user VALUES ('verified', 'verified@example.test', 1)",
    );
    await createSupport(database, {
      id: "status-ticket",
      userKey: "verified-user-key",
      replyEmail: "verified@example.test",
      accountId: "verified",
      now,
    });

    const nextRevision = 2;
    const updatedAt = now + 1;
    const results = await database.batch([
      database
        .prepare(
          `UPDATE support_requests
           SET status = 'resolved', revision = ?, updated_at = ?
           WHERE id = ? AND revision = 1`,
        )
        .bind(nextRevision, updatedAt, "status-ticket"),
      enqueueSupportStatusNotification(database as unknown as D1Database, {
        supportRequestId: "status-ticket",
        revision: nextRevision,
        status: "resolved",
        updatedAt,
      }) as unknown as SqliteD1Statement,
    ]);

    expect(results.map((result) => result.meta.changes)).toEqual([1, 1]);
    expect(
      database.rows<{
        event_type: string;
        support_revision: number;
        support_status: string;
        recipient_email: string | null;
      }>(
        `SELECT event_type, support_revision, support_status, recipient_email
         FROM support_notification_jobs
         WHERE event_type = 'requester_status'`,
      ),
    ).toEqual([
      {
        event_type: "requester_status",
        support_revision: 2,
        support_status: "resolved",
        recipient_email: "verified@example.test",
      },
    ]);
  });

  it("schedules immediate delivery without awaiting provider completion", async () => {
    const database = new SqliteD1();
    const now = Date.now();
    await createSupport(database, {
      id: "background-ticket",
      userKey: "background-user-key",
      replyEmail: null,
      accountId: null,
      now,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202 })),
    );

    scheduleSupportNotificationDelivery(database as unknown as D1Database);

    expect(waitUntilPromises).toHaveLength(1);
    await Promise.all(waitUntilPromises);
    expect(
      database.row<{ status: string }>(
        "SELECT status FROM support_notification_jobs",
      ),
    ).toEqual({ status: "completed" });
  });
});

async function createSupport(
  database: SqliteD1,
  input: {
    id: string;
    userKey: string;
    replyEmail: string | null;
    accountId: string | null;
    now: number;
    body?: string;
  },
) {
  return database.batch([
    database
      .prepare(
        `INSERT INTO support_requests (
           id, user_key, reply_email, category, subject, body, status,
           revision, created_at, updated_at
         ) VALUES (?, ?, ?, 'technical', 'Audio issue', ?, 'open', 1, ?, ?)`,
      )
      .bind(
        input.id,
        input.userKey,
        input.replyEmail,
        input.body ?? "Support body.",
        input.now,
        input.now,
      ),
    ...(enqueueSupportCreatedNotifications(
      database as unknown as D1Database,
      {
        supportRequestId: input.id,
        userKey: input.userKey,
        accountId: input.accountId,
        createdAt: input.now,
      },
    ) as unknown as SqliteD1Statement[]),
  ]);
}
