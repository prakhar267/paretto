import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLearnerAuth, learnerAuthReadiness } from "../app/learner-auth";
import { POST as AUTH_POST } from "../app/api/auth/[...all]/route";
import { getRuntimeConfigurationReadiness } from "../app/server-auth";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const BETTER_AUTH_RATE_LIMIT_SECRET =
  "test-better-auth-rate-limit-secret-with-at-least-32-characters";
const PASSWORD_PEPPER_KEYRING = JSON.stringify({
  current: "test-v1",
  keys: {
    "test-v1":
      "test-password-pepper-with-at-least-thirty-two-characters",
  },
});

describe("learner authentication configuration", () => {
  beforeEach(() => setCloudflareEnv({}));

  it("fails closed without the production signing secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(learnerAuthReadiness()).resolves.toEqual({
        configured: false,
        canonicalOrigin: false,
        rateLimit: false,
        emailPassword: true,
        parettoIdAccountCreation: false,
        recoveryCodes: false,
        emailAccountCreation: false,
        emailVerification: false,
        passwordReset: false,
        google: false,
        apple: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("enables the documented development-only local account service", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
    });
    try {
      await expect(learnerAuthReadiness()).resolves.toMatchObject({
        configured: true,
        canonicalOrigin: true,
        rateLimit: true,
        emailPassword: true,
        parettoIdAccountCreation: true,
        recoveryCodes: true,
        emailAccountCreation: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports only fully configured recovery and social providers", async () => {
    setCloudflareEnv({
      BETTER_AUTH_SECRET:
        "test-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      RESEND_API_KEY: "re_test_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      APPLE_WEB_CLIENT_ID: "apple-client",
    });

    await expect(learnerAuthReadiness()).resolves.toEqual({
      configured: true,
      canonicalOrigin: true,
      rateLimit: true,
      emailPassword: true,
      parettoIdAccountCreation: true,
      recoveryCodes: true,
      emailAccountCreation: false,
      emailVerification: true,
      passwordReset: true,
      google: true,
      apple: false,
    });
  });

  it("reports the support limiter only with an independent 32-character secret", async () => {
    const userKeySecret =
      "test-user-key-secret-with-at-least-thirty-two-characters";
    setCloudflareEnv({
      USER_KEY_SECRET: userKeySecret,
      SUPPORT_RATE_LIMIT_SECRET:
        "test-support-rate-secret-with-at-least-thirty-two-characters",
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      userKeySecret: true,
      supportRateLimitSecret: true,
    });

    setCloudflareEnv({
      USER_KEY_SECRET: userKeySecret,
      SUPPORT_RATE_LIMIT_SECRET: userKeySecret,
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      userKeySecret: true,
      supportRateLimitSecret: false,
    });
  });

  it("reports support notifications ready only with provider, sender, and operator delivery", async () => {
    setCloudflareEnv({
      RESEND_API_KEY: "re_test_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "support@paretto.test",
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      supportNotifications: true,
    });

    setCloudflareEnv({
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "support@paretto.test",
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      supportNotifications: false,
    });
  });

  it("reports the auth limiter only with its own independent secret", async () => {
    const userKeySecret =
      "test-user-key-secret-with-at-least-thirty-two-characters";
    setCloudflareEnv({
      USER_KEY_SECRET: userKeySecret,
      SUPPORT_RATE_LIMIT_SECRET:
        "test-support-rate-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET,
      BETTER_AUTH_SECRET:
        "test-better-auth-secret-with-at-least-thirty-two-characters",
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      ADMIN_SESSION_SECRET:
        "test-admin-session-secret-with-at-least-thirty-two-characters",
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      learnerAuthRateLimitSecret: true,
    });

    setCloudflareEnv({
      USER_KEY_SECRET: userKeySecret,
      BETTER_AUTH_RATE_LIMIT_SECRET: userKeySecret,
    });
    await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
      learnerAuthRateLimitSecret: false,
    });
  });

  it("requires an explicit canonical HTTPS origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setCloudflareEnv({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET:
        "test-better-auth-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET,
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
    });

    try {
      await expect(learnerAuthReadiness()).resolves.toMatchObject({
        configured: false,
        canonicalOrigin: false,
      });
      await expect(getRuntimeConfigurationReadiness()).resolves.toMatchObject({
        learnerAuthentication: false,
        learnerAuthOrigin: false,
        learnerParettoIdAccountCreation: false,
        learnerParettoIdSignIn: false,
        learnerRecoveryCodes: false,
        learnerEmailAccountCreation: false,
        learnerEmailVerification: false,
        learnerPasswordReset: false,
      });
      await expect(
        getLearnerAuth(
          new Request("https://request-origin.example/api/auth/get-session"),
        ),
      ).rejects.toThrow("explicit BETTER_AUTH_URL");

      setCloudflareEnv({
        DB: {} as D1Database,
        BETTER_AUTH_SECRET:
          "test-better-auth-secret-with-at-least-thirty-two-characters",
        BETTER_AUTH_RATE_LIMIT_SECRET,
        PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
        BETTER_AUTH_URL: "http://learn.example",
      });
      await expect(learnerAuthReadiness()).resolves.toMatchObject({
        configured: false,
        canonicalOrigin: false,
      });
      await expect(
        getLearnerAuth(
          new Request("https://request-origin.example/api/auth/get-session"),
        ),
      ).rejects.toThrow("requires HTTPS");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps Paretto ID ready while raw production email sign-up stays disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setCloudflareEnv({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET:
        "test-better-auth-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET,
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://learn.example",
    });

    try {
      await expect(learnerAuthReadiness()).resolves.toMatchObject({
        configured: true,
        canonicalOrigin: true,
        emailPassword: true,
        parettoIdAccountCreation: true,
        recoveryCodes: true,
        emailAccountCreation: false,
        emailVerification: false,
        passwordReset: false,
      });
      const auth = await getLearnerAuth(
        new Request("https://learn.example/api/auth/get-session"),
      );
      expect(auth.options.session?.cookieCache).toEqual({ enabled: false });
      expect(auth.options.account?.encryptOAuthTokens).toBe(true);
      expect(auth.options.rateLimit).toMatchObject({
        enabled: true,
        window: 60,
        max: 100,
      });
      expect(auth.options.rateLimit?.customStorage?.consume).toEqual(
        expect.any(Function),
      );
      expect("storage" in auth.options.rateLimit!).toBe(false);
      expect("modelName" in auth.options.rateLimit!).toBe(false);
      expect(auth.options.emailAndPassword).toMatchObject({
        enabled: true,
        disableSignUp: true,
        requireEmailVerification: true,
      });

      const response = await AUTH_POST(
        new Request("https://learn.example/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://learn.example",
          },
          body: JSON.stringify({
            name: "New learner",
            email: "new@example.test",
            password: "long-production-password",
          }),
        }),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      await expect(response.json()).resolves.toMatchObject({
        code: "ACCOUNT_ROUTE_DISABLED",
      });

      const signInResponse = await AUTH_POST(
        new Request("https://learn.example/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://learn.example",
          },
          body: JSON.stringify({
            email: "existing@example.test",
            password: "long-production-password",
          }),
        }),
      );
      expect(signInResponse.status).toBe(403);
      expect(signInResponse.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      await expect(signInResponse.json()).resolves.toMatchObject({
        code: "ACCOUNT_ROUTE_DISABLED",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps raw email account creation disabled when optional email delivery is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setCloudflareEnv({
      DB: {} as D1Database,
      BETTER_AUTH_SECRET:
        "test-better-auth-secret-with-at-least-thirty-two-characters",
      BETTER_AUTH_RATE_LIMIT_SECRET,
      PARETTO_PASSWORD_PEPPERS: PASSWORD_PEPPER_KEYRING,
      BETTER_AUTH_URL: "https://learn.example",
      RESEND_API_KEY: "re_test_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
    });

    try {
      await expect(learnerAuthReadiness()).resolves.toMatchObject({
        configured: true,
        parettoIdAccountCreation: true,
        recoveryCodes: true,
        emailAccountCreation: false,
        emailVerification: true,
        passwordReset: true,
      });
      const auth = await getLearnerAuth(
        new Request("https://learn.example/api/auth/get-session"),
      );
      expect(auth.options.emailAndPassword).toMatchObject({
        enabled: true,
        disableSignUp: true,
        requireEmailVerification: true,
      });
      expect(auth.options.emailVerification).toMatchObject({
        sendOnSignUp: true,
        sendOnSignIn: true,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
