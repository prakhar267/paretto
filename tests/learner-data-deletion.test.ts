import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  LEARNER_DELETION_STAGE_TIMEOUT_MS,
  processLearnerDataDeletionJob,
  processPendingLearnerDataDeletions,
  stageLearnerDataDeletion,
} from "../app/learner-data-deletion";

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE learner_user (id TEXT PRIMARY KEY);
      CREATE TABLE learner_deletion_jobs (
        user_id TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        native_account_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at INTEGER NOT NULL,
        completed_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE learning_state (user_key TEXT PRIMARY KEY);
      CREATE TABLE learner_progress_generations (
        user_key TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE product_events (id TEXT PRIMARY KEY, user_key TEXT NOT NULL);
      CREATE TABLE support_requests (id TEXT PRIMARY KEY, user_key TEXT NOT NULL);
      CREATE TABLE support_notification_jobs (
        id TEXT PRIMARY KEY,
        support_request_id TEXT NOT NULL
      );
      CREATE TABLE native_learning_state (account_id TEXT PRIMARY KEY);
      CREATE TABLE native_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL);
      CREATE TABLE native_apple_credentials (account_id TEXT PRIMARY KEY);
      CREATE TABLE native_learner_links (
        native_account_id TEXT PRIMARY KEY,
        learner_user_id TEXT NOT NULL
      );
      CREATE TABLE native_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE retention_legal_holds (
        id TEXT PRIMARY KEY,
        data_class TEXT NOT NULL,
        record_key TEXT,
        status TEXT NOT NULL
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

  row<T extends Record<string, unknown>>(sql: string): T | undefined {
    return this.sqlite.prepare(sql).get() as T | undefined;
  }

  rows<T extends Record<string, unknown>>(sql: string): T[] {
    return this.sqlite.prepare(sql).all() as T[];
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
      this.sqlite.prepare(this.sql).get(...this.bindings()) as T | undefined
    ) ?? null;
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

describe("durable learner-data deletion", () => {
  it("waits for auth deletion, preserves only legally held rows, and finishes after release", async () => {
    const database = new SqliteD1();
    const now = Date.UTC(2026, 6, 25, 4);
    database.sqlite.exec(`
      INSERT INTO learner_user VALUES ('learner-1');
      INSERT INTO learning_state VALUES ('opaque-user-1');
      INSERT INTO learner_progress_generations VALUES
        ('opaque-user-1', 2, 1);
      INSERT INTO product_events VALUES
        ('event-held-by-id', 'opaque-user-1'),
        ('event-delete', 'opaque-user-1');
      INSERT INTO support_requests VALUES
        ('support-held-by-user', 'opaque-user-1'),
        ('support-held-by-user-2', 'opaque-user-1');
      INSERT INTO support_notification_jobs VALUES
        ('notification-private', 'support-held-by-user');
      INSERT INTO native_accounts VALUES ('native-1');
      INSERT INTO native_learning_state VALUES ('native-1');
      INSERT INTO native_sessions VALUES ('session-1', 'native-1');
      INSERT INTO native_apple_credentials VALUES ('native-1');
      INSERT INTO native_learner_links VALUES ('native-1', 'learner-1');
      INSERT INTO retention_legal_holds VALUES
        ('hold-event', 'product_events', 'event-held-by-id', 'active'),
        ('hold-support-user', 'support_requests', 'opaque-user-1', 'active');
    `);
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-1",
      userKey: "opaque-user-1",
      nativeAccountId: "native-1",
      requestedAt: now,
    });

    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-1",
        now + 1,
      ),
    ).resolves.toMatchObject({
      found: true,
      completed: false,
      held: false,
      userStillExists: true,
    });
    expect(database.row<{ status: string }>(
      "SELECT status FROM learner_deletion_jobs",
    )?.status).toBe("pending");

    database.sqlite.exec("DELETE FROM learner_user WHERE id = 'learner-1'");
    const held = await processLearnerDataDeletionJob(
      database as unknown as D1Database,
      "learner-1",
      now + 2,
    );

    expect(held).toMatchObject({
      completed: false,
      held: true,
      userStillExists: false,
      deleted: {
        learningState: 2,
        productEvents: 1,
        supportRequests: 0,
        nativeRecords: 5,
      },
    });
    expect(
      database.rows<{ id: string }>(
        "SELECT id FROM product_events ORDER BY id",
      ),
    ).toEqual([{ id: "event-held-by-id" }]);
    expect(database.rows<{ id: string }>(
      "SELECT id FROM support_requests ORDER BY id",
    )).toHaveLength(2);
    expect(database.rows("SELECT id FROM support_notification_jobs")).toEqual(
      [],
    );
    expect(database.rows("SELECT id FROM native_accounts")).toEqual([]);
    expect(
      database.rows("SELECT user_key FROM learner_progress_generations"),
    ).toEqual([]);
    expect(database.row<{ status: string }>(
      "SELECT status FROM learner_deletion_jobs",
    )?.status).toBe("held");

    database.sqlite.exec(
      "UPDATE retention_legal_holds SET status = 'released'",
    );
    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-1",
        now + 3,
      ),
    ).resolves.toMatchObject({
      completed: true,
      held: false,
      deleted: {
        productEvents: 1,
        supportRequests: 2,
      },
    });
    expect(database.rows("SELECT id FROM product_events")).toEqual([]);
    expect(database.rows("SELECT id FROM support_requests")).toEqual([]);
    expect(database.row<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM learner_deletion_jobs",
    )).toEqual({ status: "completed", attempts: 2 });
  });

  it("honours a class-wide hold and keeps the job retryable", async () => {
    const database = new SqliteD1();
    database.sqlite.exec(`
      INSERT INTO product_events VALUES
        ('event-one', 'opaque-user-2'),
        ('event-two', 'opaque-user-2');
      INSERT INTO retention_legal_holds VALUES
        ('hold-all-events', 'product_events', NULL, 'active');
    `);
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-2",
      userKey: "opaque-user-2",
    });

    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-2",
      ),
    ).resolves.toMatchObject({ held: true, completed: false });
    expect(database.rows("SELECT id FROM product_events")).toHaveLength(2);

    database.sqlite.exec(
      "UPDATE retention_legal_holds SET status = 'released'",
    );
    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-2",
      ),
    ).resolves.toMatchObject({ held: false, completed: true });
    expect(database.rows("SELECT id FROM product_events")).toEqual([]);
  });

  it("never replaces a staged opaque identity or native deletion target", async () => {
    const database = new SqliteD1();
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-stable",
      userKey: "opaque-original",
      nativeAccountId: "native-original",
      requestedAt: 10,
    });

    await expect(
      stageLearnerDataDeletion(database as unknown as D1Database, {
        userId: "learner-stable",
        userKey: "opaque-rotated",
        nativeAccountId: "native-original",
        requestedAt: 20,
      }),
    ).rejects.toThrow("target changed");
    await expect(
      stageLearnerDataDeletion(database as unknown as D1Database, {
        userId: "learner-stable",
        userKey: "opaque-original",
        nativeAccountId: "native-different",
        requestedAt: 30,
      }),
    ).rejects.toThrow("target changed");

    expect(database.row<{
      user_key: string;
      native_account_id: string;
      requested_at: number;
    }>(
      `SELECT user_key, native_account_id, requested_at
       FROM learner_deletion_jobs WHERE user_id = 'learner-stable'`,
    )).toEqual({
      user_key: "opaque-original",
      native_account_id: "native-original",
      requested_at: 10,
    });
  });

  it("records a failed cleanup for retry without partially deleting data", async () => {
    const database = new SqliteD1();
    database.sqlite.exec(`
      INSERT INTO learning_state VALUES ('opaque-user-3');
      INSERT INTO product_events VALUES ('event-3', 'opaque-user-3');
      DROP TABLE support_requests;
    `);
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-3",
      userKey: "opaque-user-3",
    });

    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-3",
      ),
    ).rejects.toThrow("support_requests");
    expect(database.rows("SELECT user_key FROM learning_state")).toHaveLength(1);
    expect(database.rows("SELECT id FROM product_events")).toHaveLength(1);
    expect(database.row<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(
      "SELECT status, attempts, last_error FROM learner_deletion_jobs",
    )).toMatchObject({
      status: "pending",
      attempts: 1,
      last_error: expect.stringContaining("support_requests"),
    });

    database.sqlite.exec(
      "CREATE TABLE support_requests (id TEXT PRIMARY KEY, user_key TEXT NOT NULL)",
    );
    await expect(
      processPendingLearnerDataDeletions(
        database as unknown as D1Database,
      ),
    ).resolves.toEqual({
      completed: 1,
      held: 0,
      waitingForUserDeletion: 0,
      cancelled: 0,
    });
  });

  it("prioritizes actionable deletions within a bounded queue page", async () => {
    const database = new SqliteD1();
    const queueNow = Date.now();
    database.sqlite.exec("INSERT INTO learner_user VALUES ('learner-waiting')");
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-complete",
      userKey: "key-complete",
      requestedAt: queueNow - 2,
    });
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-waiting",
      userKey: "key-waiting",
      requestedAt: queueNow - 1,
    });
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-next-page",
      userKey: "key-next-page",
      requestedAt: queueNow,
    });

    await expect(
      processPendingLearnerDataDeletions(
        database as unknown as D1Database,
        queueNow,
        2,
      ),
    ).resolves.toEqual({
      completed: 2,
      held: 0,
      waitingForUserDeletion: 0,
      cancelled: 0,
    });
    expect(database.row<{ status: string }>(
      "SELECT status FROM learner_deletion_jobs WHERE user_id = 'learner-waiting'",
    )?.status).toBe("pending");
  });

  it("unblocks an intact account after an abandoned pre-delete stage expires", async () => {
    const database = new SqliteD1();
    const requestedAt = Date.UTC(2026, 6, 25, 5);
    database.sqlite.exec("INSERT INTO learner_user VALUES ('learner-intact')");
    await stageLearnerDataDeletion(database as unknown as D1Database, {
      userId: "learner-intact",
      userKey: "key-intact",
      requestedAt,
    });

    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-intact",
        requestedAt + LEARNER_DELETION_STAGE_TIMEOUT_MS - 1,
      ),
    ).resolves.toMatchObject({
      userStillExists: true,
      cancelled: false,
    });
    await expect(
      processLearnerDataDeletionJob(
        database as unknown as D1Database,
        "learner-intact",
        requestedAt + LEARNER_DELETION_STAGE_TIMEOUT_MS,
      ),
    ).resolves.toMatchObject({
      userStillExists: false,
      cancelled: true,
    });
    expect(database.rows("SELECT user_id FROM learner_deletion_jobs")).toEqual(
      [],
    );
    expect(database.rows("SELECT id FROM learner_user")).toEqual([
      { id: "learner-intact" },
    ]);
  });
});
