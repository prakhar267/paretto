import { beforeEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
} from "../app/api/admin/legal-holds/route";
import { DELETE } from "../app/api/admin/legal-holds/[id]/route";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Hold = {
  id: string;
  data_class: string;
  record_key: string | null;
  reason: string;
  status: "active" | "released";
  created_by_email: string;
  created_at: number;
  released_by_email: string | null;
  released_at: number | null;
};

class LegalHoldMemoryD1 {
  holds: Hold[] = [];
  audits: Array<{ action: string; entityId: string }> = [];
  lastChanges = 0;

  prepare(sql: string) {
    return new LegalHoldStatement(this, sql);
  }

  async batch(statements: LegalHoldStatement[]) {
    const results = [];
    for (const statement of statements) {
      const result = await statement.run();
      this.lastChanges = result.meta.changes;
      results.push(result);
    }
    return results;
  }
}

class LegalHoldStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(private database: LegalHoldMemoryD1, sql: string) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    if (this.sql.startsWith("SELECT ID, DATA_CLASS")) {
      return {
        results: [...this.database.holds] as T[],
        success: true,
        meta: {},
      };
    }
    throw new Error(`Unexpected all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO RETENTION_LEGAL_HOLDS")) {
      const [id, dataClass, recordKey, reason, email, now] = this.values;
      this.database.holds.push({
        id: String(id),
        data_class: String(dataClass),
        record_key: recordKey === null ? null : String(recordKey),
        reason: String(reason),
        status: "active",
        created_by_email: String(email),
        created_at: Number(now),
        released_by_email: null,
        released_at: null,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE RETENTION_LEGAL_HOLDS")) {
      const [email, now, id] = this.values;
      const hold = this.database.holds.find(
        (candidate) => candidate.id === id && candidate.status === "active",
      );
      if (!hold) return { meta: { changes: 0 } };
      hold.status = "released";
      hold.released_by_email = String(email);
      hold.released_at = Number(now);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO ADMIN_AUDIT_LOG")) {
      if (
        this.sql.includes("LEGAL_HOLD_RELEASED") &&
        this.sql.includes("CHANGES() = 1") &&
        this.database.lastChanges !== 1
      ) {
        return { meta: { changes: 0 } };
      }
      const [entityId] = this.values;
      this.database.audits.push({
        action: this.sql.includes("LEGAL_HOLD_RELEASED")
          ? "LEGAL_HOLD_RELEASED"
          : "LEGAL_HOLD_CREATED",
        entityId: String(entityId),
      });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

const EMAIL = "admin@pas-a-pas.test";

function adminRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://pas-a-pas.test${path}`, {
    ...init,
    headers: {
      "oai-authenticated-user-email": EMAIL,
      ...(init.headers ?? {}),
    },
  });
}

describe("legal hold administration", () => {
  let database: LegalHoldMemoryD1;

  beforeEach(() => {
    database = new LegalHoldMemoryD1();
    setCloudflareEnv({ DB: database, ADMIN_EMAILS: EMAIL });
  });

  it("creates, lists, releases, and audits a bounded legal hold", async () => {
    const created = await POST(
      adminRequest("/api/admin/legal-holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataClass: "product_events",
          recordKey: "account:abc123",
          reason: "Preserve records for an active legal review.",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { hold: { id: string } };
    expect(createdBody.hold.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(database.audits).toEqual([
      { action: "LEGAL_HOLD_CREATED", entityId: createdBody.hold.id },
    ]);

    const listed = await GET(adminRequest("/api/admin/legal-holds"));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      holds: [{ status: "active", recordKey: "account:abc123" }],
    });

    const released = await DELETE(
      adminRequest(`/api/admin/legal-holds/${createdBody.hold.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "release-legal-hold",
          releaseReason: "Counsel confirmed the matter is fully closed.",
        }),
      }),
      { params: Promise.resolve({ id: createdBody.hold.id }) },
    );
    expect(released.status).toBe(200);
    expect(database.holds[0].status).toBe("released");
    expect(database.audits.at(-1)?.action).toBe("LEGAL_HOLD_RELEASED");

    const duplicateRelease = await DELETE(
      adminRequest(`/api/admin/legal-holds/${createdBody.hold.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "release-legal-hold",
          releaseReason: "Counsel confirmed the matter is fully closed.",
        }),
      }),
      { params: Promise.resolve({ id: createdBody.hold.id }) },
    );
    expect(duplicateRelease.status).toBe(404);
    expect(database.audits.filter((entry) => entry.action === "LEGAL_HOLD_RELEASED"))
      .toHaveLength(1);
  });

  it("rejects an unreasoned hold", async () => {
    const response = await POST(
      adminRequest("/api/admin/legal-holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataClass: "product_events",
          recordKey: null,
          reason: "short",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(database.holds).toHaveLength(0);
  });
});
