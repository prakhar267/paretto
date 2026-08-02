import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PUT } from "../app/api/progress/route";
import { GET as HEALTH_GET } from "../app/api/health/route";
import { resolveRequestIdentity } from "../app/server-auth";
import { createInitialState, STATE_VERSION } from "../app/learning-engine";
import {
  createAdminTestAuth,
  learnerCookieHeaders,
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const PASSWORD_PEPPER_KEYRING = JSON.stringify({
  current: "test-v1",
  keys: {
    "test-v1":
      "qa-only-password-pepper-with-at-least-thirty-two-characters",
  },
});

type Row = { payload: string; revision: number; updated_at: number };
type ProgressResponse = {
  revision: number;
  generation?: number;
  state?: Record<string, unknown>;
  code?: string;
};
type RetentionScheduleFixture = {
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
};

const HEALTH_SCHEMA_COLUMNS: Record<string, string[]> = {
  learning_state: ["user_key", "revision", "payload", "updated_at"],
  learner_progress_generations: ["user_key", "generation", "updated_at"],
  learner_user: [
    "id",
    "name",
    "email",
    "email_verified",
    "image",
    "created_at",
    "updated_at",
    "username",
    "display_username",
  ],
  learner_session: [
    "id",
    "expires_at",
    "token",
    "created_at",
    "updated_at",
    "ip_address",
    "user_agent",
    "user_id",
  ],
  learner_account: [
    "id",
    "account_id",
    "provider_id",
    "user_id",
    "access_token",
    "refresh_token",
    "id_token",
    "access_token_expires_at",
    "refresh_token_expires_at",
    "scope",
    "password",
    "created_at",
    "updated_at",
  ],
  learner_verification: [
    "id",
    "identifier",
    "value",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  learner_auth_rate_limits: [
    "bucket_hash",
    "request_count",
    "last_request_at",
    "updated_at",
  ],
  learner_recovery_codes: [
    "code_hash",
    "user_id",
    "generation_id",
    "created_at",
  ],
  learner_recovery_state: ["user_id", "generation_id", "updated_at"],
  learner_identity_links: ["anonymous_user_key", "account_id", "linked_at"],
  admin_login_attempts: [
    "ip_hash",
    "window_started_at",
    "failed_attempts",
    "blocked_until",
    "updated_at",
  ],
  cms_content: [
    "id",
    "course_id",
    "kind",
    "slug",
    "stable_key",
    "title",
    "content",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "published_at",
    "review_status",
    "reviewed_by_email",
    "reviewed_at",
    "approved_revision",
    "created_by_email",
    "updated_by_email",
  ],
  cms_vocabulary_aliases: [
    "course_id",
    "alias",
    "content_id",
    "stable_key",
    "created_at",
  ],
  cms_slug_tombstones: [
    "course_id",
    "kind",
    "slug",
    "stable_key",
    "content_id",
    "retired_at",
    "retired_by_email",
  ],
  cms_content_revisions: [
    "course_id",
    "content_id",
    "revision",
    "kind",
    "slug",
    "stable_key",
    "title",
    "content",
    "status",
    "published_at",
    "actor_email",
    "action",
    "created_at",
  ],
  support_requests: [
    "id",
    "user_key",
    "reply_email",
    "category",
    "subject",
    "body",
    "status",
    "revision",
    "created_at",
    "updated_at",
  ],
  support_rate_limits: [
    "bucket_hash",
    "window_started_at",
    "request_count",
    "last_reservation_id",
    "updated_at",
  ],
  support_notification_jobs: [
    "id",
    "support_request_id",
    "event_type",
    "support_revision",
    "support_status",
    "recipient_email",
    "status",
    "attempts",
    "available_at",
    "lease_expires_at",
    "last_error",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  admin_audit_log: [
    "id",
    "entity_type",
    "entity_id",
    "actor_email",
    "action",
    "from_revision",
    "to_revision",
    "details",
    "created_at",
  ],
  product_events: [
    "id",
    "user_key",
    "session_id",
    "event_name",
    "properties",
    "occurred_at",
    "received_at",
  ],
  native_accounts: [
    "id",
    "apple_subject_hash",
    "email",
    "email_forwarding_enabled",
    "display_name",
    "created_at",
    "updated_at",
  ],
  apple_account_notifications: [
    "id",
    "event_type",
    "apple_subject_hash",
    "event_time",
    "status",
    "received_at",
    "processed_at",
  ],
  native_learner_links: ["native_account_id", "learner_user_id", "linked_at"],
  native_sessions: [
    "token_hash",
    "id",
    "account_id",
    "expires_at",
    "created_at",
    "revoked_at",
  ],
  native_learning_state: [
    "account_id",
    "revision",
    "reset_generation",
    "payload",
    "updated_at",
  ],
  native_apple_credentials: [
    "account_id",
    "refresh_token_ciphertext",
    "updated_at",
  ],
  native_identity_token_uses: [
    "token_hash",
    "exchange_id",
    "expires_at",
    "used_at",
  ],
  learner_deletion_jobs: [
    "user_id",
    "user_key",
    "native_account_id",
    "status",
    "requested_at",
    "completed_at",
    "attempts",
    "last_error",
    "updated_at",
  ],
  retention_legal_holds: [
    "id",
    "data_class",
    "record_key",
    "reason",
    "status",
    "created_by_email",
    "created_at",
    "released_by_email",
    "released_at",
  ],
  retention_schedule_state: [
    "job_name",
    "status",
    "monitoring_started_at",
    "run_id",
    "scheduled_at",
    "started_at",
    "completed_at",
    "last_succeeded_at",
    "last_failed_at",
    "last_error",
    "last_result",
    "updated_at",
  ],
};

async function progressJson(response: Response) {
  return response.json() as Promise<ProgressResponse>;
}

class MemoryD1 {
  rows = new Map<string, Row>();
  generations = new Map<string, number>();
  aliases = new Map<string, string>();
  linkedAnonymousKeys = new Set<string>();
  schemaComplete = true;
  deletionQueue = {
    pending: 0,
    held: 0,
    with_errors: 0,
    oldest_pending_at: null as number | null,
  };
  supportQueue = {
    open_jobs: 0,
    failed_jobs: 0,
    oldest_open_at: null as number | null,
  };
  retentionSchedule: RetentionScheduleFixture = {
    status: "succeeded",
    monitoring_started_at: Date.now() - 86_400_000,
    run_id: "health-run",
    scheduled_at: Date.now() - 60_000,
    started_at: Date.now() - 59_000,
    completed_at: Date.now() - 58_000,
    last_succeeded_at: Date.now() - 58_000,
    last_failed_at: null,
    last_error: null,
    last_result: JSON.stringify({
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
    }),
    updated_at: Date.now() - 58_000,
  };

  prepare(sql: string) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements: MemoryStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class MemoryStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: MemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.startsWith("SELECT 1 AS OK")) return { ok: 1 } as T;
    if (this.sql.startsWith("SELECT STATUS, MONITORING_STARTED_AT")) {
      return this.database.retentionSchedule as T;
    }
    if (this.sql.includes("FROM LEARNER_DELETION_JOBS AS JOBS")) {
      return this.database.deletionQueue as T;
    }
    if (this.sql.includes("FROM SUPPORT_NOTIFICATION_JOBS AS JOBS")) {
      return this.database.supportQueue as T;
    }
    if (this.sql.startsWith("SELECT PAYLOAD, REVISION, UPDATED_AT")) {
      return (this.database.rows.get(String(this.values[0])) ??
        null) as T | null;
    }
    if (this.sql.startsWith("SELECT STATE.PAYLOAD, STATE.REVISION")) {
      const userKey = String(this.values[0]);
      const row = this.database.rows.get(userKey);
      return {
        payload: row?.payload ?? null,
        revision: row?.revision ?? null,
        updated_at: row?.updated_at ?? null,
        generation: this.database.generations.get(userKey) ?? 0,
      } as T;
    }
    throw new Error(`Unexpected first() SQL: ${this.sql}`);
  }

  async all<T>() {
    if (
      this.sql.startsWith(
        "SELECT ALIAS, STABLE_KEY FROM CMS_VOCABULARY_ALIASES",
      )
    ) {
      const requested = new Set(this.values.map(String));
      return {
        results: [...this.database.aliases.entries()]
          .filter(([alias]) => requested.has(alias))
          .map(([alias, stable_key]) => ({ alias, stable_key })) as T[],
        success: true,
        meta: {},
      };
    }
    if (this.sql.startsWith("PRAGMA TABLE_INFO")) {
      const tableName = this.sql
        .match(/PRAGMA TABLE_INFO\("([^"]+)"\)/)?.[1]
        .toLowerCase();
      const columns = tableName
        ? [...(HEALTH_SCHEMA_COLUMNS[tableName] ?? [])]
        : [];
      if (!this.database.schemaComplete && tableName === "product_events") {
        columns.splice(columns.indexOf("received_at"), 1);
      }
      return {
        results: columns.map((name) => ({ name })) as T[],
        success: true,
        meta: {},
      };
    }
    if (
      this.sql.startsWith("SELECT NAME FROM SQLITE_MASTER WHERE TYPE = 'INDEX'")
    ) {
      const names = this.database.schemaComplete
        ? this.values.map(String)
        : this.values.map(String).slice(0, -1);
      return {
        results: names.map((name) => ({ name })) as T[],
        success: true,
        meta: {},
      };
    }
    throw new Error(`Unexpected all() SQL: ${this.sql}`);
  }

  async run() {
    if (
      this.sql.startsWith("CREATE TABLE IF NOT EXISTS") ||
      this.sql.startsWith("CREATE INDEX IF NOT EXISTS") ||
      this.sql.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS") ||
      this.sql.startsWith("DROP TABLE IF EXISTS")
    ) {
      return { meta: { changes: 0 } };
    }
    if (this.sql.startsWith("INSERT OR IGNORE")) {
      const [rawUserKey, rawPayload, rawUpdatedAt] = this.values;
      const userKey = String(rawUserKey);
      const submittedGeneration = Number(this.values.at(-1));
      if (
        this.sql.includes("LEARNER_PROGRESS_GENERATIONS") &&
        (this.database.generations.get(userKey) ?? 0) !== submittedGeneration
      ) {
        return { meta: { changes: 0 } };
      }
      if (
        this.sql.includes("LEARNER_IDENTITY_LINKS") &&
        this.database.linkedAnonymousKeys.has(String(this.values[3]))
      ) {
        return { meta: { changes: 0 } };
      }
      if (this.database.rows.has(userKey)) return { meta: { changes: 0 } };
      this.database.rows.set(userKey, {
        payload: String(rawPayload),
        revision: 1,
        updated_at: Number(rawUpdatedAt),
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE LEARNING_STATE")) {
      const [rawPayload, rawUpdatedAt, rawUserKey, rawRevision] = this.values;
      const userKey = String(rawUserKey);
      const submittedGeneration = Number(this.values.at(-1));
      if (
        this.sql.includes("LEARNER_PROGRESS_GENERATIONS") &&
        (this.database.generations.get(userKey) ?? 0) !== submittedGeneration
      ) {
        return { meta: { changes: 0 } };
      }
      if (
        this.sql.includes("LEARNER_IDENTITY_LINKS") &&
        this.database.linkedAnonymousKeys.has(String(this.values[4]))
      ) {
        return { meta: { changes: 0 } };
      }
      const existing = this.database.rows.get(userKey);
      if (!existing || existing.revision !== Number(rawRevision)) {
        return { meta: { changes: 0 } };
      }
      this.database.rows.set(userKey, {
        payload: String(rawPayload),
        revision: existing.revision + 1,
        updated_at: Number(rawUpdatedAt),
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM LEARNING_STATE")) {
      return {
        meta: {
          changes: this.database.rows.delete(String(this.values[0])) ? 1 : 0,
        },
      };
    }

    if (this.sql.startsWith("INSERT INTO LEARNER_PROGRESS_GENERATIONS")) {
      const userKey = String(this.values[0]);
      this.database.generations.set(
        userKey,
        (this.database.generations.get(userKey) ?? 0) + 1,
      );
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unexpected run() SQL: ${this.sql}`);
  }
}

const authenticatedHeaders = learnerCookieHeaders();

function request(init: RequestInit = {}) {
  return new Request("https://paretto.test/api/progress", init);
}

describe("progress API", () => {
  let database: MemoryD1;
  let progressStorageKey: string;

  function progressHeaders() {
    return {
      ...authenticatedHeaders,
      "x-paretto-progress-cache": progressStorageKey,
    };
  }

  beforeEach(async () => {
    database = new MemoryD1();
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "qa-only-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET:
        "qa-only-better-auth-rate-limit-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_SECRET:
        "qa-only-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://paretto.test",
      RESEND_API_KEY: "re_qa_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "support@paretto.test",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      LAUNCH_MODE: "public",
      WORKERS_PLAN: "paid",
      NATIVE_API_ENABLED: "false",
    });
    const identity = await resolveRequestIdentity(
      request({ headers: authenticatedHeaders }),
    );
    if (!identity.ok) throw new Error("Expected an anonymous test identity.");
    progressStorageKey = identity.progressStorageKey;
  });

  it("reconciles historical slug progress into the immutable vocabulary ID", async () => {
    database.aliases.set("renamed-card", "original-card");
    const initial = await progressJson(
      await GET(request({ headers: progressHeaders() })),
    );
    const progress = {
      stage: 2,
      seen: 4,
      correct: 3,
      incorrect: 1,
      nextReviewAt: "2026-07-22T00:00:00.000Z",
      lastReviewedAt: "2026-07-21T00:00:00.000Z",
    };
    const saved = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey,
          state: {
            ...initial.state,
            wordProgress: { "cms-renamed-card": progress },
          },
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const state = (await progressJson(saved)).state as {
      wordProgress: Record<string, unknown>;
    };
    expect(state.wordProgress).toEqual({ "cms-original-card": progress });
  });

  it("rejects a stale tab whose cache identity no longer matches the authenticated browser", async () => {
    const staleStorageKey = "paretto-progress-v2:account:" + "b".repeat(64);
    const staleRead = await GET(
      request({
        headers: {
          ...authenticatedHeaders,
          "x-paretto-progress-cache": staleStorageKey,
        },
      }),
    );
    expect(staleRead.status).toBe(409);
    expect(await staleRead.json()).toMatchObject({
      code: "IDENTITY_CHANGED",
    });

    const response = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey: staleStorageKey,
          state: createInitialState(),
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_CHANGED",
    });
    expect(database.rows.size).toBe(0);
  });

  it("enforces identity, revisions, sanitization, and deletion", async () => {
    expect((await GET(request())).status).toBe(401);

    const initial = await GET(request({ headers: progressHeaders() }));
    expect(initial.status).toBe(200);
    expect((await progressJson(initial)).revision).toBe(0);

    const invalidJson = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );
    expect(invalidJson.status).toBe(400);

    const retiredClient = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey,
          state: { version: 1 },
        }),
      }),
    );
    expect(retiredClient.status).toBe(400);

    const saved = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey,
          state: {
            version: STATE_VERSION,
            onboarded: true,
            displayName: "  Camille  ",
            currentRegionId: "not-a-region",
            unlockedRegionIds: ["not-a-region"],
            wordProgress: { unknown: null },
            sessions: [{ broken: true }],
          },
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const savedBody = await progressJson(saved);
    expect(savedBody).toMatchObject({
      revision: 1,
      state: {
        displayName: "Camille",
        currentRegionId: "ile-de-france",
        wordProgress: {},
        sessions: [],
      },
    });

    const staleWrite = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey,
          state: savedBody.state,
        }),
      }),
    );
    expect(staleWrite.status).toBe(409);
    expect((await progressJson(staleWrite)).code).toBe("REVISION_CONFLICT");

    const readBack = await GET(request({ headers: progressHeaders() }));
    expect(readBack.status).toBe(200);
    expect((await progressJson(readBack)).revision).toBe(1);

    const deleted = await DELETE(
      request({
        method: "DELETE",
        headers: {
          ...progressHeaders(),
        },
      }),
    );
    expect(deleted.status).toBe(200);
    expect((await progressJson(deleted)).revision).toBe(0);

    const afterDelete = await GET(request({ headers: progressHeaders() }));
    expect(afterDelete.status).toBe(200);
    const resetBody = await progressJson(afterDelete);
    expect(resetBody.revision).toBe(0);
    expect(resetBody.generation).toBe(1);

    const staleGeneration = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          generation: 0,
          progressStorageKey,
          state: savedBody.state,
        }),
      }),
    );
    expect(staleGeneration.status).toBe(409);
    expect(await staleGeneration.json()).toMatchObject({
      code: "GENERATION_CONFLICT",
      generation: 1,
    });
    expect(database.rows.size).toBe(0);

    const currentGeneration = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          generation: 1,
          progressStorageKey,
          state: savedBody.state,
        }),
      }),
    );
    expect(currentGeneration.status).toBe(200);
    expect(await currentGeneration.json()).toMatchObject({
      revision: 1,
      generation: 1,
    });
  });

  it("fails closed without overwriting malformed canonical progress", async () => {
    const identity = await resolveRequestIdentity(
      request({ headers: authenticatedHeaders }),
    );
    if (!identity.ok) throw new Error("Expected a learner identity.");
    const malformed = {
      payload: "{",
      revision: 7,
      updated_at: Date.now(),
    };
    database.rows.set(identity.userKey, malformed);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET(request({ headers: progressHeaders() }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Progress is temporarily unavailable.",
    });
    expect(database.rows.get(identity.userKey)).toEqual(malformed);
    consoleError.mockRestore();
  });

  it("rejects anonymous writes after that browser identity is reserved for an account claim", async () => {
    const initial = await progressJson(
      await GET(request({ headers: progressHeaders() })),
    );
    const first = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          progressStorageKey,
          state: {
            ...initial.state,
            displayName: "Pending anonymous learner",
            xp: 15,
          },
        }),
      }),
    );
    expect(first.status).toBe(200);
    const [anonymousKey] = database.rows.keys();
    database.linkedAnonymousKeys.add(anonymousKey);

    const blocked = await PUT(
      request({
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 1,
          progressStorageKey,
          state: {
            ...(await progressJson(first)).state,
            xp: 99,
          },
        }),
      }),
    );

    expect(blocked.status).toBe(409);
    expect(JSON.parse(database.rows.get(anonymousKey)!.payload)).toMatchObject({
      xp: 15,
    });
  });

  it("verifies D1 readiness through the health endpoint", async () => {
    const response = await HEALTH_GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      launchMode: "public",
      workersPlan: "paid",
      productionReady: true,
      schemaRevision: "0014",
      database: "ready",
      checks: {
        workersPlan: "paid",
        database: "ready",
        schema: "ready",
        retentionSchedule: "ready",
        accountDeletionQueue: "ready",
        supportNotificationQueue: "ready",
        userKeySecret: "ready",
        supportRateLimitSecret: "ready",
        learnerAuthRateLimitSecret: "ready",
        learnerAuthentication: "ready",
        learnerParettoIdAccountCreation: "ready",
        learnerParettoIdSignIn: "ready",
        learnerRecoveryCodes: "ready",
        learnerPasswordReset: "ready",
        learnerGoogleAuth: "optional-not-configured",
        learnerAppleAuth: "optional-not-configured",
        supportNotifications: "ready",
        adminAllowlist: "ready",
        adminAuthentication: "ready",
        turnstileSiteKey: "ready",
        turnstileSecret: "ready",
        nativeApi: "disabled",
        appleClientId: "native-disabled",
        appleServerCredentials: "native-disabled",
        appleTokenEncryptionSecret: "native-disabled",
        nativeSessionSecret: "native-disabled",
      },
      retentionSchedule: {
        status: "ready",
        missed: false,
      },
      queues: {
        accountDeletion: {
          status: "ready",
          pending: 0,
          held: 0,
          withErrors: 0,
        },
        supportNotifications: {
          status: "ready",
          open: 0,
          failed: 0,
        },
      },
    });
  });

  it("treats Paretto ID recovery as launch-ready without optional email delivery", async () => {
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    const publicBindings = {
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "qa-only-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET:
        "qa-only-better-auth-rate-limit-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_SECRET:
        "qa-only-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://paretto.test",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      LAUNCH_MODE: "public",
      WORKERS_PLAN: "paid",
      NATIVE_API_ENABLED: "false",
    };
    setCloudflareEnv(publicBindings);

    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await HEALTH_GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "ok",
        launchMode: "public",
        workersPlan: "paid",
        webReady: true,
        productionReady: true,
        warnings: [
          "Optional transactional email is not configured; Paretto ID account creation and recovery codes remain available.",
          "Operator support email delivery is not configured; tickets remain stored for authenticated administrator follow-up.",
        ],
        checks: {
          workersPlan: "paid",
          learnerParettoIdAccountCreation: "ready",
          learnerParettoIdSignIn: "ready",
          learnerRecoveryCodes: "ready",
          learnerEmailAccountCreation: "disabled",
          learnerEmailVerification: "not-configured",
          learnerPasswordReset: "not-configured",
          supportNotifications: "not-configured",
        },
      });

      setCloudflareEnv({
        ...publicBindings,
        WORKERS_PLAN: "free",
      });
      const freePlan = await HEALTH_GET();
      expect(freePlan.status).toBe(503);
      expect(await freePlan.json()).toMatchObject({
        status: "degraded",
        launchMode: "public",
        workersPlan: "free",
        productionReady: false,
        warnings: expect.arrayContaining([
          "Public Paretto ID launch requires Workers Paid for the password-security CPU workload.",
        ]),
        checks: {
          workersPlan: "free-controlled-beta-only",
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serves a healthy controlled beta without claiming public readiness", async () => {
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    const controlledBetaBindings = {
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "qa-only-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET:
        "qa-only-better-auth-rate-limit-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_SECRET:
        "qa-only-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://paretto.test",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      LAUNCH_MODE: "controlled-beta",
      WORKERS_PLAN: "free",
      NATIVE_API_ENABLED: "false",
    };
    setCloudflareEnv(controlledBetaBindings);

    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await HEALTH_GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "ok",
        launchMode: "controlled-beta",
        workersPlan: "free",
        webReady: true,
        productionReady: false,
        database: "ready",
        warnings: [
          "Controlled beta mode is operational but is not approved for a broad public launch.",
          "Optional transactional email is not configured; Paretto ID account creation and recovery codes remain available.",
          "Operator support email delivery is not configured; tickets remain stored for authenticated administrator follow-up.",
        ],
        checks: {
          workersPlan: "free-controlled-beta-only",
          database: "ready",
          schema: "ready",
          retentionSchedule: "ready",
          accountDeletionQueue: "ready",
          supportNotificationQueue: "ready",
          learnerAuthentication: "ready",
          learnerParettoIdAccountCreation: "ready",
          learnerParettoIdSignIn: "ready",
          learnerRecoveryCodes: "ready",
          learnerEmailAccountCreation: "disabled",
          learnerEmailVerification: "not-configured",
          learnerPasswordReset: "not-configured",
          supportNotifications: "not-configured",
        },
      });

      setCloudflareEnv({
        ...controlledBetaBindings,
        WORKERS_PLAN: "paid",
      });
      const paidPlan = await HEALTH_GET();
      expect(paidPlan.status).toBe(200);
      expect(await paidPlan.json()).toMatchObject({
        status: "ok",
        launchMode: "controlled-beta",
        workersPlan: "paid",
        productionReady: false,
        checks: {
          workersPlan: "paid",
        },
      });

      setCloudflareEnv({
        ...controlledBetaBindings,
        WORKERS_PLAN: "invalid",
      });
      const invalidPlan = await HEALTH_GET();
      expect(invalidPlan.status).toBe(503);
      expect(await invalidPlan.json()).toMatchObject({
        status: "degraded",
        launchMode: "controlled-beta",
        workersPlan: null,
        productionReady: false,
        warnings: expect.arrayContaining([
          "WORKERS_PLAN is missing or invalid.",
        ]),
        checks: {
          workersPlan: "misconfigured",
        },
      });

      setCloudflareEnv(controlledBetaBindings);
      database.supportQueue = {
        open_jobs: 1,
        failed_jobs: 1,
        oldest_open_at: Date.now() - 5 * 60_000,
      };
      const unhealthyQueue = await HEALTH_GET();
      expect(unhealthyQueue.status).toBe(503);
      expect(await unhealthyQueue.json()).toMatchObject({
        status: "degraded",
        launchMode: "controlled-beta",
        workersPlan: "free",
        webReady: true,
        productionReady: false,
        checks: {
          supportNotificationQueue: "failed",
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails Paretto ID readiness closed when Turnstile is unavailable", async () => {
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "qa-only-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET:
        "qa-only-better-auth-rate-limit-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_SECRET:
        "qa-only-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://paretto.test",
      ...adminAuth.bindings,
      LAUNCH_MODE: "public",
      NATIVE_API_ENABLED: "false",
    });

    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await HEALTH_GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "degraded",
        webReady: false,
        productionReady: false,
        checks: {
          learnerAuthentication: "ready",
          learnerParettoIdAccountCreation: "misconfigured",
          learnerParettoIdSignIn: "misconfigured",
          learnerRecoveryCodes: "misconfigured",
          turnstileSiteKey: "misconfigured",
          turnstileSecret: "misconfigured",
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("degrades production health when scheduled retention last failed", async () => {
    database.retentionSchedule = {
      ...database.retentionSchedule,
      status: "failed",
      last_failed_at: Date.now() - 30_000,
      last_error: "simulated cleanup failure",
      updated_at: Date.now() - 30_000,
    };

    const response = await HEALTH_GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      productionReady: false,
      database: "ready",
      checks: {
        database: "ready",
        schema: "ready",
        retentionSchedule: "failed",
      },
      retentionSchedule: {
        status: "failed",
        missed: false,
      },
    });
  });

  it("degrades production health when a durable notification retry has failed", async () => {
    database.supportQueue = {
      open_jobs: 1,
      failed_jobs: 1,
      oldest_open_at: Date.now() - 5 * 60_000,
    };

    const response = await HEALTH_GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      productionReady: false,
      checks: {
        accountDeletionQueue: "ready",
        supportNotificationQueue: "failed",
      },
      queues: {
        supportNotifications: {
          status: "failed",
          open: 1,
          failed: 1,
        },
      },
    });
  });

  it("makes a missed scheduled retention heartbeat visible in health", async () => {
    const missedAt = Date.now() - 37 * 60 * 60 * 1000;
    database.retentionSchedule = {
      ...database.retentionSchedule,
      status: "succeeded",
      scheduled_at: missedAt,
      started_at: missedAt + 1_000,
      completed_at: missedAt + 2_000,
      last_succeeded_at: missedAt + 2_000,
      updated_at: missedAt + 2_000,
    };

    const response = await HEALTH_GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      productionReady: false,
      checks: { retentionSchedule: "missed" },
      retentionSchedule: {
        status: "missed",
        missed: true,
      },
    });
  });

  it("reports missing runtime configuration and incomplete migrations", async () => {
    const database = new MemoryD1();
    setCloudflareEnv({ DB: database, ADMIN_EMAILS: "admin@paretto.test" });
    const missingSecret = await HEALTH_GET();
    expect(missingSecret.status).toBe(503);
    expect(await missingSecret.json()).toMatchObject({
      status: "degraded",
      productionReady: false,
      checks: {
        database: "ready",
        schema: "ready",
        userKeySecret: "misconfigured",
        supportRateLimitSecret: "misconfigured",
      },
    });

    database.schemaComplete = false;
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      SUPPORT_RATE_LIMIT_SECRET:
        "qa-only-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET:
        "qa-only-better-auth-rate-limit-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_SECRET:
        "qa-only-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      RESEND_API_KEY: "re_qa_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "support@paretto.test",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      NATIVE_API_ENABLED: "false",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const incompleteSchema = await HEALTH_GET();
      expect(incompleteSchema.status).toBe(503);
      expect(await incompleteSchema.json()).toMatchObject({
        status: "degraded",
        productionReady: false,
        database: "ready",
        checks: { database: "ready", schema: "incomplete" },
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps localhost development health useful without claiming production readiness", async () => {
    setCloudflareEnv({
      DB: new MemoryD1(),
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
    });
    vi.stubEnv("NODE_ENV", "development");
    try {
      const response = await HEALTH_GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "ok",
        environment: "development-preview",
        productionReady: false,
        checks: {
          database: "ready",
          schema: "ready",
          retentionSchedule: "ready",
          userKeySecret: "misconfigured",
          supportRateLimitSecret: "misconfigured",
          learnerAuthentication: "ready",
          learnerParettoIdAccountCreation: "misconfigured",
          learnerParettoIdSignIn: "misconfigured",
          learnerRecoveryCodes: "misconfigured",
          learnerPasswordReset: "not-configured",
          learnerGoogleAuth: "optional-not-configured",
          learnerAppleAuth: "optional-not-configured",
          supportNotifications: "not-configured",
          adminAllowlist: "misconfigured",
          adminAuthentication: "misconfigured",
          turnstileSiteKey: "misconfigured",
          turnstileSecret: "misconfigured",
          nativeApi: "disabled",
          appleClientId: "native-disabled",
          appleServerCredentials: "native-disabled",
          appleTokenEncryptionSecret: "native-disabled",
          nativeSessionSecret: "native-disabled",
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
