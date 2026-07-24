import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "../app/api/admin/operations/route";
import { createAdminTestAuth } from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

class OperationsMemoryD1 {
  actions: Array<{ action: string; runId: string; details: Record<string, unknown> }> = [];
  failRetention = false;

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

const EMAIL = "admin@pas-a-pas.test";
let adminCookie = "";

function retentionRequest(batchLimit?: number) {
  return new Request("https://pas-a-pas.test/api/admin/operations", {
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
});
