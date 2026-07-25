import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  identity: {
    ok: true,
    userKey: "owner-key",
    kind: "anonymous",
    accountId: null,
  } as
    | {
        ok: true;
        userKey: string;
        kind: "anonymous";
        accountId: null;
      }
    | {
        ok: false;
        status: 401;
        reason: "missing_identity";
      },
  row: {
    id: "b89166f0-19c8-4dc6-9878-a5174623526c",
    subject: "Audio issue",
    status: "in_progress",
    created_at: Date.parse("2026-07-25T00:00:00.000Z"),
    updated_at: Date.parse("2026-07-25T01:00:00.000Z"),
  } as Record<string, unknown> | null,
  values: [] as unknown[],
}));

vi.mock("../app/server-auth", () => ({
  resolveRequestIdentity: vi.fn(async () => fixtures.identity),
}));

vi.mock("../app/api/_lib/cms-database", () => ({
  getCmsDatabase: vi.fn(async () => ({
    prepare: () => ({
      bind: (...values: unknown[]) => {
        fixtures.values = values;
        return {
          first: async () =>
            values[0] === fixtures.row?.id && values[1] === "owner-key"
              ? fixtures.row
              : null,
        };
      },
    }),
  })),
}));

import { GET } from "../app/api/support/[id]/route";

describe("learner support status API", () => {
  beforeEach(() => {
    fixtures.identity = {
      ok: true,
      userKey: "owner-key",
      kind: "anonymous",
      accountId: null,
    };
    fixtures.row = {
      id: "b89166f0-19c8-4dc6-9878-a5174623526c",
      subject: "Audio issue",
      status: "in_progress",
      created_at: Date.parse("2026-07-25T00:00:00.000Z"),
      updated_at: Date.parse("2026-07-25T01:00:00.000Z"),
    };
    fixtures.values = [];
  });

  it("returns only the owning learner's safe status fields", async () => {
    const id = String(fixtures.row?.id);
    const response = await GET(
      new Request(`https://paretto.test/api/support/${id}`),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(200);
    expect(fixtures.values).toEqual([id, "owner-key"]);
    expect(await response.json()).toEqual({
      request: {
        id,
        subject: "Audio issue",
        status: "in_progress",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T01:00:00.000Z",
      },
    });
  });

  it("does not reveal another learner's request", async () => {
    fixtures.identity = {
      ok: true,
      userKey: "different-owner",
      kind: "anonymous",
      accountId: null,
    };
    const id = String(fixtures.row?.id);
    const response = await GET(
      new Request(`https://paretto.test/api/support/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(404);
  });

  it("rejects missing identity and malformed references", async () => {
    fixtures.identity = {
      ok: false,
      status: 401,
      reason: "missing_identity",
    };
    const unauthorized = await GET(
      new Request("https://paretto.test/api/support/not-a-reference"),
      { params: Promise.resolve({ id: "not-a-reference" }) },
    );
    expect(unauthorized.status).toBe(401);

    fixtures.identity = {
      ok: true,
      userKey: "owner-key",
      kind: "anonymous",
      accountId: null,
    };
    const malformed = await GET(
      new Request("https://paretto.test/api/support/not-a-reference"),
      { params: Promise.resolve({ id: "not-a-reference" }) },
    );
    expect(malformed.status).toBe(400);
  });
});
