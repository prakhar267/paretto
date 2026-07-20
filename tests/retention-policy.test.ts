import { describe, expect, it } from "vitest";

import {
  OPERATIONAL_RECORD_RETENTION_DAYS,
  PRODUCT_EVENT_RETENTION_DAYS,
  retentionCutoffs,
  runRetentionMaintenance,
} from "../app/retention-policy";

const DAY_MS = 24 * 60 * 60 * 1000;

class RetentionMemoryD1 {
  events: Array<{ id: string; userKey: string; receivedAt: number }> = [];
  support: Array<{
    id: string;
    userKey: string;
    status: string;
    updatedAt: number;
  }> = [];
  audits: Array<{ id: string; entityId: string; createdAt: number }> = [];
  sessions: Array<{
    tokenHash: string;
    expiresAt: number;
    revokedAt: number | null;
  }> = [];
  identityTokens: Array<{ tokenHash: string; expiresAt: number }> = [];
  holds: Array<{ dataClass: string; recordKey: string | null }> = [];

  prepare(sql: string) {
    return new RetentionStatement(this, sql);
  }

  async batch(statements: RetentionStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  isHeld(dataClass: string, keys: string[]) {
    return this.holds.some(
      (hold) =>
        hold.dataClass === dataClass &&
        (hold.recordKey === null || keys.includes(hold.recordKey)),
    );
  }
}

class RetentionStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: RetentionMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const cutoff = Number(this.values[0]);
    const limit = Number(this.values[1]);
    if (this.sql.startsWith("DELETE FROM PRODUCT_EVENTS")) {
      this.assertGovernedDelete();
      const deleted = this.database.events
        .filter(
          (event) =>
            event.receivedAt < cutoff &&
            !this.database.isHeld("product_events", [event.id, event.userKey]),
        )
        .sort((left, right) => left.receivedAt - right.receivedAt || left.id.localeCompare(right.id))
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((event) => event.id));
      this.database.events = this.database.events.filter(
        (event) => !deletedIds.has(event.id),
      );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM SUPPORT_REQUESTS")) {
      this.assertGovernedDelete();
      const deleted = this.database.support
        .filter(
          (record) =>
            ["resolved", "closed"].includes(record.status) &&
            record.updatedAt < cutoff &&
            !this.database.isHeld("support_requests", [record.id, record.userKey]),
        )
        .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.id));
      this.database.support = this.database.support.filter(
        (record) => !deletedIds.has(record.id),
      );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM ADMIN_AUDIT_LOG")) {
      this.assertGovernedDelete();
      const deleted = this.database.audits
        .filter(
          (record) =>
            record.createdAt < cutoff &&
            !this.database.isHeld("admin_audit_log", [record.id, record.entityId]),
        )
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.id));
      this.database.audits = this.database.audits.filter(
        (record) => !deletedIds.has(record.id),
      );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM NATIVE_SESSIONS")) {
      const deleted = this.database.sessions
        .filter((record) => record.expiresAt < cutoff || record.revokedAt !== null)
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.tokenHash));
      this.database.sessions = this.database.sessions.filter(
        (record) => !deletedIds.has(record.tokenHash),
      );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM NATIVE_IDENTITY_TOKEN_USES")) {
      const deleted = this.database.identityTokens
        .filter((record) => record.expiresAt < cutoff)
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.tokenHash));
      this.database.identityTokens = this.database.identityTokens.filter(
        (record) => !deletedIds.has(record.tokenHash),
      );
      return { meta: { changes: deleted.length } };
    }
    throw new Error(`Unexpected retention SQL: ${this.sql}`);
  }

  private assertGovernedDelete() {
    if (
      !this.sql.includes("RETENTION_LEGAL_HOLDS") ||
      !this.sql.includes("HOLDS.STATUS = 'ACTIVE'") ||
      !this.sql.includes("LIMIT ?")
    ) {
      throw new Error("Retention delete is missing its hold or batch guard");
    }
  }
}

