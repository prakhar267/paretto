import { beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "../app/api/admin/operations/route";
import { createAdminTestAuth } from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class OperationsMemoryD1 {
  actions: Array<{ action: string; runId: string; details: Record<string, unknown> }> = [];
  failRetention = false;
  scheduledAt = Date.now() - 60_000;

  prepare(sql: string) {
    return new OperationsStatement(this, sql);
  }

  async batch(statements: OperationsStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class OperationsStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: OperationsMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.startsWith("SELECT (SELECT COUNT(*) FROM CMS_CONTENT")) {
      return {
        published_content: 12,
        draft_content: 3,
        open_support: 2,
        expired_events: 4,
        expired_support: 5,
        expired_audits: 6,
        expired_admin_login_attempts: 7,
        expired_learner_sessions: 8,
        expired_learner_verifications: 9,
        expired_learner_auth_rate_limits: 10,
        expired_support_rate_limits: 11,
        active_holds: 1,
        pending_deletion_jobs: 2,
        held_deletion_jobs: 1,
        deletion_jobs_with_errors: 1,
        oldest_deletion_job_updated_at: this.database.scheduledAt - 10_000,
        pending_support_notification_jobs: 4,
        failed_support_notification_jobs: 2,
        oldest_support_notification_job_created_at:
          this.database.scheduledAt - 20_000,
      } as T;
    }
    if (
      this.sql.startsWith(
        "SELECT STATUS, MONITORING_STARTED_AT",
      )
    ) {
      return {
        status: "succeeded",
        monitoring_started_at: this.database.scheduledAt - 86_400_000,
        run_id: "scheduled-run",
        scheduled_at: this.database.scheduledAt,
        started_at: this.database.scheduledAt + 1_000,
        completed_at: this.database.scheduledAt + 2_000,
        last_succeeded_at: this.database.scheduledAt + 2_000,
        last_failed_at: null,
        last_error: null,
        last_result: JSON.stringify({
          productEvents: 1,
          supportRequests: 0,
          auditEvents: 0,
          nativeSessions: 0,
          nativeIdentityTokens: 0,
          adminLoginAttempts: 2,
          learnerSessions: 3,
          learnerVerifications: 4,
          learnerAuthRateLimits: 5,
          supportRateLimits: 6,
          learnerDeletionJobsCompleted: 0,
          learnerDeletionJobsHeld: 0,
          learnerDeletionJobsWaiting: 0,
          learnerDeletionStagesCancelled: 0,
          learnerDeletionTombstones: 0,
          supportNotificationJobsExamined: 0,
          supportNotificationJobsCompleted: 0,
          supportNotificationJobsFailed: 0,
          supportNotificationJobsDeleted: 0,
        }),
        updated_at: this.database.scheduledAt + 2_000,
      } as T;
    }
    throw new Error(`Unexpected operation first SQL: ${this.sql}`);
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
    throw new Error(`Unexpected operation all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO ADMIN_AUDIT_LOG")) {
      const action = [
        "RETENTION_RUN_STARTED",
        "RETENTION_RUN_COMPLETED",
        "RETENTION_RUN_FAILED",
      ].find((candidate) => this.sql.includes(`'${candidate}'`));
      if (!action) throw new Error("Unexpected operation audit action");
      this.database.actions.push({
        action,
        runId: String(this.values[0]),
        details: JSON.parse(String(this.values[2])) as Record<string, unknown>,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM")) {
      if (this.database.failRetention) {
        this.database.failRetention = false;
        throw new Error("simulated retention failure");
      }
      return { meta: { changes: 0 } };
    }
    throw new Error(`Unexpected operation SQL: ${this.sql}`);
  }
}

const EMAIL = "admin@paretto.test";
let adminCookie = "";

function retentionRequest(batchLimit?: number) {
  return new Request("https://paretto.test/api/admin/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminCookie,
    },
    body: JSON.stringify({
      confirm: "delete-expired-records",
      ...(batchLimit === undefined ? {} : { batchLimit }),
    }),
  });
}

describe("manual retention operations", () => {
  let database: OperationsMemoryD1;

  beforeEach(async () => {
    database = new OperationsMemoryD1();
    const adminAuth = await createAdminTestAuth([EMAIL]);
    adminCookie = adminAuth.cookies.get(EMAIL)!;
    setCloudflareEnv({ DB: database, ...adminAuth.bindings });
  });

  it("audits both the start and successful completion with one run ID", async () => {
    const response = await POST(retentionRequest(25));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runId: string };
    expect(database.actions.map((entry) => entry.action)).toEqual([
      "RETENTION_RUN_STARTED",
      "RETENTION_RUN_COMPLETED",
    ]);
    expect(new Set(database.actions.map((entry) => entry.runId))).toEqual(
      new Set([body.runId]),
    );
    expect(database.actions[0].details).toEqual({ batchLimit: 25 });
    expect(database.actions[1].details).toMatchObject({
      batchLimit: 25,
      deleted: {
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

  it("leaves an audited failure trail when deletion cannot complete", async () => {
    database.failRetention = true;
    const response = await POST(retentionRequest());
    expect(response.status).toBe(503);
    expect(database.actions.map((entry) => entry.action)).toEqual([
      "RETENTION_RUN_STARTED",
      "RETENTION_RUN_FAILED",
    ]);
    expect(database.actions[1].details).toMatchObject({
      batchLimit: 500,
      deletionCompleted: false,
    });
  });

  it("rejects an unbounded run before writing an audit event", async () => {
    const response = await POST(retentionRequest(1_001));
    expect(response.status).toBe(400);
    expect(database.actions).toEqual([]);
  });

  it("reports scheduled heartbeat health and bounded login-attempt backlog", async () => {
    const response = await GET(
      new Request("https://paretto.test/api/admin/operations", {
        headers: { cookie: adminCookie },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      retentionDue: {
        productEvents: 4,
        supportRequests: 5,
        auditEvents: 6,
        adminLoginAttempts: 7,
        learnerSessions: 8,
        learnerVerifications: 9,
        learnerAuthRateLimits: 10,
        supportRateLimits: 11,
      },
      adminLoginAttemptRetentionHours: 24,
      accountDeletionQueue: {
        pending: 2,
        held: 1,
        withErrors: 1,
        oldestUpdatedAt: new Date(database.scheduledAt - 10_000).toISOString(),
      },
      supportNotificationQueue: {
        pending: 4,
        failed: 2,
        oldestCreatedAt: new Date(
          database.scheduledAt - 20_000,
        ).toISOString(),
      },
      scheduledRetention: {
        health: "ready",
        healthy: true,
        missed: false,
        persistedStatus: "succeeded",
        runId: "scheduled-run",
        lastResult: {
          productEvents: 1,
          adminLoginAttempts: 2,
          learnerSessions: 3,
          learnerVerifications: 4,
          learnerAuthRateLimits: 5,
          supportRateLimits: 6,
        },
      },
    });
  });
});
