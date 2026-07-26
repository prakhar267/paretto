import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const getLearnerAuth = vi.fn();

vi.mock("../app/learner-auth", () => ({
  getLearnerAuth,
  learnerAuthReadiness: vi.fn(async () => ({
    configured: true,
    canonicalOrigin: true,
    emailPassword: true,
    emailAccountCreation: true,
    emailVerification: false,
    passwordReset: false,
    google: false,
    apple: false,
  })),
}));

const {
  anonymousUserKey,
  resolveBrowserProgressCacheIdentity,
} = await import("../app/server-auth");

const USER_KEY_SECRET =
  "cache-identity-test-secret-with-at-least-thirty-two-characters";
const ANONYMOUS_TOKEN = "A".repeat(43);

class IdentityLinkDatabase {
  links = new Map<string, string>();
  deletionAccounts = new Set<string>();

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    const readsIdentityLink = normalized.startsWith(
      "SELECT ACCOUNT_ID FROM LEARNER_IDENTITY_LINKS WHERE ANONYMOUS_USER_KEY = ?",
    );
    const readsDeletionJob = normalized.startsWith(
      "SELECT USER_ID FROM LEARNER_DELETION_JOBS WHERE USER_ID = ?",
    );
    if (!readsIdentityLink && !readsDeletionJob) {
      throw new Error(`Unexpected SQL: ${sql}`);
    }
    let value = "";
    const identityLinks = this.links;
    const deletionAccounts = this.deletionAccounts;
    return {
      bind(boundValue: unknown) {
        value = String(boundValue);
        return this;
      },
      async first<T>() {
        if (readsDeletionJob) {
          return (deletionAccounts.has(value)
            ? { user_id: value }
            : null) as T | null;
        }
        const accountId = identityLinks.get(value);
        return (accountId ? { account_id: accountId } : null) as T | null;
      },
    };
  }
}

let database: IdentityLinkDatabase;

function request(accountCookie?: string) {
  return new Request("https://paretto.test/", {
    headers: {
      cookie: [
        `__Host-learner-session=${ANONYMOUS_TOKEN}`,
        accountCookie
          ? `__Secure-paretto.session_token=${accountCookie}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    },
  });
}

describe("server-resolved browser progress cache identity", () => {
  beforeEach(() => {
    database = new IdentityLinkDatabase();
    setCloudflareEnv({
      DB: database,
      USER_KEY_SECRET,
      BETTER_AUTH_SECRET:
        "cache-auth-test-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_URL: "https://paretto.test",
    });
    getLearnerAuth.mockReset();
  });

  it("allows legacy migration only for an unclaimed anonymous browser identity", async () => {
    const result = await resolveBrowserProgressCacheIdentity(request());

    expect(result).toMatchObject({
      ok: true,
      identity: {
        kind: "anonymous",
        accountId: null,
        legacyCachePolicy: "migrate-anonymous",
      },
    });
    expect(getLearnerAuth).not.toHaveBeenCalled();
  });

  it("gates an expired account session and rotates its claimed anonymous identity before boot", async () => {
    const anonymousKey = await anonymousUserKey(
      USER_KEY_SECRET,
      ANONYMOUS_TOKEN,
    );
    database.links.set(anonymousKey, "account-a");
    getLearnerAuth.mockResolvedValue({
      api: { getSession: vi.fn(async () => null) },
    });

    const result = await resolveBrowserProgressCacheIdentity(
      request("expired-session"),
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        kind: "reset-anonymous",
        accountId: null,
        reason: "claimed-browser-identity",
      },
    });
  });

  it("selects distinct scopes for directly authenticated accounts on the same browser", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        session: {
          id: "session-a",
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        user: {
          id: "account-a",
          email: "a@example.test",
          name: "Account A",
        },
      })
      .mockResolvedValueOnce({
        session: {
          id: "session-b",
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        user: {
          id: "account-b",
          email: "b@example.test",
          name: "Account B",
        },
      });
    getLearnerAuth.mockResolvedValue({ api: { getSession } });

    const accountA = await resolveBrowserProgressCacheIdentity(
      request("session-a"),
    );
    const accountB = await resolveBrowserProgressCacheIdentity(
      request("session-b"),
    );

    expect(accountA).toMatchObject({
      ok: true,
      identity: { kind: "account", accountId: "account-a" },
    });
    expect(accountB).toMatchObject({
      ok: true,
      identity: { kind: "account", accountId: "account-b" },
    });
    if (
      !accountA.ok ||
      !accountB.ok ||
      accountA.identity.kind !== "account" ||
      accountB.identity.kind !== "account"
    ) {
      throw new Error("Expected two account cache identities.");
    }
    expect(accountA.identity.storageKey).not.toBe(
      accountB.identity.storageKey,
    );
  });

  it("does not boot an account cache while that learner has a pending deletion job", async () => {
    database.deletionAccounts.add("account-a");
    getLearnerAuth.mockResolvedValue({
      api: {
        getSession: vi.fn(async () => ({
          session: {
            id: "session-a",
            expiresAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          user: {
            id: "account-a",
            email: "a@example.test",
            name: "Account A",
          },
        })),
      },
    });

    await expect(
      resolveBrowserProgressCacheIdentity(request("session-a")),
    ).resolves.toEqual({
      ok: false,
      reason: "identity_unavailable",
    });
  });
});
