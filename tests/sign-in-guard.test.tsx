import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  readiness: vi.fn(),
  resolveSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("../app/learner-auth", () => ({
  learnerAuthReadiness: mocks.readiness,
}));

vi.mock("../app/server-auth", () => ({
  resolveLearnerAccountSession: mocks.resolveSession,
}));

vi.mock("../app/turnstile", () => ({
  loadTurnstilePublicSiteKey: vi.fn(async () => "test-site-key"),
}));

const { default: SignInPage } = await import("../app/sign-in/page");

describe("learner sign-in account switching guard", () => {
  beforeEach(() => {
    mocks.headers.mockReset();
    mocks.redirect.mockReset();
    mocks.readiness.mockReset();
    mocks.resolveSession.mockReset();
    mocks.headers.mockResolvedValue(
      new Headers({ host: "localhost:3000" }),
    );
    mocks.readiness.mockResolvedValue({
      configured: true,
      canonicalOrigin: true,
      rateLimit: true,
      emailPassword: true,
      parettoIdAccountCreation: true,
      recoveryCodes: true,
      emailAccountCreation: false,
      emailVerification: false,
      passwordReset: false,
      google: false,
      apple: false,
    });
  });

  it("redirects an already-authenticated learner before rendering a second-account sign-in form", async () => {
    mocks.resolveSession.mockResolvedValue({
      session: {
        session: {
          id: "session-a",
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        user: {
          id: "account-a",
          name: "Account A",
          image: null,
          username: "account-a",
        },
      },
    });
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(SignInPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.resolveSession).toHaveBeenCalledOnce();
  });
});
