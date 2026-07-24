import { beforeEach, describe, expect, it } from "vitest";

import {
  DELETE,
  POST,
} from "../app/api/admin/session/route";
import { createAdminTestAuth } from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Attempt = {
  failed_attempts: number;
  window_started_at: number;
  blocked_until: number | null;
  updated_at: number;
};

class LoginMemoryD1 {
  attempts = new Map<string, Attempt>();

  prepare(sql: string) {
    return new LoginStatement(this, sql);
  }

  async batch(statements: LoginStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class LoginStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: LoginMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.startsWith("SELECT FAILED_ATTEMPTS")) {
      return (
        this.database.attempts.get(String(this.values[0])) ?? null
      ) as T | null;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO ADMIN_LOGIN_ATTEMPTS")) {
      const [
        rawIpHash,
        rawNow,
        ,
        rawCutoff,
        ,
        ,
        rawMaximum,
        rawBlockedUntil,
      ] = this.values;
      const ipHash = String(rawIpHash);
      const now = Number(rawNow);
      const cutoff = Number(rawCutoff);
      const maximum = Number(rawMaximum);
      const existing = this.database.attempts.get(ipHash);
      const outsideWindow =
        !existing || existing.window_started_at < cutoff;
      const failedAttempts = outsideWindow
        ? 1
        : existing.failed_attempts + 1;
      this.database.attempts.set(ipHash, {
        window_started_at: outsideWindow
          ? now
          : existing.window_started_at,
        failed_attempts: failedAttempts,
        blocked_until:
          !outsideWindow && failedAttempts >= maximum
            ? Number(rawBlockedUntil)
            : outsideWindow
              ? null
              : existing.blocked_until,
        updated_at: now,
      });
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith(
        "DELETE FROM ADMIN_LOGIN_ATTEMPTS WHERE IP_HASH = ?",
      )
    ) {
      return {
        meta: {
          changes: this.database.attempts.delete(String(this.values[0]))
            ? 1
            : 0,
        },
      };
    }
    if (
      this.sql.startsWith(
        "DELETE FROM ADMIN_LOGIN_ATTEMPTS WHERE IP_HASH IN",
      )
    ) {
      const cutoff = Number(this.values[0]);
      const limit = Number(this.values[1]);
      const expired = [...this.database.attempts]
        .filter(([, attempt]) => attempt.updated_at < cutoff)
        .sort((left, right) => left[1].updated_at - right[1].updated_at)
        .slice(0, limit);
      for (const [ipHash] of expired) this.database.attempts.delete(ipHash);
      return { meta: { changes: expired.length } };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

describe("administrator session API", () => {
  const email = "admin@example.test";
  let database: LoginMemoryD1;
  let accessKey: string;

  beforeEach(async () => {
    database = new LoginMemoryD1();
    const auth = await createAdminTestAuth([email]);
    accessKey = auth.accessKeys.get(email)!;
    setCloudflareEnv({ DB: database, ...auth.bindings });
  });

  it("issues and clears a strict signed session without storing raw credentials", async () => {
    const response = await POST(loginRequest(email, accessKey));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      email,
    });
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("__Host-admin-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(database.attempts).toHaveLength(0);

    const logout = DELETE(
      new Request("https://learn.example/api/admin/session", {
        method: "DELETE",
        headers: { origin: "https://learn.example" },
      }),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("uses a generic error, hashes the IP, and blocks the fifth failed attempt", async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await POST(loginRequest(email, "z".repeat(40)));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "The email or password is incorrect.",
      });
    }
    const blocked = await POST(loginRequest(email, "z".repeat(40)));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect([...database.attempts.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...database.attempts])).not.toContain(
      "198.51.100.9",
    );
  });

  it("rejects a cross-origin login before touching the database", async () => {
    const response = await POST(
      new Request("https://learn.example/api/admin/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ email, password: accessKey }),
      }),
    );
    expect(response.status).toBe(403);
    expect(database.attempts).toHaveLength(0);
  });
});

function loginRequest(email: string, password: string): Request {
  return new Request("https://learn.example/api/admin/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://learn.example",
      "cf-connecting-ip": "198.51.100.9",
    },
    body: JSON.stringify({ email, password }),
  });
}
