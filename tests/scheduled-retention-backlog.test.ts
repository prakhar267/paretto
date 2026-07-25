import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runScheduledRetentionMaintenance } from "../app/retention-policy";
import { initializeLocalSchema } from "../db";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type SqliteBinding = string | number | bigint | null | Uint8Array;

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
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
    return (this.sqlite
      .prepare(this.sql)
      .get(...this.bindings()) ?? null) as T | null;
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
    const result = this.sqlite
      .prepare(this.sql)
      .run(...this.bindings());
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  private bindings() {
    return this.values as SqliteBinding[];
  }
}

describe("scheduled retention backlog draining", () => {
  let database: SqliteD1;

  beforeEach(async () => {
    database = new SqliteD1();
    await initializeLocalSchema(database as unknown as D1Database);
    setCloudflareEnv({});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it("drains more than one learner-deletion queue page before reporting success", async () => {
    const scheduledAt = Date.UTC(2026, 6, 25, 3, 17);
    const insert = database.sqlite.prepare(
      `INSERT INTO learner_deletion_jobs (
         user_id, user_key, native_account_id, status, requested_at,
         completed_at, attempts, last_error, updated_at
       ) VALUES (?, ?, NULL, 'pending', ?, NULL, 0, NULL, ?)`,
    );
    for (let index = 0; index < 26; index += 1) {
      insert.run(
        `learner-${index}`,
        `account:key-${index}`,
        scheduledAt - 1_000,
        scheduledAt - 1_000,
      );
    }

    const times = [scheduledAt + 1_000, scheduledAt + 2_000];
    const result = await runScheduledRetentionMaintenance(
      database as unknown as D1Database,
      scheduledAt,
      {
        runId: "deletion-backlog",
        maxPages: 3,
        now: () => times.shift() ?? scheduledAt + 2_000,
      },
    );

    expect(result.pagesProcessed).toBe(2);
    expect(result.deleted.learnerDeletionJobsCompleted).toBe(26);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM learner_deletion_jobs WHERE status = 'pending'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.sqlite
        .prepare(
          "SELECT status FROM retention_schedule_state WHERE job_name = 'scheduled_retention'",
        )
        .get(),
    ).toEqual({ status: "succeeded" });
  });

  it("drains more than one due notification page before reporting success", async () => {
    const scheduledAt = Date.UTC(2026, 6, 25, 3, 17);
    const supportInsert = database.sqlite.prepare(
      `INSERT INTO support_requests (
         id, user_key, reply_email, category, subject, body, status,
         revision, created_at, updated_at
       ) VALUES (?, ?, NULL, 'technical', 'Help', 'A support message',
                 'open', 1, ?, ?)`,
    );
    const jobInsert = database.sqlite.prepare(
      `INSERT INTO support_notification_jobs (
         id, support_request_id, event_type, support_revision,
         support_status, recipient_email, status, attempts, available_at,
         lease_expires_at, last_error, completed_at, created_at, updated_at
       ) VALUES (?, ?, 'operator_created', 1, 'open', NULL, 'pending', 0,
                 ?, NULL, NULL, NULL, ?, ?)`,
    );
    for (let index = 0; index < 26; index += 1) {
      const supportId = `support-${index}`;
      supportInsert.run(
        supportId,
        `anonymous:key-${index}`,
        scheduledAt - 2_000,
        scheduledAt - 2_000,
      );
      jobInsert.run(
        `job-${index}`,
        supportId,
        scheduledAt - 1_000,
        scheduledAt - 1_000,
        scheduledAt - 1_000,
      );
    }
    setCloudflareEnv({
      RESEND_API_KEY: "re_test_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "care@paretto.test",
    });
    const delivery = vi.fn(async () =>
      Response.json({ id: crypto.randomUUID() }, { status: 200 }),
    );
    vi.stubGlobal("fetch", delivery);

    const times = [scheduledAt + 1_000, scheduledAt + 2_000];
    const result = await runScheduledRetentionMaintenance(
      database as unknown as D1Database,
      scheduledAt,
      {
        runId: "notification-backlog",
        maxPages: 3,
        now: () => times.shift() ?? scheduledAt + 2_000,
      },
    );

    expect(result.pagesProcessed).toBe(2);
    expect(result.deleted.supportNotificationJobsCompleted).toBe(26);
    expect(delivery).toHaveBeenCalledTimes(26);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM support_notification_jobs WHERE status != 'completed'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
