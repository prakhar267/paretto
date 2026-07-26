import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as ANALYTICS_GET } from "../app/api/admin/analytics/route";
import { POST as EVENT_POST, validateEvent } from "../app/api/events/route";
import { anonymousUserKey } from "../app/server-auth";
import {
  createAdminTestAuth,
  learnerCookieHeaders,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type StoredEvent = {
  id: string;
  userKey: string;
  sessionId: string;
  eventName: string;
  properties: string;
  occurredAt: number;
  receivedAt: number;
};

class AnalyticsMemoryD1 {
  events: StoredEvent[] = [];
  analyticsEnabled = true;

  prepare(sql: string) {
    return new AnalyticsStatement(this, sql);
  }

  async batch(statements: AnalyticsStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class AnalyticsStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(private database: AnalyticsMemoryD1, sql: string) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO PRODUCT_EVENTS")) {
      if (!this.database.analyticsEnabled) {
        return { meta: { changes: 0 } };
      }
      const [id, userKey, sessionId, eventName, properties, occurredAt, receivedAt] = this.values;
      this.database.events.push({
        id: String(id),
        userKey: String(userKey),
        sessionId: String(sessionId),
        eventName: String(eventName),
        properties: String(properties),
        occurredAt: Number(occurredAt),
        receivedAt: Number(receivedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM PRODUCT_EVENTS")) {
      const before = this.database.events.length;
      const cutoff = Number(this.values[0]);
      this.database.events = this.database.events.filter((event) => event.receivedAt >= cutoff);
      return { meta: { changes: before - this.database.events.length } };
    }
    if (
      this.sql.startsWith("DELETE FROM SUPPORT_REQUESTS") ||
      this.sql.startsWith("DELETE FROM ADMIN_AUDIT_LOG") ||
      this.sql.startsWith("DELETE FROM NATIVE_SESSIONS") ||
      this.sql.startsWith("DELETE FROM NATIVE_IDENTITY_TOKEN_USES") ||
      this.sql.startsWith("DELETE FROM ADMIN_LOGIN_ATTEMPTS") ||
      this.sql.startsWith("DELETE FROM LEARNER_SESSION") ||
      this.sql.startsWith("DELETE FROM LEARNER_VERIFICATION") ||
      this.sql.startsWith("DELETE FROM LEARNER_AUTH_RATE_LIMITS")
    ) {
      return { meta: { changes: 0 } };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }

  async first<T>() {
    if (this.sql.startsWith("SELECT PAYLOAD FROM LEARNING_STATE")) {
      return {
        payload: JSON.stringify({
          version: 1,
          settings: { analytics: this.database.analyticsEnabled },
        }),
      } as T;
    }
    if (this.sql.includes("COUNT(*) AS TOTAL_EVENTS")) {
      const [from, to] = this.values.map(Number);
      const events = this.window(from, to);
      return {
        total_events: events.length,
        active_learners: new Set(events.map((event) => event.userKey)).size,
        sessions: new Set(events.map((event) => event.sessionId)).size,
      } as T;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all<T>() {
    const [from, to] = this.values.map(Number);
    const events = this.window(from, to);
    if (this.sql.includes("GROUP BY EVENT_NAME")) {
      const counts = new Map<string, number>();
      for (const event of events) counts.set(event.eventName, (counts.get(event.eventName) ?? 0) + 1);
      return {
        results: [...counts].map(([event_name, count]) => ({ event_name, events: count })) as T[],
        success: true,
        meta: {},
      };
    }
    if (this.sql.includes("GROUP BY DATE")) {
      const date = new Date(events[0]?.occurredAt ?? Date.now()).toISOString().slice(0, 10);
      return {
        results: events.length
          ? [{ date, active_learners: new Set(events.map((event) => event.userKey)).size, events: events.length } as T]
          : [],
        success: true,
        meta: {},
      };
    }
    throw new Error(`Unexpected all SQL: ${this.sql}`);
  }

  private window(from: number, to: number) {
    return this.database.events.filter((event) => event.occurredAt >= from && event.occurredAt <= to);
  }
}

class BarrierSqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  beforeProductEventInsert: (() => Promise<void>) | null = null;

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE learning_state (
        user_key TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE product_events (
        id TEXT PRIMARY KEY NOT NULL,
        user_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        properties TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE TABLE learner_deletion_jobs (
        user_id TEXT PRIMARY KEY NOT NULL,
        user_key TEXT NOT NULL
      );
    `);
  }

  prepare(sql: string) {
    return new BarrierSqliteStatement(this, sql);
  }
}

class BarrierSqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: BarrierSqliteD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (
      /^\s*INSERT INTO product_events\b/i.test(this.sql) &&
      this.database.beforeProductEventInsert
    ) {
      await this.database.beforeProductEventInsert();
    }
    const result = this.database.sqlite
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

  async first<T>() {
    return (this.database.sqlite
      .prepare(this.sql)
      .get(...this.bindings()) ?? null) as T | null;
  }

  private bindings() {
    return this.values as Array<
      string | number | bigint | null | Uint8Array
    >;
  }
}

const EMAIL = "admin@paretto.test";
const SECRET = "analytics-test-secret-with-at-least-thirty-two-characters";

describe("privacy-aware analytics", () => {
  let database: AnalyticsMemoryD1;
  let adminCookie: string;

  beforeEach(async () => {
    database = new AnalyticsMemoryD1();
    const adminAuth = await createAdminTestAuth([EMAIL]);
    adminCookie = adminAuth.cookies.get(EMAIL)!;
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: SECRET,
      ...adminAuth.bindings,
    });
  });

  it("rejects unknown fields and stores only an opaque account key", async () => {
    expect(validateEvent({ event: "app_opened" }).ok).toBe(false);
    const baseEvent = {
      sessionId: "10000000-0000-4000-8000-000000000001",
      occurredAt: new Date().toISOString(),
    };
    expect(
      validateEvent({
        ...baseEvent,
        event: "navigation_changed",
        properties: { screen: "person@example.com" },
      }).ok,
    ).toBe(false);
    expect(
      validateEvent({
        ...baseEvent,
        event: "onboarding_completed",
        properties: { level: "new", dailyGoal: 6 },
      }).ok,
    ).toBe(false);
    expect(
      validateEvent({
        ...baseEvent,
        event: "lesson_completed",
        properties: {
          mode: "learn",
          regionId: "ile-de-france",
          correct: 6,
          wordCount: 5,
        },
      }).ok,
    ).toBe(false);
    expect(
      validateEvent({
        ...baseEvent,
        sessionId: "not-an-opaque-session",
        event: "challenge_started",
        properties: { wordCount: 5 },
      }).ok,
    ).toBe(false);
    expect(
      validateEvent({
        ...baseEvent,
        event: "audio_played",
        properties: { wordId: "person@example.com" },
      }).ok,
    ).toBe(false);
    const response = await EVENT_POST(
      new Request("https://paretto.test/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...learnerCookieHeaders(),
        },
        body: JSON.stringify({
          event: "lesson_completed",
          sessionId: "10000000-0000-4000-8000-000000000001",
          occurredAt: new Date().toISOString(),
          properties: { mode: "learn", regionId: "ile-de-france", correct: 5, wordCount: 5 },
        }),
      }),
    );
    expect(response.status).toBe(204);
    expect(database.events).toHaveLength(1);
    expect(database.events[0].userKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(database.events[0])).not.toContain(EMAIL);

    const rejected = await EVENT_POST(
      new Request("https://paretto.test/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...learnerCookieHeaders(),
        },
        body: JSON.stringify({
          event: "navigation_changed",
          sessionId: "10000000-0000-4000-8000-000000000001",
          occurredAt: new Date().toISOString(),
          properties: { screen: "today", email: EMAIL },
        }),
      }),
    );
    expect(rejected.status).toBe(400);
  });

  it("enforces the saved analytics opt-in on the server", async () => {
    database.analyticsEnabled = false;
    const response = await EVENT_POST(
      new Request("https://paretto.test/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...learnerCookieHeaders(),
        },
        body: JSON.stringify({
          event: "app_opened",
          sessionId: "10000000-0000-4000-8000-000000000010",
          occurredAt: new Date().toISOString(),
          properties: { currentRegionId: "ile-de-france", learnedWords: 0 },
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(database.events).toHaveLength(0);
  });

  it("does not store an event when opt-out commits after the pre-check but before the insert", async () => {
    const sqliteDatabase = new BarrierSqliteD1();
    const token = "R".repeat(43);
    const userKey = await anonymousUserKey(SECRET, token);
    sqliteDatabase.sqlite
      .prepare(
        `INSERT INTO learning_state (user_key, revision, payload, updated_at)
         VALUES (?, 1, ?, ?)`,
      )
      .run(
        userKey,
        JSON.stringify({ version: 1, settings: { analytics: true } }),
        Date.now(),
      );

    let signalInsertReached!: () => void;
    let allowInsert!: () => void;
    const insertReached = new Promise<void>((resolve) => {
      signalInsertReached = resolve;
    });
    const insertAllowed = new Promise<void>((resolve) => {
      allowInsert = resolve;
    });
    sqliteDatabase.beforeProductEventInsert = async () => {
      signalInsertReached();
      await insertAllowed;
    };
    setCloudflareEnv({
      DB: sqliteDatabase,
      USER_KEY_SECRET: SECRET,
    });

    const pendingResponse = EVENT_POST(
      new Request("https://paretto.test/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...learnerCookieHeaders(token),
        },
        body: JSON.stringify({
          event: "app_opened",
          sessionId: "10000000-0000-4000-8000-000000000011",
          occurredAt: new Date().toISOString(),
          properties: {
            currentRegionId: "ile-de-france",
            learnedWords: 0,
          },
        }),
      }),
    );

    try {
      await insertReached;
      sqliteDatabase.sqlite
        .prepare(
          `UPDATE learning_state
           SET payload = ?, revision = revision + 1, updated_at = ?
           WHERE user_key = ?`,
        )
        .run(
          JSON.stringify({ version: 1, settings: { analytics: false } }),
          Date.now(),
          userKey,
        );
      allowInsert();

      const response = await pendingResponse;
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Optional analytics are not enabled for this account.",
      });
      expect(
        sqliteDatabase.sqlite
          .prepare("SELECT COUNT(*) AS total FROM product_events")
          .get(),
      ).toEqual({ total: 0 });
    } finally {
      allowInsert();
      await pendingResponse.catch(() => undefined);
      sqliteDatabase.sqlite.close();
    }
  });

  it("returns aggregate admin reporting without raw identities", async () => {
    await EVENT_POST(
      new Request("https://paretto.test/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...learnerCookieHeaders(),
        },
        body: JSON.stringify({
          event: "app_opened",
          sessionId: "10000000-0000-4000-8000-000000000002",
          occurredAt: new Date().toISOString(),
          properties: { currentRegionId: "ile-de-france", learnedWords: 5 },
        }),
      }),
    );

    const response = await ANALYTICS_GET(
      new Request("https://paretto.test/api/admin/analytics?days=30", {
        headers: { cookie: adminCookie },
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ totals: { events: 1, activeLearners: 1, sessions: 1 } });
    expect(JSON.stringify(payload)).not.toContain(EMAIL);
  });
});
