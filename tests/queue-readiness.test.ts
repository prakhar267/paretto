import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { readQueueReadiness } from "../app/api/health/route";

type SqliteBinding = string | number | bigint | null | Uint8Array;

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE learner_deletion_jobs (
        user_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX learner_deletion_jobs_status_updated_idx
        ON learner_deletion_jobs (status, updated_at);
      CREATE TABLE support_notification_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX support_notification_jobs_delivery_idx
        ON support_notification_jobs (status, updated_at, id);
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
    return (this.sqlite
      .prepare(this.sql)
      .get(...(this.values as SqliteBinding[])) ?? null) as T | null;
  }
}

describe("bounded health queue readiness", () => {
  const databases: SqliteD1[] = [];

  afterEach(() => {
    for (const database of databases) database.sqlite.close();
    databases.length = 0;
  });

  it("caps diagnostic counts while still failing a stale deletion backlog", async () => {
    const database = new SqliteD1();
    databases.push(database);
    const now = Date.UTC(2026, 6, 25, 12);
    const insert = database.sqlite.prepare(
      `INSERT INTO learner_deletion_jobs (
         user_id, status, last_error, updated_at
       ) VALUES (?, 'pending', NULL, ?)`,
    );
    for (let index = 0; index < 1_005; index += 1) {
      insert.run(`learner-${index}`, now - 2 * 60 * 60 * 1_000);
    }

    const readiness = await readQueueReadiness(
      database as unknown as D1Database,
      now,
    );

    expect(readiness.healthy).toBe(false);
    expect(readiness.accountDeletion).toMatchObject({
      status: "stalled",
      pending: 1_001,
      countCapped: true,
    });
  });

  it("uses the latest queue transition time instead of ticket age", async () => {
    const database = new SqliteD1();
    databases.push(database);
    const now = Date.UTC(2026, 6, 25, 12);
    database.sqlite
      .prepare(
        `INSERT INTO support_notification_jobs (
           id, status, created_at, updated_at
         ) VALUES ('leased-old-job', 'processing', ?, ?)`,
      )
      .run(now - 24 * 60 * 60 * 1_000, now - 30_000);

    const readiness = await readQueueReadiness(
      database as unknown as D1Database,
      now,
    );

    expect(readiness.healthy).toBe(true);
    expect(readiness.supportNotifications).toMatchObject({
      status: "ready",
      open: 1,
      failed: 0,
      countCapped: false,
      oldestOpenAt: new Date(now - 30_000).toISOString(),
    });
  });
});