describe("retention maintenance", () => {
  it("uses the published 400-day and 730-day cutoffs", () => {
    const now = Date.UTC(2026, 6, 20, 3, 17);
    expect(retentionCutoffs(now)).toEqual({
      productEvents: now - PRODUCT_EVENT_RETENTION_DAYS * DAY_MS,
      operationalRecords: now - OPERATIONAL_RECORD_RETENTION_DAYS * DAY_MS,
    });
  });

  it("deletes only expired eligible records in one maintenance run", async () => {
    const now = Date.UTC(2026, 6, 20, 3, 17);
    const database = new RetentionMemoryD1();
    database.events = [
      { id: "event-old", userKey: "user-a", receivedAt: now - 401 * DAY_MS },
      { id: "event-boundary", userKey: "user-a", receivedAt: now - 400 * DAY_MS },
      { id: "event-current", userKey: "user-a", receivedAt: now },
    ];
    database.support = [
      { id: "support-old", userKey: "user-a", status: "resolved", updatedAt: now - 731 * DAY_MS },
      { id: "support-boundary", userKey: "user-a", status: "closed", updatedAt: now - 730 * DAY_MS },
      { id: "support-open", userKey: "user-a", status: "open", updatedAt: now - 900 * DAY_MS },
    ];
    database.audits = [
      { id: "1", entityId: "entity-a", createdAt: now - 731 * DAY_MS },
      { id: "2", entityId: "entity-a", createdAt: now - 730 * DAY_MS },
    ];

    const result = await runRetentionMaintenance(
      database as unknown as D1Database,
      now,
    );

    expect(result).toEqual({
      productEvents: 1,
      supportRequests: 1,
      auditEvents: 1,
      nativeSessions: 0,
      nativeIdentityTokens: 0,
    });
    expect(database.events.map((event) => event.id)).toEqual([
      "event-boundary",
      "event-current",
    ]);
    expect(database.support.map((record) => record.id)).toEqual([
      "support-boundary",
      "support-open",
    ]);
    expect(database.audits.map((record) => record.id)).toEqual(["2"]);
  });

  it("honours targeted legal holds and bounds every data-class batch", async () => {
    const now = Date.UTC(2026, 6, 20, 3, 17);
    const database = new RetentionMemoryD1();
    const expiredEvent = now - 401 * DAY_MS;
    const expiredOperational = now - 731 * DAY_MS;
    database.events = [
      { id: "event-held-user", userKey: "held-user", receivedAt: expiredEvent },
      { id: "event-held-id", userKey: "user-b", receivedAt: expiredEvent + 1 },
      { id: "event-delete", userKey: "user-c", receivedAt: expiredEvent + 2 },
      { id: "event-next-batch", userKey: "user-d", receivedAt: expiredEvent + 3 },
    ];
    database.support = [
      { id: "support-held", userKey: "user-e", status: "resolved", updatedAt: expiredOperational },
      { id: "support-delete", userKey: "user-f", status: "closed", updatedAt: expiredOperational + 1 },
    ];
    database.audits = [
      { id: "1", entityId: "held-entity", createdAt: expiredOperational },
      { id: "2", entityId: "other-entity", createdAt: expiredOperational + 1 },
    ];
    database.sessions = [
      { tokenHash: "expired-first", expiresAt: now - 2, revokedAt: null },
      { tokenHash: "expired-next", expiresAt: now - 1, revokedAt: null },
      { tokenHash: "revoked-future", expiresAt: now + DAY_MS, revokedAt: now - 1 },
    ];
    database.identityTokens = [
      { tokenHash: "identity-first", expiresAt: now - 2 },
      { tokenHash: "identity-next", expiresAt: now - 1 },
    ];
    database.holds = [
      { dataClass: "product_events", recordKey: "held-user" },
      { dataClass: "product_events", recordKey: "event-held-id" },
      { dataClass: "support_requests", recordKey: "support-held" },
      { dataClass: "admin_audit_log", recordKey: "held-entity" },
    ];

    const result = await runRetentionMaintenance(
      database as unknown as D1Database,
      now,
      1,
    );

    expect(result).toEqual({
      productEvents: 1,
      supportRequests: 1,
      auditEvents: 1,
      nativeSessions: 1,
      nativeIdentityTokens: 1,
    });
    expect(database.events.map((record) => record.id)).toEqual([
      "event-held-user",
      "event-held-id",
      "event-next-batch",
    ]);
    expect(database.support.map((record) => record.id)).toEqual(["support-held"]);
    expect(database.audits.map((record) => record.id)).toEqual(["1"]);
    expect(database.sessions.map((record) => record.tokenHash)).toEqual([
      "expired-next",
      "revoked-future",
    ]);
    expect(database.identityTokens.map((record) => record.tokenHash)).toEqual([
      "identity-next",
    ]);
  });

  it("allows an active class-wide hold to pause an entire retention class", async () => {
    const now = Date.UTC(2026, 6, 20, 3, 17);
    const database = new RetentionMemoryD1();
    database.events = [
      { id: "event-old", userKey: "user-a", receivedAt: now - 401 * DAY_MS },
    ];
    database.holds = [{ dataClass: "product_events", recordKey: null }];

    const result = await runRetentionMaintenance(
      database as unknown as D1Database,
      now,
    );
    expect(result.productEvents).toBe(0);
    expect(database.events).toHaveLength(1);
  });

  it("rejects unbounded maintenance requests", async () => {
    const database = new RetentionMemoryD1();
    await expect(
      runRetentionMaintenance(database as unknown as D1Database, Date.now(), 1_001),
    ).rejects.toThrow("batch limit");
  });
});
