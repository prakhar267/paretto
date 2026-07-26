import { describe, expect, it } from "vitest";

import {
  ADMIN_LOGIN_ATTEMPT_RETENTION_MS,
  AUTH_TRANSIENT_RETENTION_MS,
  LEARNER_DELETION_TOMBSTONE_RETENTION_MS,
  OPERATIONAL_RECORD_RETENTION_DAYS,
  PRODUCT_EVENT_RETENTION_DAYS,
  RETENTION_RUN_STALE_AFTER_MS,
  RETENTION_SCHEDULE_MISSED_AFTER_MS,
  SUPPORT_RATE_LIMIT_RETENTION_MS,
  readScheduledRetentionStatus,
  retentionCutoffs,
  runRetentionMaintenance,
  runScheduledRetentionMaintenance,
} from "../app/retention-policy";
import { BETTER_AUTH_RATE_LIMIT_RETENTION_MS } from "../app/learner-auth-rate-limit";

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
  adminAttempts: Array<{ ipHash: string; updatedAt: number }> = [];
  learnerSessions: Array<{ id: string; expiresAt: number }> = [];
  learnerVerifications: Array<{ id: string; expiresAt: number }> = [];
  learnerAuthRateLimits: Array<{
    bucketHash: string;
    updatedAt: number;
  }> = [];
  supportRateLimits: Array<{ bucketHash: string; updatedAt: number }> = [];
  deletionTombstones: Array<{ userId: string; completedAt: number }> = [];
  notificationJobs: Array<{
    id: string;
    supportRequestId: string;
    status: string;
    completedAt: number | null;
    updatedAt: number;
  }> = [];
  holds: Array<{ dataClass: string; recordKey: string | null }> = [];
  schedule: {
    status: string;
    monitoring_started_at: number;
    run_id: string | null;
    scheduled_at: number | null;
    started_at: number | null;
    completed_at: number | null;
    last_succeeded_at: number | null;
    last_failed_at: number | null;
    last_error: string | null;
    last_result: string | null;
    updated_at: number;
  } | null = null;
  failNextDelete = false;

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

  async all<T>() {
    if (this.sql.includes("FROM SUPPORT_NOTIFICATION_JOBS AS JOBS")) {
      return { results: [] as T[] };
    }
    if (
      this.sql.includes(
        "FROM LEARNER_DELETION_JOBS AS JOBS LEFT JOIN LEARNER_USER AS USERS",
      )
    ) {
      return { results: [] as T[] };
    }
    throw new Error(`Unexpected retention all SQL: ${this.sql}`);
  }

  async first<T>() {
    if (
      this.sql.startsWith(
        "SELECT CASE WHEN EXISTS ( SELECT 1 FROM PRODUCT_EVENTS",
      )
    ) {
      const expiredRetentionRows =
        this.database.events.length +
          this.database.support.length +
          this.database.audits.length +
          this.database.sessions.length +
          this.database.identityTokens.length +
          this.database.adminAttempts.length +
          this.database.learnerSessions.length +
          this.database.learnerVerifications.length +
          this.database.learnerAuthRateLimits.length +
          this.database.supportRateLimits.length +
          this.database.deletionTombstones.length +
          this.database.notificationJobs.length >
        0;
      return {
        expired_retention_rows: expiredRetentionRows ? 1 : 0,
        learner_deletion_jobs: 0,
        support_notification_jobs: 0,
      } as T;
    }
    if (
      this.sql.startsWith(
        "SELECT STATUS, MONITORING_STARTED_AT",
      )
    ) {
      return this.database.schedule as T | null;
    }
    throw new Error(`Unexpected retention first SQL: ${this.sql}`);
  }

  async run() {
    if (
      this.database.failNextDelete &&
      this.sql.startsWith("DELETE FROM")
    ) {
      this.database.failNextDelete = false;
      throw new Error("simulated scheduled cleanup failure");
    }
    if (
      this.sql.startsWith(
        "INSERT INTO RETENTION_SCHEDULE_STATE",
      )
    ) {
      const [
        ,
        rawMonitoringStartedAt,
        rawRunId,
        rawScheduledAt,
        rawStartedAt,
        rawUpdatedAt,
      ] = this.values;
      this.database.schedule = {
        status: "running",
        monitoring_started_at:
          this.database.schedule?.monitoring_started_at ??
          Number(rawMonitoringStartedAt),
        run_id: String(rawRunId),
        scheduled_at: Number(rawScheduledAt),
        started_at: Number(rawStartedAt),
        completed_at: null,
        last_succeeded_at:
          this.database.schedule?.last_succeeded_at ?? null,
        last_failed_at:
          this.database.schedule?.last_failed_at ?? null,
        last_error: this.database.schedule?.last_error ?? null,
        last_result: this.database.schedule?.last_result ?? null,
        updated_at: Number(rawUpdatedAt),
      };
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith(
        "UPDATE RETENTION_SCHEDULE_STATE SET STATUS = 'SUCCEEDED'",
      )
    ) {
      const [
        rawCompletedAt,
        rawSucceededAt,
        rawResult,
        rawUpdatedAt,
        ,
        rawRunId,
      ] = this.values;
      if (
        !this.database.schedule ||
        this.database.schedule.run_id !== String(rawRunId)
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.schedule = {
        ...this.database.schedule,
        status: "succeeded",
        completed_at: Number(rawCompletedAt),
        last_succeeded_at: Number(rawSucceededAt),
        last_error: null,
        last_result: String(rawResult),
        updated_at: Number(rawUpdatedAt),
      };
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith(
        "UPDATE RETENTION_SCHEDULE_STATE SET STATUS = 'FAILED'",
      )
    ) {
      const [
        rawCompletedAt,
        rawFailedAt,
        rawError,
        rawResult,
        rawUpdatedAt,
        ,
        rawRunId,
      ] = this.values;
      if (
        !this.database.schedule ||
        this.database.schedule.run_id !== String(rawRunId)
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.schedule = {
        ...this.database.schedule,
        status: "failed",
        completed_at: Number(rawCompletedAt),
        last_failed_at: Number(rawFailedAt),
        last_error: String(rawError),
        last_result:
          typeof rawResult === "string" ? rawResult : null,
        updated_at: Number(rawUpdatedAt),
      };
      return { meta: { changes: 1 } };
    }
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
    if (this.sql.startsWith("DELETE FROM ADMIN_LOGIN_ATTEMPTS")) {
      const deleted = this.database.adminAttempts
        .filter((record) => record.updatedAt < cutoff)
        .sort(
          (left, right) =>
            left.updatedAt - right.updatedAt ||
            left.ipHash.localeCompare(right.ipHash),
        )
        .slice(0, limit);
      const deletedIds = new Set(
        deleted.map((record) => record.ipHash),
      );
      this.database.adminAttempts =
        this.database.adminAttempts.filter(
          (record) => !deletedIds.has(record.ipHash),
        );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM LEARNER_SESSION")) {
      const deleted = this.database.learnerSessions
        .filter((record) => record.expiresAt < cutoff)
        .sort(
          (left, right) =>
            left.expiresAt - right.expiresAt || left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.id));
      this.database.learnerSessions = this.database.learnerSessions.filter(
        (record) => !deletedIds.has(record.id),
      );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM LEARNER_VERIFICATION")) {
      const deleted = this.database.learnerVerifications
        .filter((record) => record.expiresAt < cutoff)
        .sort(
          (left, right) =>
            left.expiresAt - right.expiresAt || left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.id));
      this.database.learnerVerifications =
        this.database.learnerVerifications.filter(
          (record) => !deletedIds.has(record.id),
        );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM LEARNER_AUTH_RATE_LIMITS")) {
      const deleted = this.database.learnerAuthRateLimits
        .filter((record) => record.updatedAt < cutoff)
        .sort(
          (left, right) =>
            left.updatedAt - right.updatedAt ||
            left.bucketHash.localeCompare(right.bucketHash),
        )
        .slice(0, limit);
      const deletedIds = new Set(
        deleted.map((record) => record.bucketHash),
      );
      this.database.learnerAuthRateLimits =
        this.database.learnerAuthRateLimits.filter(
          (record) => !deletedIds.has(record.bucketHash),
        );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM SUPPORT_RATE_LIMITS")) {
      const deleted = this.database.supportRateLimits
        .filter((record) => record.updatedAt < cutoff)
        .sort(
          (left, right) =>
            left.updatedAt - right.updatedAt ||
            left.bucketHash.localeCompare(right.bucketHash),
        )
        .slice(0, limit);
      const deletedIds = new Set(
        deleted.map((record) => record.bucketHash),
      );
      this.database.supportRateLimits =
        this.database.supportRateLimits.filter(
          (record) => !deletedIds.has(record.bucketHash),
        );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM LEARNER_DELETION_JOBS")) {
      const deleted = this.database.deletionTombstones
        .filter((record) => record.completedAt < cutoff)
        .sort(
          (left, right) =>
            left.completedAt - right.completedAt ||
            left.userId.localeCompare(right.userId),
        )
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((record) => record.userId));
      this.database.deletionTombstones =
        this.database.deletionTombstones.filter(
          (record) => !deletedIds.has(record.userId),
        );
      return { meta: { changes: deleted.length } };
    }
    if (this.sql.startsWith("DELETE FROM SUPPORT_NOTIFICATION_JOBS")) {
      const supportIds = new Set(
        this.database.support.map((record) => record.id),
      );
      const deleted = this.database.notificationJobs
        .filter(
          (job) =>
            !supportIds.has(job.supportRequestId) ||
            (job.status === "completed" &&
              job.completedAt !== null &&
              job.completedAt < cutoff),
        )
        .sort(
          (left, right) =>
            (left.completedAt ?? left.updatedAt) -
              (right.completedAt ?? right.updatedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      const deletedIds = new Set(deleted.map((job) => job.id));
      this.database.notificationJobs = this.database.notificationJobs.filter(
        (job) => !deletedIds.has(job.id),
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
  it("uses the published content, operations, and login-attempt cutoffs", () => {
    const now = Date.UTC(2026, 6, 20, 3, 17);
    expect(retentionCutoffs(now)).toEqual({
      productEvents: now - PRODUCT_EVENT_RETENTION_DAYS * DAY_MS,
      operationalRecords: now - OPERATIONAL_RECORD_RETENTION_DAYS * DAY_MS,
      adminLoginAttempts: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS,
      authTransients: now - AUTH_TRANSIENT_RETENTION_MS,
      learnerAuthRateLimits:
        now - BETTER_AUTH_RATE_LIMIT_RETENTION_MS,
      supportRateLimits: now - SUPPORT_RATE_LIMIT_RETENTION_MS,
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
    database.adminAttempts = [
      {
        ipHash: "attempt-old",
        updatedAt: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS - 1,
      },
      {
        ipHash: "attempt-boundary",
        updatedAt: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS,
      },
    ];
    database.deletionTombstones = [
      {
        userId: "completed-old",
        completedAt: now - LEARNER_DELETION_TOMBSTONE_RETENTION_MS - 1,
      },
      {
        userId: "completed-boundary",
        completedAt: now - LEARNER_DELETION_TOMBSTONE_RETENTION_MS,
      },
    ];
    database.supportRateLimits = [
      {
        bucketHash: "support-rate-old",
        updatedAt: now - SUPPORT_RATE_LIMIT_RETENTION_MS - 1,
      },
      {
        bucketHash: "support-rate-boundary",
        updatedAt: now - SUPPORT_RATE_LIMIT_RETENTION_MS,
      },
    ];
    database.notificationJobs = [
      {
        id: "notification-completed-old",
        supportRequestId: "support-boundary",
        status: "completed",
        completedAt: now - 8 * DAY_MS,
        updatedAt: now - 8 * DAY_MS,
      },
      {
        id: "notification-orphan",
        supportRequestId: "support-missing",
        status: "failed",
        completedAt: null,
        updatedAt: now - DAY_MS,
      },
      {
        id: "notification-completed-current",
        supportRequestId: "support-boundary",
        status: "completed",
        completedAt: now - DAY_MS,
        updatedAt: now - DAY_MS,
      },
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
      adminLoginAttempts: 1,
      learnerSessions: 0,
      learnerVerifications: 0,
      learnerAuthRateLimits: 0,
      supportRateLimits: 1,
      learnerDeletionJobsCompleted: 0,
      learnerDeletionJobsHeld: 0,
      learnerDeletionJobsWaiting: 0,
      learnerDeletionStagesCancelled: 0,
      learnerDeletionTombstones: 1,
      supportNotificationJobsExamined: 0,
      supportNotificationJobsCompleted: 0,
      supportNotificationJobsFailed: 0,
      supportNotificationJobsDeleted: 2,
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
    expect(database.adminAttempts.map((record) => record.ipHash)).toEqual([
      "attempt-boundary",
    ]);
    expect(database.deletionTombstones.map((record) => record.userId)).toEqual([
      "completed-boundary",
    ]);
    expect(
      database.supportRateLimits.map((record) => record.bucketHash),
    ).toEqual(["support-rate-boundary"]);
    expect(database.notificationJobs.map((job) => job.id)).toEqual([
      "notification-completed-current",
    ]);
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
    database.adminAttempts = [
      {
        ipHash: "attempt-first",
        updatedAt: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS - 2,
      },
      {
        ipHash: "attempt-next",
        updatedAt: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS - 1,
      },
    ];
    database.learnerSessions = [
      { id: "web-session-first", expiresAt: now - 2 },
      { id: "web-session-next", expiresAt: now - 1 },
    ];
    database.learnerVerifications = [
      { id: "verification-first", expiresAt: now - 2 },
      { id: "verification-next", expiresAt: now - 1 },
    ];
    database.learnerAuthRateLimits = [
      {
        bucketHash: "rate-first",
        updatedAt: now - BETTER_AUTH_RATE_LIMIT_RETENTION_MS - 2,
      },
      {
        bucketHash: "rate-next",
        updatedAt: now - BETTER_AUTH_RATE_LIMIT_RETENTION_MS - 1,
      },
    ];
    database.supportRateLimits = [
      {
        bucketHash: "support-rate-first",
        updatedAt: now - SUPPORT_RATE_LIMIT_RETENTION_MS - 2,
      },
      {
        bucketHash: "support-rate-next",
        updatedAt: now - SUPPORT_RATE_LIMIT_RETENTION_MS - 1,
      },
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
      adminLoginAttempts: 1,
      learnerSessions: 1,
      learnerVerifications: 1,
      learnerAuthRateLimits: 1,
      supportRateLimits: 1,
      learnerDeletionJobsCompleted: 0,
      learnerDeletionJobsHeld: 0,
      learnerDeletionJobsWaiting: 0,
      learnerDeletionStagesCancelled: 0,
      learnerDeletionTombstones: 0,
      supportNotificationJobsExamined: 0,
      supportNotificationJobsCompleted: 0,
      supportNotificationJobsFailed: 0,
      supportNotificationJobsDeleted: 0,
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
    expect(database.adminAttempts.map((record) => record.ipHash)).toEqual([
      "attempt-next",
    ]);
    expect(database.learnerSessions.map((record) => record.id)).toEqual([
      "web-session-next",
    ]);
    expect(database.learnerVerifications.map((record) => record.id)).toEqual([
      "verification-next",
    ]);
    expect(
      database.learnerAuthRateLimits.map(
        (record) => record.bucketHash,
      ),
    ).toEqual(["rate-next"]);
    expect(
      database.supportRateLimits.map((record) => record.bucketHash),
    ).toEqual(["support-rate-next"]);
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

  it("persists scheduled start and success before reporting a healthy heartbeat", async () => {
    const scheduledAt = Date.UTC(2026, 6, 20, 3, 17);
    const startedAt = scheduledAt + 1_000;
    const completedAt = scheduledAt + 2_000;
    const times = [startedAt, completedAt];
    const database = new RetentionMemoryD1();

    const result = await runScheduledRetentionMaintenance(
      database as unknown as D1Database,
      scheduledAt,
      {
        runId: "scheduled-success",
        now: () => times.shift() ?? completedAt,
      },
    );

    expect(result).toMatchObject({
      runId: "scheduled-success",
      scheduledAt,
      startedAt,
      completedAt,
    });
    expect(database.schedule).toMatchObject({
      status: "succeeded",
      run_id: "scheduled-success",
      scheduled_at: scheduledAt,
      started_at: startedAt,
      completed_at: completedAt,
      last_succeeded_at: completedAt,
      last_error: null,
    });
    await expect(
      readScheduledRetentionStatus(
        database as unknown as D1Database,
        completedAt,
      ),
    ).resolves.toMatchObject({
      health: "ready",
      healthy: true,
      missed: false,
      lastResult: {
        productEvents: 0,
        supportRequests: 0,
        auditEvents: 0,
        nativeSessions: 0,
        nativeIdentityTokens: 0,
        adminLoginAttempts: 0,
        learnerSessions: 0,
        learnerVerifications: 0,
        learnerAuthRateLimits: 0,
        supportRateLimits: 0,
        learnerDeletionJobsCompleted: 0,
        learnerDeletionJobsHeld: 0,
        learnerDeletionJobsWaiting: 0,
        learnerDeletionStagesCancelled: 0,
        learnerDeletionTombstones: 0,
        supportNotificationJobsExamined: 0,
        supportNotificationJobsCompleted: 0,
        supportNotificationJobsFailed: 0,
        supportNotificationJobsDeleted: 0,
      },
    });
  });

  it("drains multiple bounded retention pages in one scheduled run", async () => {
    const scheduledAt = Date.UTC(2026, 6, 20, 3, 17);
    const startedAt = scheduledAt + 1_000;
    const completedAt = scheduledAt + 2_000;
    const times = [startedAt, completedAt];
    const database = new RetentionMemoryD1();
    database.events = Array.from({ length: 5 }, (_, index) => ({
      id: `event-${index}`,
      userKey: "user-a",
      receivedAt:
        scheduledAt - (PRODUCT_EVENT_RETENTION_DAYS + 1) * DAY_MS - index,
    }));

    const result = await runScheduledRetentionMaintenance(
      database as unknown as D1Database,
      scheduledAt,
      {
        runId: "scheduled-multipage",
        batchLimit: 2,
        maxPages: 10,
        now: () => times.shift() ?? completedAt,
      },
    );

    expect(result.pagesProcessed).toBe(3);
    expect(result.deleted.productEvents).toBe(5);
    expect(database.events).toEqual([]);
    expect(database.schedule?.status).toBe("succeeded");
  });

  it("fails its heartbeat instead of hiding work beyond the scheduled cap", async () => {
    const scheduledAt = Date.UTC(2026, 6, 20, 3, 17);
    const startedAt = scheduledAt + 1_000;
    const failedAt = scheduledAt + 2_000;
    const times = [startedAt, failedAt];
    const database = new RetentionMemoryD1();
    database.events = Array.from({ length: 5 }, (_, index) => ({
      id: `event-${index}`,
      userKey: "user-a",
      receivedAt:
        scheduledAt - (PRODUCT_EVENT_RETENTION_DAYS + 1) * DAY_MS - index,
    }));

    await expect(
      runScheduledRetentionMaintenance(
        database as unknown as D1Database,
        scheduledAt,
        {
          runId: "scheduled-cap",
          batchLimit: 2,
          maxPages: 2,
          now: () => times.shift() ?? failedAt,
        },
      ),
    ).rejects.toThrow("work cap");

    expect(database.events).toHaveLength(1);
    expect(database.schedule).toMatchObject({
      status: "failed",
      run_id: "scheduled-cap",
      last_error: expect.stringContaining("work cap"),
    });
    expect(JSON.parse(database.schedule?.last_result ?? "{}")).toMatchObject({
      productEvents: 4,
    });
  });

  it("reports success when an exact final page leaves no backlog", async () => {
    const scheduledAt = Date.UTC(2026, 6, 20, 3, 17);
    const startedAt = scheduledAt + 1_000;
    const completedAt = scheduledAt + 2_000;
    const times = [startedAt, completedAt];
    const database = new RetentionMemoryD1();
    database.events = Array.from({ length: 4 }, (_, index) => ({
      id: `event-${index}`,
      userKey: "user-a",
      receivedAt:
        scheduledAt - (PRODUCT_EVENT_RETENTION_DAYS + 1) * DAY_MS - index,
    }));

    const result = await runScheduledRetentionMaintenance(
      database as unknown as D1Database,
      scheduledAt,
      {
        runId: "scheduled-exact-cap",
        batchLimit: 2,
        maxPages: 2,
        now: () => times.shift() ?? completedAt,
      },
    );

    expect(result.pagesProcessed).toBe(2);
    expect(result.deleted.productEvents).toBe(4);
    expect(database.events).toEqual([]);
    expect(database.schedule?.status).toBe("succeeded");
  });

  it("persists scheduled failure and exposes missed runs", async () => {
    const scheduledAt = Date.UTC(2026, 6, 20, 3, 17);
    const startedAt = scheduledAt + 1_000;
    const failedAt = scheduledAt + 2_000;
    const times = [startedAt, failedAt];
    const database = new RetentionMemoryD1();
    database.failNextDelete = true;

    await expect(
      runScheduledRetentionMaintenance(
        database as unknown as D1Database,
        scheduledAt,
        {
          runId: "scheduled-failure",
          now: () => times.shift() ?? failedAt,
        },
      ),
    ).rejects.toThrow("simulated scheduled cleanup failure");
    await expect(
      readScheduledRetentionStatus(
        database as unknown as D1Database,
        failedAt,
      ),
    ).resolves.toMatchObject({
      health: "failed",
      healthy: false,
      lastFailedAt: new Date(failedAt).toISOString(),
      lastError: "simulated scheduled cleanup failure",
    });

    database.schedule = {
      status: "pending",
      monitoring_started_at: scheduledAt,
      run_id: null,
      scheduled_at: null,
      started_at: null,
      completed_at: null,
      last_succeeded_at: null,
      last_failed_at: null,
      last_error: null,
      last_result: null,
      updated_at: scheduledAt,
    };
    await expect(
      readScheduledRetentionStatus(
        database as unknown as D1Database,
        scheduledAt + RETENTION_SCHEDULE_MISSED_AFTER_MS - 1,
      ),
    ).resolves.toMatchObject({
      health: "pending",
      healthy: true,
      missed: false,
    });
    await expect(
      readScheduledRetentionStatus(
        database as unknown as D1Database,
        scheduledAt + RETENTION_SCHEDULE_MISSED_AFTER_MS + 1,
      ),
    ).resolves.toMatchObject({
      health: "missed",
      healthy: false,
      missed: true,
    });

    database.schedule = {
      ...database.schedule,
      status: "running",
      run_id: "stalled-run",
      scheduled_at: scheduledAt,
      started_at: scheduledAt,
      updated_at: scheduledAt,
    };
    await expect(
      readScheduledRetentionStatus(
        database as unknown as D1Database,
        scheduledAt + RETENTION_RUN_STALE_AFTER_MS + 1,
      ),
    ).resolves.toMatchObject({
      health: "stalled",
      healthy: false,
      missed: false,
    });
  });
});
