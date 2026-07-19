import { beforeEach, describe, expect, it } from "vitest";
import {
  DELETE,
  GET,
  PUT,
} from "../app/api/progress/route";
import { GET as HEALTH_GET } from "../app/api/health/route";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Row = { payload: string; revision: number; updated_at: number };
type ProgressResponse = {
  revision: number;
  state?: Record<string, unknown>;
  code?: string;
};

async function progressJson(response: Response) {
  return response.json() as Promise<ProgressResponse>;
}

class MemoryD1 {
  rows = new Map<string, Row>();

  prepare(sql: string) {
    return new MemoryStatement(this.rows, sql);
  }
}

class MemoryStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly rows: Map<string, Row>,
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
      return (this.rows.get(String(this.values[0])) ?? null) as T | null;
    }
    throw new Error(`Unexpected first() SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE")) {
      const [rawUserKey, rawPayload, rawUpdatedAt] = this.values;
      const userKey = String(rawUserKey);
      if (this.rows.has(userKey)) return { meta: { changes: 0 } };
      this.rows.set(userKey, {
        payload: String(rawPayload),
        revision: 1,
        updated_at: Number(rawUpdatedAt),
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE LEARNING_STATE")) {
      const [rawPayload, rawUpdatedAt, rawUserKey, rawRevision] = this.values;
      const userKey = String(rawUserKey);
      const existing = this.rows.get(userKey);
      if (!existing || existing.revision !== Number(rawRevision)) {
        return { meta: { changes: 0 } };
      }
      this.rows.set(userKey, {
        payload: String(rawPayload),
        revision: existing.revision + 1,
        updated_at: Number(rawUpdatedAt),
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM LEARNING_STATE")) {
      return {
        meta: { changes: this.rows.delete(String(this.values[0])) ? 1 : 0 },
      };
    }

    throw new Error(`Unexpected run() SQL: ${this.sql}`);
  }
}

const authenticatedHeaders = {
  "oai-authenticated-user-email": "qa@pas-a-pas.test",
};

function request(init: RequestInit = {}) {
  return new Request("https://pas-a-pas.test/api/progress", init);
}

describe("progress API", () => {
  beforeEach(() => {
    setCloudflareEnv({
      DB: new MemoryD1(),
      USER_KEY_SECRET: "qa-only-secret-with-at-least-thirty-two-characters",
    });
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
    expect(await response.json()).toMatchObject({ status: "ok", database: "ready" });
  });
});
