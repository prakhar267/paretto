import { beforeEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
} from "../app/api/admin/legal-holds/route";
import { DELETE } from "../app/api/admin/legal-holds/[id]/route";
import { createAdminTestAuth } from "./auth-fixtures";
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
      let holds = [...this.database.holds].sort(compareHolds);
      if (this.sql.includes("CASE STATUS WHEN 'ACTIVE' THEN 0 ELSE 1 END > ?")) {
        const [rankValue, repeatedRankValue, createdAtValue, repeatedCreatedAtValue, idValue] =
          this.values;
        const rank = Number(rankValue);
        const createdAt = Number(createdAtValue);
        const id = String(idValue);
        if (rank !== Number(repeatedRankValue) || createdAt !== Number(repeatedCreatedAtValue)) {
          throw new Error("Legal-hold cursor bindings do not match.");
        }
        holds = holds.filter((hold) => {
          const holdRank = legalHoldRank(hold);
          return (
            holdRank > rank ||
            (holdRank === rank &&
              (hold.created_at < createdAt ||
                (hold.created_at === createdAt && hold.id < id)))
          );
        });
      }
      const limit = Number(this.values.at(-1));
      return {
        results: holds.slice(0, limit) as T[],
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
    if (this.sql.startsWith("UPDATE LEARNER_DELETION_JOBS")) {
      return { meta: { changes: 0 } };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

function legalHoldRank(hold: Hold): number {
  return hold.status === "active" ? 0 : 1;
}

function compareHolds(left: Hold, right: Hold): number {
  const rankDifference = legalHoldRank(left) - legalHoldRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (left.created_at !== right.created_at) {
    return right.created_at - left.created_at;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

const EMAIL = "admin@paretto.test";
let adminCookie = "";

function adminRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://paretto.test${path}`, {
    ...init,
    headers: {
      cookie: adminCookie,
      ...(init.headers ?? {}),
    },
  });
}

describe("legal hold administration", () => {
  let database: LegalHoldMemoryD1;

  beforeEach(async () => {
    database = new LegalHoldMemoryD1();
    const adminAuth = await createAdminTestAuth([EMAIL]);
    adminCookie = adminAuth.cookies.get(EMAIL)!;
    setCloudflareEnv({ DB: database, ...adminAuth.bindings });
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
      nextCursor: null,
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

  it("paginates every hold without gaps or duplicates across status and timestamp ties", async () => {
    database.holds = Array.from({ length: 205 }, (_, index) => ({
      id: holdId(index),
      data_class: "product_events",
      record_key: `account:${index}`,
      reason: `Preserve account ${index} records for a legal review.`,
      status: index < 150 ? "active" : "released",
      created_by_email: EMAIL,
      created_at: 1_700_000_000_000 + Math.floor(index / 5),
      released_by_email: index < 150 ? null : EMAIL,
      released_at: index < 150 ? null : 1_700_000_100_000 + index,
    }));

    const received: Array<{ id: string; status: Hold["status"] }> = [];
    let cursor: string | null = null;
    do {
      const path = cursor
        ? `/api/admin/legal-holds?limit=37&cursor=${encodeURIComponent(cursor)}`
        : "/api/admin/legal-holds?limit=37";
      const response = await GET(adminRequest(path));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        holds: Array<{ id: string; status: Hold["status"] }>;
        nextCursor: string | null;
      };
      received.push(...body.holds);
      cursor = body.nextCursor;
    } while (cursor);

    expect(received).toHaveLength(205);
    expect(new Set(received.map((hold) => hold.id)).size).toBe(205);
    expect(received.slice(0, 150).every((hold) => hold.status === "active")).toBe(true);
    expect(received.slice(150).every((hold) => hold.status === "released")).toBe(true);
    expect(received.map((hold) => hold.id)).toEqual(
      [...database.holds].sort(compareHolds).map((hold) => hold.id),
    );
  });

  it("rejects invalid pagination parameters", async () => {
    const invalidLimit = await GET(
      adminRequest("/api/admin/legal-holds?limit=101"),
    );
    expect(invalidLimit.status).toBe(400);

    const invalidCursor = await GET(
      adminRequest(
        "/api/admin/legal-holds?cursor=2%3A1700000000000%3Anot-a-legal-hold-id",
      ),
    );
    expect(invalidCursor.status).toBe(400);
  });
});

function holdId(index: number): string {
  const hexadecimal = index.toString(16);
  return `${hexadecimal.padStart(8, "0")}-0000-4000-8000-${hexadecimal.padStart(12, "0")}`;
}
