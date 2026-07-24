import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE,
  GET,
  PUT,
} from "../app/api/progress/route";
import { GET as HEALTH_GET } from "../app/api/health/route";
import {
  createAdminTestAuth,
  learnerCookieHeaders,
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Row = { payload: string; revision: number; updated_at: number };
type ProgressResponse = {
  revision: number;
  state?: Record<string, unknown>;
  code?: string;
};

const HEALTH_SCHEMA_COLUMNS: Record<string, string[]> = {
  learning_state: ["user_key", "revision", "payload", "updated_at"],
  admin_login_attempts: [
    "ip_hash", "window_started_at", "failed_attempts", "blocked_until",
    "updated_at",
  ],
  cms_content: [
    "id", "kind", "slug", "stable_key", "title", "content", "status",
    "revision", "created_at", "updated_at", "published_at", "review_status",
    "reviewed_by_email", "reviewed_at", "approved_revision",
    "created_by_email", "updated_by_email",
  ],
  cms_vocabulary_aliases: [
    "alias", "content_id", "stable_key", "created_at",
  ],
  cms_slug_tombstones: [
    "kind", "slug", "stable_key", "content_id", "retired_at",
    "retired_by_email",
  ],
  cms_content_revisions: [
    "content_id", "revision", "kind", "slug", "stable_key", "title",
    "content", "status", "published_at", "actor_email", "action",
    "created_at",
  ],
  support_requests: [
    "id", "user_key", "reply_email", "category", "subject", "body", "status",
    "revision", "created_at", "updated_at",
  ],
  admin_audit_log: [
    "id", "entity_type", "entity_id", "actor_email", "action",
    "from_revision", "to_revision", "details", "created_at",
  ],
  product_events: [
    "id", "user_key", "session_id", "event_name", "properties", "occurred_at",
    "received_at",
  ],
  native_accounts: [
    "id", "apple_subject_hash", "email", "display_name", "created_at", "updated_at",
  ],
  native_sessions: [
    "token_hash", "id", "account_id", "expires_at", "created_at", "revoked_at",
  ],
  native_learning_state: ["account_id", "revision", "payload", "updated_at"],
  native_apple_credentials: [
    "account_id", "refresh_token_ciphertext", "updated_at",
  ],
  native_identity_token_uses: ["token_hash", "exchange_id", "expires_at", "used_at"],
  retention_legal_holds: [
    "id", "data_class", "record_key", "reason", "status",
    "created_by_email", "created_at", "released_by_email", "released_at",
  ],
};

async function progressJson(response: Response) {
  return response.json() as Promise<ProgressResponse>;
}

class MemoryD1 {
  rows = new Map<string, Row>();
  aliases = new Map<string, string>();
  schemaComplete = true;

  prepare(sql: string) {
    return new MemoryStatement(this, sql);
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
    if (this.sql.startsWith("SELECT PAYLOAD, REVISION, UPDATED_AT")) {
      return (this.database.rows.get(String(this.values[0])) ?? null) as T | null;
    }
    throw new Error(`Unexpected first() SQL: ${this.sql}`);
  }

  async all<T>() {
    if (this.sql.startsWith("SELECT ALIAS, STABLE_KEY FROM CMS_VOCABULARY_ALIASES")) {
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
      const tableName = this.sql.match(/PRAGMA TABLE_INFO\("([^"]+)"\)/)?.[1].toLowerCase();
      const columns = tableName ? [...(HEALTH_SCHEMA_COLUMNS[tableName] ?? [])] : [];
      if (!this.database.schemaComplete && tableName === "product_events") {
        columns.splice(columns.indexOf("received_at"), 1);
      }
      return {
        results: columns.map((name) => ({ name })) as T[],
        success: true,
        meta: {},
      };
    }
    if (this.sql.startsWith("SELECT NAME FROM SQLITE_MASTER WHERE TYPE = 'INDEX'")) {
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
      this.sql.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS")
    ) {
      return { meta: { changes: 0 } };
    }
    if (this.sql.startsWith("INSERT OR IGNORE")) {
      const [rawUserKey, rawPayload, rawUpdatedAt] = this.values;
      const userKey = String(rawUserKey);
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
        meta: { changes: this.database.rows.delete(String(this.values[0])) ? 1 : 0 },
      };
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

  beforeEach(async () => {
    database = new MemoryD1();
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      NATIVE_API_ENABLED: "false",
    });
  });

  it("reconciles historical slug progress into the immutable vocabulary ID", async () => {
    database.aliases.set("renamed-card", "original-card");
    const initial = await progressJson(
      await GET(request({ headers: authenticatedHeaders })),
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
        headers: { ...authenticatedHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          revision: 0,
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

  it("enforces identity, revisions, sanitization, and deletion", async () => {
    expect((await GET(request())).status).toBe(401);

    const initial = await GET(request({ headers: authenticatedHeaders }));
    expect(initial.status).toBe(200);
    expect((await progressJson(initial)).revision).toBe(0);

    const invalidJson = await PUT(
      request({
        method: "PUT",
        headers: { ...authenticatedHeaders, "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(invalidJson.status).toBe(400);

    const saved = await PUT(
      request({
        method: "PUT",
        headers: { ...authenticatedHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          revision: 0,
          state: {
            version: 1,
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
        headers: { ...authenticatedHeaders, "content-type": "application/json" },
        body: JSON.stringify({ revision: 0, state: savedBody.state }),
      }),
    );
    expect(staleWrite.status).toBe(409);
    expect((await progressJson(staleWrite)).code).toBe("REVISION_CONFLICT");

    const readBack = await GET(request({ headers: authenticatedHeaders }));
    expect(readBack.status).toBe(200);
    expect((await progressJson(readBack)).revision).toBe(1);

    const deleted = await DELETE(
      request({ method: "DELETE", headers: authenticatedHeaders }),
    );
    expect(deleted.status).toBe(200);
    expect((await progressJson(deleted)).revision).toBe(0);

    const afterDelete = await GET(request({ headers: authenticatedHeaders }));
    expect(afterDelete.status).toBe(200);
    expect((await progressJson(afterDelete)).revision).toBe(0);
  });

  it("verifies D1 readiness through the health endpoint", async () => {
    const response = await HEALTH_GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      productionReady: true,
      schemaRevision: "0007",
      database: "ready",
      checks: {
        database: "ready",
        schema: "ready",
        userKeySecret: "ready",
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
      checks: { database: "ready", schema: "ready", userKeySecret: "misconfigured" },
    });

    database.schemaComplete = false;
    const adminAuth = await createAdminTestAuth(["admin@paretto.test"]);
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
      ...adminAuth.bindings,
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
      NATIVE_API_ENABLED: "false",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    setCloudflareEnv({ DB: new MemoryD1() });
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
          userKeySecret: "misconfigured",
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
