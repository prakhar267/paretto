import { DatabaseSync } from "node:sqlite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  hashSubmittedRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "../app/account-recovery";
import {
  validateAccountRecovery,
  validateAccountRegistration,
  validateAccountSignIn,
  validateAccountDeletion,
  validateRecoveryCodeRotation,
} from "../app/account-request";
import { verifyParettoPassword } from "../app/password-kdf";
import { GET as AUTH_GET, POST as AUTH_POST } from "../app/api/auth/[...all]/route";
import { POST as DELETE_ACCOUNT } from "../app/api/account/delete/route";
import { POST as RECOVER } from "../app/api/account/recover/route";
import { POST as REGISTER } from "../app/api/account/register/route";
import { POST as ROTATE_RECOVERY_CODES } from "../app/api/account/recovery-codes/route";
import { POST as SIGN_IN } from "../app/api/account/sign-in/route";
import {
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type SqliteBinding =
  | string
  | number
  | bigint
  | null
  | Uint8Array;

type D1RunResult = {
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
  };
};

const ORIGIN = "https://learn.example";
const AUTH_BINDINGS = {
  BETTER_AUTH_SECRET:
    "test-paretto-account-auth-secret-with-at-least-32-characters",
  PARETTO_PASSWORD_PEPPERS: JSON.stringify({
    current: "test-v1",
    keys: {
      "test-v1":
        "test-paretto-account-password-pepper-with-at-least-32-characters",
    },
  }),
  BETTER_AUTH_RATE_LIMIT_SECRET:
    "test-paretto-account-rate-limit-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: ORIGIN,
  USER_KEY_SECRET:
    "test-paretto-account-user-key-secret-with-at-least-32-characters",
  TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
};
const INITIAL_PASSWORD = "correct horse battery staple";
const NEXT_PASSWORD = "different correct horse battery staple";

class AccountSqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  failNextBatchAt: number | null = null;
  private batchTail: Promise<void> = Promise.resolve();

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE learner_user (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        username TEXT,
        display_username TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX learner_user_email_unique
        ON learner_user (email);
      CREATE UNIQUE INDEX learner_user_username_unique
        ON learner_user (username);

      CREATE TABLE learner_session (
        id TEXT PRIMARY KEY NOT NULL,
        expires_at INTEGER NOT NULL,
        token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        user_id TEXT NOT NULL
          REFERENCES learner_user(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX learner_session_token_unique
        ON learner_session (token);
      CREATE INDEX learner_session_user_idx
        ON learner_session (user_id);
      CREATE INDEX learner_session_expiry_idx
        ON learner_session (expires_at);

      CREATE TABLE learner_account (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id TEXT NOT NULL
          REFERENCES learner_user(id) ON DELETE CASCADE,
        access_token TEXT,
        refresh_token TEXT,
        id_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        password TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX learner_account_user_idx
        ON learner_account (user_id);
      CREATE UNIQUE INDEX learner_account_provider_unique
        ON learner_account (provider_id, account_id);

      CREATE TABLE learner_verification (
        id TEXT PRIMARY KEY NOT NULL,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX learner_verification_identifier_idx
        ON learner_verification (identifier);
      CREATE INDEX learner_verification_expiry_idx
        ON learner_verification (expires_at);

      CREATE TABLE learner_auth_rate_limits (
        bucket_hash TEXT PRIMARY KEY NOT NULL,
        request_count INTEGER NOT NULL CHECK (request_count >= 1),
        last_request_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX learner_auth_rate_limits_updated_idx
        ON learner_auth_rate_limits (updated_at);

      CREATE TABLE learner_recovery_codes (
        code_hash TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL
          REFERENCES learner_user(id) ON DELETE CASCADE,
        generation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX learner_recovery_codes_user_generation_idx
        ON learner_recovery_codes (user_id, generation_id);

      CREATE TABLE learner_recovery_state (
        user_id TEXT PRIMARY KEY NOT NULL
          REFERENCES learner_user(id) ON DELETE CASCADE,
        generation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  prepare(sql: string) {
    return new AccountSqliteD1Statement(this.sqlite, sql);
  }

  async batch(
    statements: AccountSqliteD1Statement[],
  ): Promise<D1RunResult[]> {
    let resolveResult!: (value: D1RunResult[]) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<D1RunResult[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const failAt = this.failNextBatchAt;
    this.failNextBatchAt = null;
    const runBatch = async () => {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results: D1RunResult[] = [];
        for (const [index, statement] of statements.entries()) {
          if (index === failAt) {
            throw new Error("injected atomic batch failure");
          }
          results.push(await statement.run());
        }
        this.sqlite.exec("COMMIT");
        resolveResult(results);
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        rejectResult(error);
      }
    };
    this.batchTail = this.batchTail.then(runBatch, runBatch);
    await result;
    return result;
  }

  row<T extends Record<string, unknown>>(
    sql: string,
    ...values: SqliteBinding[]
  ): T | undefined {
    return this.sqlite.prepare(sql).get(...values) as T | undefined;
  }

  rows<T extends Record<string, unknown>>(
    sql: string,
    ...values: SqliteBinding[]
  ): T[] {
    return this.sqlite.prepare(sql).all(...values) as T[];
  }

  scalar(sql: string, ...values: SqliteBinding[]): number {
    const row = this.row<Record<string, number>>(sql, ...values);
    return Number(row ? Object.values(row)[0] : 0);
  }
}

class AccountSqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(column?: string): Promise<T | null> {
    const result = this.sqlite
      .prepare(this.sql)
      .get(...this.bindings()) as Record<string, unknown> | undefined;
    if (!result) return null;
    return (column ? result[column] : result) as T;
  }

  async all<T>() {
    return {
      results: this.sqlite
        .prepare(this.sql)
        .all(...this.bindings()) as T[],
      success: true,
      meta: {},
    };
  }

  async raw<T extends unknown[]>() {
    const statement = this.sqlite.prepare(this.sql);
    const rows = statement.all(...this.bindings()) as Record<
      string,
      unknown
    >[];
    const columns = statement.columns().map((column) => column.name);
    return rows.map(
      (row) => columns.map((column) => row[column]) as T,
    );
  }

  async run(): Promise<D1RunResult> {
    const result = this.sqlite
      .prepare(this.sql)
      .run(...this.bindings());
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  private bindings(): SqliteBinding[] {
    return this.values as SqliteBinding[];
  }
}

type RegistrationReceipt = {
  account: { username: string };
  recoveryCodes: string[];
};

const databases: AccountSqliteD1[] = [];

describe("Paretto ID request validation", () => {
  it("normalizes IDs while rejecting reserved IDs, weak passwords, and extra fields", () => {
    expect(
      validateAccountRegistration({
        username: "  Learner.One  ",
        password: INITIAL_PASSWORD,
        turnstileToken: "challenge",
      }),
    ).toEqual({
      ok: true,
      value: {
        username: "learner.one",
        password: INITIAL_PASSWORD,
        turnstileToken: "challenge",
      },
    });
    expect(
      validateAccountRegistration({
        username: "admin",
        password: INITIAL_PASSWORD,
        turnstileToken: "challenge",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("reserved") });
    expect(
      validateAccountRegistration({
        username: "learner",
        password: "too-short",
        turnstileToken: "challenge",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("at least 12"),
    });
    expect(
      validateAccountRegistration({
        username: "learner",
        password: INITIAL_PASSWORD,
        turnstileToken: "challenge",
        email: "should-not-be-accepted@example.test",
      }),
    ).toEqual({ ok: false, error: "The account request is invalid." });
  });

  it("keeps sign-in errors generic and strictly validates recovery requests", () => {
    const malformedId = validateAccountSignIn({
      username: ".reveals-account-shape",
      password: "x",
      turnstileToken: "challenge",
    });
    const malformedPassword = validateAccountSignIn({
      username: "valid-id",
      password: "",
      turnstileToken: "challenge",
    });
    expect(malformedId).toEqual(malformedPassword);
    expect(malformedId).toEqual({
      ok: false,
      error: "The Paretto ID or password is incorrect.",
    });

    expect(
      validateAccountRecovery({
        username: "learner",
        recoveryCode: "contains\u0000control",
        password: NEXT_PASSWORD,
        turnstileToken: "challenge",
      }),
    ).toMatchObject({
      ok: false,
      error: "Enter one of your unused recovery codes.",
    });
    expect(
      validateAccountRecovery({
        username: "learner",
        recoveryCode: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
        password: NEXT_PASSWORD,
        turnstileToken: "challenge",
        unexpected: true,
      }),
    ).toEqual({ ok: false, error: "The account request is invalid." });
    expect(
      validateRecoveryCodeRotation({
        password: INITIAL_PASSWORD,
        turnstileToken: "",
      }),
    ).toEqual({
      ok: false,
      error: "Complete the security check and try again.",
    });
    expect(validateAccountDeletion({ password: "" })).toEqual({
      ok: true,
      value: { password: "" },
    });
    expect(
      validateAccountDeletion({
        password: INITIAL_PASSWORD,
        unexpected: true,
      }),
    ).toEqual({
      ok: false,
      error: "The account request is invalid.",
    });
  });
});

describe("Paretto ID account API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    for (const database of databases) database.sqlite.close();
    databases.length = 0;
    setCloudflareEnv({});
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects missing and cross-origin mutations before validation, auth, or Turnstile", async () => {
    const database = useDatabase();
    const fetchMock = installTurnstile();
    const routes = [
      {
        path: "/api/account/register",
        post: REGISTER,
        body: registrationBody(),
      },
      {
        path: "/api/account/sign-in",
        post: SIGN_IN,
        body: signInBody(),
      },
      {
        path: "/api/account/recover",
        post: RECOVER,
        body: {
          username: "learner",
          recoveryCode: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
          password: NEXT_PASSWORD,
          turnstileToken: "recover-token",
        },
      },
      {
        path: "/api/account/recovery-codes",
        post: ROTATE_RECOVERY_CODES,
        body: {
          password: INITIAL_PASSWORD,
          turnstileToken: "rotate-token",
        },
      },
    ] as const;

    for (const route of routes) {
      for (const origin of [null, "https://attacker.example"]) {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (origin) headers.origin = origin;
        const response = await route.post(
          new Request(`${ORIGIN}${route.path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(route.body),
          }),
        );
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe(
          "private, no-store, max-age=0",
        );
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.scalar("SELECT count(*) FROM learner_user")).toBe(0);
  });

  it("requires each route's exact Turnstile action and exact hostname", async () => {
    const database = useDatabase();
    const fetchMock = installTurnstile({
      "register-wrong-action": {
        action: "account_sign_in",
        hostname: "learn.example",
      },
      "register-wrong-host": {
        action: "account_create",
        hostname: "attacker.example",
      },
      "sign-in-wrong-action": {
        action: "account_recover",
        hostname: "learn.example",
      },
      "recover-wrong-action": {
        action: "recovery_codes_rotate",
        hostname: "learn.example",
      },
      "rotate-wrong-action": {
        action: "account_create",
        hostname: "learn.example",
      },
    });

    for (const token of ["register-wrong-action", "register-wrong-host"]) {
      const response = await REGISTER(
        accountRequest("/api/account/register", {
          ...registrationBody(),
          turnstileToken: token,
        }),
      );
      expect(response.status).toBe(400);
    }

    const receipt = await register("turnstile-learner");
    const signedIn = await signIn("turnstile-learner");
    const cookie = responseCookie(signedIn);
    const exactActionChecks = [
      SIGN_IN(
        accountRequest("/api/account/sign-in", {
          ...signInBody("turnstile-learner"),
          turnstileToken: "sign-in-wrong-action",
        }),
      ),
      RECOVER(
        accountRequest("/api/account/recover", {
          username: "turnstile-learner",
          recoveryCode: receipt.recoveryCodes[0],
          password: NEXT_PASSWORD,
          turnstileToken: "recover-wrong-action",
        }),
      ),
      ROTATE_RECOVERY_CODES(
        accountRequest(
          "/api/account/recovery-codes",
          {
            password: INITIAL_PASSWORD,
            turnstileToken: "rotate-wrong-action",
          },
          { cookie },
        ),
      ),
    ];
    const exactActionResponses = await Promise.all(exactActionChecks);
    expect(exactActionResponses.map((response) => response.status)).toEqual([
      400,
      400,
      400,
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(database.scalar("SELECT count(*) FROM learner_user")).toBe(1);
  });

  it("creates the credential and recovery set atomically without disclosing internal identity data", async () => {
    const database = useDatabase();
    installTurnstile();

    const response = await REGISTER(
      accountRequest(
        "/api/account/register",
        registrationBody("  Learner.One  "),
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    const rawResponse = await response.text();
    const receipt = JSON.parse(rawResponse) as RegistrationReceipt;
    expect(receipt).toMatchObject({
      account: { username: "learner.one" },
    });
    expect(receipt.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(receipt.recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of receipt.recoveryCodes) {
      expect(code).toMatch(
        /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}$/,
      );
    }
    expect(rawResponse).not.toContain("@");
    expect(rawResponse).not.toContain(".invalid");
    expect(rawResponse).not.toContain("password");
    expect(rawResponse).not.toContain("userId");
    expect(rawResponse).not.toContain("generation");

    const user = database.row<{
      id: string;
      name: string;
      email: string;
      email_verified: number;
      username: string;
      display_username: string;
    }>("SELECT * FROM learner_user");
    expect(user).toMatchObject({
      name: "learner.one",
      email_verified: 1,
      username: "learner.one",
      display_username: "learner.one",
    });
    expect(user?.email).toMatch(
      /^u-[A-Za-z0-9_-]{32}@accounts\.paretto\.invalid$/,
    );

    const credential = database.row<{
      account_id: string;
      provider_id: string;
      user_id: string;
      password: string;
    }>("SELECT * FROM learner_account");
    expect(credential).toMatchObject({
      account_id: user?.id,
      provider_id: "credential",
      user_id: user?.id,
    });
    expect(credential?.password).not.toBe(INITIAL_PASSWORD);
    await expect(
      verifyParettoPassword(INITIAL_PASSWORD, credential!.password),
    ).resolves.toBe(true);

    const state = database.row<{
      user_id: string;
      generation_id: string;
    }>("SELECT * FROM learner_recovery_state");
    const storedCodes = database.rows<{
      code_hash: string;
      user_id: string;
      generation_id: string;
    }>("SELECT * FROM learner_recovery_codes ORDER BY code_hash");
    expect(state?.user_id).toBe(user?.id);
    expect(storedCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(
      new Set(storedCodes.map((row) => row.generation_id)),
    ).toEqual(new Set([state?.generation_id]));
    expect(storedCodes.every((row) => /^[0-9a-f]{64}$/.test(row.code_hash)))
      .toBe(true);
    for (const code of receipt.recoveryCodes) {
      const hash = await hashSubmittedRecoveryCode(user!.id, code);
      expect(storedCodes.some((row) => row.code_hash === hash)).toBe(true);
      expect(JSON.stringify(storedCodes)).not.toContain(code);
    }
  });

  it("rolls back every account row when any atomic registration statement fails", async () => {
    const database = useDatabase();
    installTurnstile();
    database.failNextBatchAt = 5;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await REGISTER(
      accountRequest(
        "/api/account/register",
        registrationBody("atomic-learner"),
      ),
    );
    expect(response.status).toBe(503);
    expect(database.scalar("SELECT count(*) FROM learner_user")).toBe(0);
    expect(database.scalar("SELECT count(*) FROM learner_account")).toBe(0);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_state"),
    ).toBe(0);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_codes"),
    ).toBe(0);
  });

  it("handles duplicate IDs without partial rows or leaking the existing account", async () => {
    const database = useDatabase();
    installTurnstile();
    const first = await register("duplicate-id");
    const firstUserId = database.row<{ id: string }>(
      "SELECT id FROM learner_user",
    )!.id;

    const duplicate = await REGISTER(
      accountRequest(
        "/api/account/register",
        registrationBody("DUPLICATE-ID"),
      ),
    );
    expect(duplicate.status).toBe(409);
    const raw = await duplicate.text();
    expect(raw).toContain("PARETTO_ID_TAKEN");
    expect(raw).not.toContain(firstUserId);
    expect(raw).not.toContain(".invalid");
    expect(raw).not.toContain(first.recoveryCodes[0]);
    expect(database.scalar("SELECT count(*) FROM learner_user")).toBe(1);
    expect(database.scalar("SELECT count(*) FROM learner_account")).toBe(1);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_state"),
    ).toBe(1);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_codes"),
    ).toBe(RECOVERY_CODE_COUNT);
  });

  it("signs in through the protected route with a sanitized response and server cookie", async () => {
    const database = useDatabase();
    installTurnstile();
    await register("signed-in-learner");

    const response = await signIn("signed-in-learner");
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({
      signedIn: true,
      username: "signed-in-learner",
    });
    expect(raw).not.toContain(".invalid");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("password");
    expect(raw).not.toContain(
      database.row<{ id: string }>("SELECT id FROM learner_user")!.id,
    );
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toMatch(
      /(?:__Secure-)?paretto\.session_token=[^;]+/,
    );
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(1);
  });

  it("atomically rehashes a retained password-pepper verifier after successful sign-in", async () => {
    const database = useDatabase();
    installTurnstile();
    const retainedSecret =
      "test-retained-account-password-pepper-with-at-least-32-characters";
    setCloudflareEnv({
      DB: database as unknown as D1Database,
      ...AUTH_BINDINGS,
      PARETTO_PASSWORD_PEPPERS: JSON.stringify({
        current: "old",
        keys: { old: retainedSecret },
      }),
    });
    await register("pepper-rotation-learner");
    const retainedVerifier = database.row<{ password: string }>(
      "SELECT password FROM learner_account",
    )!.password;
    expect(retainedVerifier).toContain("$old$");

    setCloudflareEnv({
      DB: database as unknown as D1Database,
      ...AUTH_BINDINGS,
      PARETTO_PASSWORD_PEPPERS: JSON.stringify({
        current: "new",
        keys: {
          new: "test-current-account-password-pepper-with-at-least-32-characters",
          old: retainedSecret,
        },
      }),
    });
    const response = await signIn("pepper-rotation-learner");
    expect(response.status).toBe(200);
    const currentVerifier = database.row<{ password: string }>(
      "SELECT password FROM learner_account",
    )!.password;
    expect(currentVerifier).toContain("$new$");
    expect(currentVerifier).not.toBe(retainedVerifier);
    await expect(
      verifyParettoPassword(INITIAL_PASSWORD, currentVerifier),
    ).resolves.toBe(true);
  });

  it("does not reveal whether a Paretto ID exists when sign-in fails", async () => {
    useDatabase();
    installTurnstile();
    await register("known-learner");

    const wrongPassword = await SIGN_IN(
      accountRequest(
        "/api/account/sign-in",
        signInBody("known-learner", "wrong password"),
      ),
    );
    const missingUser = await SIGN_IN(
      accountRequest(
        "/api/account/sign-in",
        signInBody("missing-learner", "wrong password"),
      ),
    );
    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await missingUser.text());
  });

  it("blocks raw Better Auth account paths and direct provider tokens with one generic response", async () => {
    useDatabase();
    const identifier = "do-not-echo-this-id";
    const paths = [
      ["/api/auth/sign-up/email", "POST"],
      ["/api/auth/sign-in/email", "POST"],
      ["/api/auth/sign-in/username", "POST"],
      ["/api/auth/is-username-available", "GET"],
      ["/api/auth/request-password-reset", "POST"],
      ["/api/auth/reset-password/private-token", "POST"],
      ["/api/auth/change-password", "POST"],
      ["/api/auth/list-sessions", "GET"],
      ["/api/auth/get-access-token", "GET"],
      ["/api/auth/delete-user", "POST"],
      ["/api/auth/delete-user/callback", "POST"],
    ] as const;

    for (const [path, method] of paths) {
      const request = new Request(`${ORIGIN}${path}`, {
        method,
        headers:
          method === "POST"
            ? {
                "content-type": "application/json",
                origin: ORIGIN,
              }
            : undefined,
        body:
          method === "POST"
            ? JSON.stringify({
                username: identifier,
                email: `${identifier}@example.test`,
                password: INITIAL_PASSWORD,
              })
            : undefined,
      });
      const response =
        method === "POST" ? await AUTH_POST(request) : await AUTH_GET(request);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      const raw = await response.text();
      expect(JSON.parse(raw)).toEqual({
        code: "ACCOUNT_ROUTE_DISABLED",
        error: "Use Paretto's protected account flow.",
      });
      expect(raw).not.toContain(identifier);
      expect(raw).not.toContain(".invalid");
    }

    const directProviderToken = await AUTH_POST(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
        },
        body: JSON.stringify({
          provider: "apple",
          idToken: { token: "untrusted-direct-provider-token" },
        }),
      }),
    );
    expect(directProviderToken.status).toBe(403);
    expect(await directProviderToken.json()).toEqual({
      code: "ACCOUNT_ROUTE_DISABLED",
      error: "Use Paretto's protected account flow.",
    });

    const oversizedSocialBody = await AUTH_POST(
      new Request(`${ORIGIN}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
        },
        body: JSON.stringify({
          provider: "apple",
          padding: "x".repeat(20 * 1024),
        }),
      }),
    );
    expect(oversizedSocialBody.status).toBe(403);
    expect(await oversizedSocialBody.json()).toEqual({
      code: "ACCOUNT_ROUTE_DISABLED",
      error: "Use Paretto's protected account flow.",
    });
  });

  it("requires and verifies the current password before credential-account deletion", async () => {
    const database = useDatabase();
    installTurnstile();
    await register("deletion-learner");
    const signedIn = await signIn("deletion-learner");
    const cookie = responseCookie(signedIn);

    const missing = await DELETE_ACCOUNT(
      accountRequest(
        "/api/account/delete",
        { password: "" },
        { cookie },
      ),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      code: "PASSWORD_REQUIRED",
      error: "Enter your current password before deleting this account.",
    });

    const incorrect = await DELETE_ACCOUNT(
      accountRequest(
        "/api/account/delete",
        { password: "not the current password" },
        { cookie },
      ),
    );
    expect(incorrect.status).toBe(401);
    expect(await incorrect.json()).toEqual({
      code: "INVALID_PASSWORD",
      error: "The current password is incorrect.",
    });
    expect(database.scalar("SELECT count(*) FROM learner_user")).toBe(1);
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(1);
  });

  it("rotates every recovery code once, changes the password, and revokes every session", async () => {
    const database = useDatabase();
    installTurnstile();
    const receipt = await register("recoverable-learner");
    const signedIn = await signIn("recoverable-learner");
    const userId = database.row<{ id: string }>(
      "SELECT id FROM learner_user WHERE username = 'recoverable-learner'",
    )!.id;
    insertExtraSession(database, userId);
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(2);
    const oldGeneration = database.row<{ generation_id: string }>(
      "SELECT generation_id FROM learner_recovery_state WHERE user_id = ?",
      userId,
    )!.generation_id;

    const response = await recover(
      "recoverable-learner",
      receipt.recoveryCodes[0],
      NEXT_PASSWORD,
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    const result = JSON.parse(raw) as {
      recovered: boolean;
      username: string;
      recoveryCodes: string[];
      sessionsRevoked: boolean;
    };
    expect(result).toMatchObject({
      recovered: true,
      username: "recoverable-learner",
      sessionsRevoked: true,
    });
    expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(raw).not.toContain(".invalid");
    expect(raw).not.toContain(userId);
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(0);

    const credential = database.row<{ password: string }>(
      "SELECT password FROM learner_account WHERE user_id = ?",
      userId,
    )!;
    await expect(
      verifyParettoPassword(NEXT_PASSWORD, credential.password),
    ).resolves.toBe(true);
    await expect(
      verifyParettoPassword(INITIAL_PASSWORD, credential.password),
    ).resolves.toBe(false);

    const state = database.row<{ generation_id: string }>(
      "SELECT generation_id FROM learner_recovery_state WHERE user_id = ?",
      userId,
    )!;
    expect(state.generation_id).not.toBe(oldGeneration);
    expect(
      database.scalar(
        "SELECT count(*) FROM learner_recovery_codes WHERE user_id = ? AND generation_id = ?",
        userId,
        state.generation_id,
      ),
    ).toBe(RECOVERY_CODE_COUNT);
    for (const oldCode of receipt.recoveryCodes) {
      const oldHash = await hashSubmittedRecoveryCode(userId, oldCode);
      expect(
        database.scalar(
          "SELECT count(*) FROM learner_recovery_codes WHERE code_hash = ?",
          oldHash!,
        ),
      ).toBe(0);
    }

    const usedAgain = await recover(
      "recoverable-learner",
      receipt.recoveryCodes[0],
      "third correct horse battery staple",
    );
    expect(usedAgain.status).toBe(400);
    expect(await usedAgain.json()).toEqual({
      error:
        "The Paretto ID or recovery code is invalid or has already been used.",
      code: "INVALID_RECOVERY",
    });

    const oldCookie = responseCookie(signedIn);
    const oldSession = await AUTH_GET(
      new Request(`${ORIGIN}/api/auth/get-session`, {
        headers: { cookie: oldCookie },
      }),
    );
    expect(await oldSession.json()).toBeNull();
  });

  it("allows exactly one concurrent recovery generation winner", async () => {
    const database = useDatabase();
    installTurnstile();
    const receipt = await register("concurrent-learner");
    const userId = database.row<{ id: string }>(
      "SELECT id FROM learner_user",
    )!.id;
    insertExtraSession(database, userId);

    const [first, second] = await Promise.all([
      recover(
        "concurrent-learner",
        receipt.recoveryCodes[1],
        "first concurrent password is secure",
      ),
      recover(
        "concurrent-learner",
        receipt.recoveryCodes[2],
        "second concurrent password is secure",
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 400 ? first : second;
    const winnerBody = (await winner.json()) as {
      recoveryCodes: string[];
    };
    expect(winnerBody.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(await loser.json()).toMatchObject({
      code: "INVALID_RECOVERY",
    });
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(0);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_codes"),
    ).toBe(RECOVERY_CODE_COUNT);

    const credential = database.row<{ password: string }>(
      "SELECT password FROM learner_account",
    )!;
    const firstWon = await verifyParettoPassword(
      "first concurrent password is secure",
      credential.password,
    );
    const secondWon = await verifyParettoPassword(
      "second concurrent password is secure",
      credential.password,
    );
    expect([firstWon, secondWon].filter(Boolean)).toHaveLength(1);
  });

  it("replaces recovery codes from an authenticated profile without exposing the internal alias", async () => {
    const database = useDatabase();
    installTurnstile();
    const receipt = await register("profile-learner");
    const signedIn = await signIn("profile-learner");
    const cookie = responseCookie(signedIn);
    const userId = database.row<{ id: string }>(
      "SELECT id FROM learner_user",
    )!.id;

    const wrongPassword = await ROTATE_RECOVERY_CODES(
      accountRequest(
        "/api/account/recovery-codes",
        {
          password: "wrong current password",
          turnstileToken: "rotate-token",
        },
        { cookie },
      ),
    );
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({
      code: "INVALID_PASSWORD",
    });

    const response = await ROTATE_RECOVERY_CODES(
      accountRequest(
        "/api/account/recovery-codes",
        {
          password: INITIAL_PASSWORD,
          turnstileToken: "rotate-token",
        },
        { cookie },
      ),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    const result = JSON.parse(raw) as {
      replaced: boolean;
      username: string;
      recoveryCodes: string[];
    };
    expect(result).toMatchObject({
      replaced: true,
      username: "profile-learner",
    });
    expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(raw).not.toContain(".invalid");
    expect(raw).not.toContain(userId);
    expect(database.scalar("SELECT count(*) FROM learner_session")).toBe(1);
    expect(
      database.scalar("SELECT count(*) FROM learner_recovery_codes"),
    ).toBe(RECOVERY_CODE_COUNT);

    const retiredCode = await recover(
      "profile-learner",
      receipt.recoveryCodes[0],
      NEXT_PASSWORD,
    );
    expect(retiredCode.status).toBe(400);
  });

  it("sanitizes the authenticated session and never returns the synthetic .invalid email or session token", async () => {
    const database = useDatabase();
    installTurnstile();
    await register("private-session-learner");
    const signInResponse = await signIn("private-session-learner");
    const cookie = responseCookie(signInResponse);
    const stored = database.row<{
      id: string;
      email: string;
    }>("SELECT id, email FROM learner_user")!;
    const storedToken = database.row<{ token: string }>(
      "SELECT token FROM learner_session",
    )!.token;

    const response = await AUTH_GET(
      new Request(`${ORIGIN}/api/auth/get-session`, {
        headers: { cookie },
      }),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({
      session: {
        id: expect.any(String),
        expiresAt: expect.any(String),
      },
      user: {
        id: stored.id,
        name: "private-session-learner",
        username: "private-session-learner",
      },
    });
    expect(raw).not.toContain(stored.email);
    expect(raw).not.toContain(".invalid");
    expect(raw).not.toContain(storedToken);
    expect(raw).not.toContain("email");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("ipAddress");
    expect(raw).not.toContain("userAgent");
  });
});

function useDatabase(): AccountSqliteD1 {
  const database = new AccountSqliteD1();
  databases.push(database);
  setCloudflareEnv({
    DB: database as unknown as D1Database,
    ...AUTH_BINDINGS,
  });
  return database;
}

function registrationBody(username = "learner") {
  return {
    username,
    password: INITIAL_PASSWORD,
    turnstileToken: "register-token",
  };
}

function signInBody(
  username = "learner",
  password = INITIAL_PASSWORD,
) {
  return {
    username,
    password,
    turnstileToken: "sign-in-token",
  };
}

function accountRequest(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "cf-connecting-ip": "203.0.113.42",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function installTurnstile(
  overrides: Record<
    string,
    { action: string; hostname: string }
  > = {},
) {
  const defaults: Record<string, { action: string; hostname: string }> = {
    "register-token": {
      action: "account_create",
      hostname: "learn.example",
    },
    "sign-in-token": {
      action: "account_sign_in",
      hostname: "learn.example",
    },
    "recover-token": {
      action: "account_recover",
      hostname: "learn.example",
    },
    "rotate-token": {
      action: "recovery_codes_rotate",
      hostname: "learn.example",
    },
  };
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("secret")).toBe(TEST_TURNSTILE_SECRET);
      expect(form.get("remoteip")).toBe("203.0.113.42");
      const token = form.get("response") ?? "";
      const verification = overrides[token] ??
        defaults[token] ?? {
          action: "unexpected_action",
          hostname: "learn.example",
        };
      return new Response(
        JSON.stringify({
          success: true,
          action: verification.action,
          hostname: verification.hostname,
          challenge_ts: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function register(username: string): Promise<RegistrationReceipt> {
  const response = await REGISTER(
    accountRequest(
      "/api/account/register",
      registrationBody(username),
    ),
  );
  expect(response.status).toBe(201);
  return response.json() as Promise<RegistrationReceipt>;
}

function signIn(
  username: string,
  password = INITIAL_PASSWORD,
): Promise<Response> {
  return SIGN_IN(
    accountRequest(
      "/api/account/sign-in",
      signInBody(username, password),
    ),
  );
}

function recover(
  username: string,
  recoveryCode: string,
  password: string,
): Promise<Response> {
  return RECOVER(
    accountRequest("/api/account/recover", {
      username,
      recoveryCode,
      password,
      turnstileToken: "recover-token",
    }),
  );
}

function responseCookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("Expected an authentication cookie.");
  return raw.split(";", 1)[0];
}

function insertExtraSession(
  database: AccountSqliteD1,
  userId: string,
) {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO learner_session (
         id, expires_at, token, created_at, updated_at,
         ip_address, user_agent, user_id
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(
      crypto.randomUUID(),
      now + 60_000,
      `extra-session-${crypto.randomUUID()}`,
      now,
      now,
      userId,
    );
}
