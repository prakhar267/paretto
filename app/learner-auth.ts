import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import {
  learnerAccount,
  learnerSession,
  learnerUser,
  learnerVerification,
} from "@/db/schema";
import { getDatabase } from "@/db";
import {
  sendTransactionalEmail,
  transactionalEmailConfigured,
} from "@/app/transactional-email";
import { prepareNativeIdentityBeforeLearnerDeletion } from "@/app/api/native/_lib/native-account-cleanup";
import {
  cancelStagedLearnerDataDeletion,
  processLearnerDataDeletionJob,
  stageLearnerDataDeletion,
} from "@/app/learner-data-deletion";
import {
  createBetterAuthRateLimitStorage,
  requiredBetterAuthRateLimitSecret,
  validBetterAuthRateLimitSecret,
} from "@/app/learner-auth-rate-limit";

const authSchema = {
  user: learnerUser,
  session: learnerSession,
  account: learnerAccount,
  verification: learnerVerification,
};

type LearnerAuthBindings = {
  USER_KEY_SECRET?: unknown;
  SUPPORT_RATE_LIMIT_SECRET?: unknown;
  BETTER_AUTH_SECRET?: unknown;
  BETTER_AUTH_RATE_LIMIT_SECRET?: unknown;
  BETTER_AUTH_URL?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
  GOOGLE_CLIENT_ID?: unknown;
  GOOGLE_CLIENT_SECRET?: unknown;
  APPLE_WEB_CLIENT_ID?: unknown;
  APPLE_WEB_CLIENT_SECRET?: unknown;
  RESEND_API_KEY?: unknown;
  AUTH_EMAIL_FROM?: unknown;
};

export type LearnerAuthReadiness = {
  configured: boolean;
  canonicalOrigin: boolean;
  rateLimit: boolean;
  emailPassword: true;
  emailAccountCreation: boolean;
  emailVerification: boolean;
  passwordReset: boolean;
  google: boolean;
  apple: boolean;
};

export async function getLearnerAuth(request: Request) {
  const bindings = await learnerAuthBindings();
  const origin = configuredOrigin(bindings, request);
  const secret = requiredSecret(bindings);
  const rateLimitSecret =
    requiredBetterAuthRateLimitSecret(bindings);
  const database = await getDatabase();
  const socialProviders = configuredSocialProviders(bindings);
  const passwordReset = configuredPasswordReset(bindings);
  const emailAccountCreation = configuredEmailAccountCreation(bindings);

  return betterAuth({
    appName: "Paretto",
    baseURL: origin,
    basePath: "/api/auth",
    secret,
    database: drizzleAdapter(
      drizzle(database, { schema: authSchema }),
      {
        provider: "sqlite",
        schema: authSchema,
        transaction: false,
      },
    ),
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const userKeySecret = nonEmpty(bindings.USER_KEY_SECRET);
          if (!userKeySecret || userKeySecret.length < 32) {
            throw new Error("Learner data deletion is not configured.");
          }
          const userKey = await accountLearningKey(userKeySecret, user.id);
          await stageLearnerDataDeletion(database, {
            userId: user.id,
            userKey,
          });
          try {
            const nativeAccountId =
              await prepareNativeIdentityBeforeLearnerDeletion(
                database,
                user.id,
              );
            if (nativeAccountId) {
              await stageLearnerDataDeletion(database, {
                userId: user.id,
                userKey,
                nativeAccountId,
              });
            }
          } catch (error) {
            await cancelStagedLearnerDataDeletion(database, user.id);
            throw error;
          }
        },
        afterDelete: async (user) => {
          try {
            await processLearnerDataDeletionJob(database, user.id);
          } catch (error) {
            // The authentication identity is already gone. Keep the request
            // successful so the browser clears its cache and cookie; the
            // durable job is retried by scheduled retention.
            console.error(
              JSON.stringify({
                event: "learner_data_deletion_queued_for_retry",
                userId: user.id,
                message:
                  error instanceof Error ? error.message : "unknown error",
                timestamp: new Date().toISOString(),
              }),
            );
          }
        },
      },
    },
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !emailAccountCreation,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // A delivery outage must never make an unverified production account
      // eligible to sign in. Existing verified learners remain available.
      requireEmailVerification:
        process.env.NODE_ENV === "production" || passwordReset,
      revokeSessionsOnPasswordReset: true,
      ...(passwordReset
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { email: string; name: string };
              url: string;
            }) => {
              await sendTransactionalEmail(bindings, {
                to: user.email,
                subject: "Reset your Paretto password",
                text: [
                  `Hello ${user.name || "there"},`,
                  "",
                  "Use this secure link to reset your Paretto password:",
                  url,
                  "",
                  "If you did not request this, you can ignore this email.",
                ].join("\n"),
              });
            },
          }
        : {}),
    },
    ...(passwordReset
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            expiresIn: 60 * 60,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string; name: string };
              url: string;
            }) => {
              await sendTransactionalEmail(bindings, {
                to: user.email,
                subject: "Verify your Paretto email",
                text: [
                  `Hello ${user.name || "there"},`,
                  "",
                  "Use this secure link to verify your Paretto email:",
                  url,
                  "",
                  "The link expires in one hour. If you did not create this account, you can ignore this email.",
                ].join("\n"),
              });
            },
          },
        }
      : {}),
    socialProviders,
    account: {
      // Google and Apple access, refresh, and ID tokens are credentials. Keep
      // them encrypted at rest in D1 and in encrypted backup exports.
      encryptOAuthTokens: true,
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: {
        // Always re-check the server-side session so revocation and account
        // deletion take effect on the next authenticated request.
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      customStorage: createBetterAuthRateLimitStorage(
        database,
        rateLimitSecret,
      ),
      window: 60,
      max: 100,
    },
    advanced: {
      cookiePrefix: "paretto",
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      useSecureCookies: origin.startsWith("https://"),
    },
    telemetry: {
      enabled: false,
    },
  });
}

export async function learnerAuthReadiness(): Promise<LearnerAuthReadiness> {
  const bindings = await learnerAuthBindings();
  const socialProviders = configuredSocialProviders(bindings);
  const passwordReset = configuredPasswordReset(bindings);
  const canonicalOrigin = configuredCanonicalOriginReady(bindings);
  const rateLimit =
    validBetterAuthRateLimitSecret(bindings) ||
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test";
  return {
    configured:
      (hasSecret(bindings.BETTER_AUTH_SECRET) ||
        process.env.NODE_ENV === "development") &&
      canonicalOrigin &&
      rateLimit,
    canonicalOrigin,
    rateLimit,
    emailPassword: true,
    emailAccountCreation: configuredEmailAccountCreation(bindings),
    emailVerification: passwordReset,
    passwordReset,
    google: Boolean(socialProviders.google),
    apple: Boolean(socialProviders.apple),
  };
}

function configuredOrigin(
  bindings: LearnerAuthBindings,
  request: Request,
): string {
  const configured =
    typeof bindings.BETTER_AUTH_URL === "string"
      ? bindings.BETTER_AUTH_URL.trim()
      : "";
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error(
      "Production learner authentication requires an explicit BETTER_AUTH_URL.",
    );
  }
  const value = configured || new URL(request.url).origin;
  const url = parseCanonicalOrigin(value);
  return url.origin;
}

function configuredSocialProviders(bindings: LearnerAuthBindings) {
  const googleClientId = nonEmpty(bindings.GOOGLE_CLIENT_ID);
  const googleClientSecret = nonEmpty(bindings.GOOGLE_CLIENT_SECRET);
  const appleClientId = nonEmpty(bindings.APPLE_WEB_CLIENT_ID);
  const appleClientSecret = nonEmpty(bindings.APPLE_WEB_CLIENT_SECRET);

  return {
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {}),
    ...(appleClientId && appleClientSecret
      ? {
          apple: {
            clientId: appleClientId,
            clientSecret: appleClientSecret,
          },
        }
      : {}),
  };
}

function configuredPasswordReset(bindings: LearnerAuthBindings): boolean {
  return transactionalEmailConfigured(bindings);
}

function configuredEmailAccountCreation(
  bindings: LearnerAuthBindings,
): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    transactionalEmailConfigured(bindings)
  );
}

function configuredCanonicalOriginReady(
  bindings: LearnerAuthBindings,
): boolean {
  const configured = nonEmpty(bindings.BETTER_AUTH_URL);
  if (!configured) return process.env.NODE_ENV !== "production";
  try {
    parseCanonicalOrigin(configured);
    return true;
  } catch {
    return false;
  }
}

function parseCanonicalOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid absolute URL.");
  }
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("BETTER_AUTH_URL must be an origin without a path.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:"
  ) {
    throw new Error("Production learner authentication requires HTTPS.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BETTER_AUTH_URL must use HTTP or HTTPS.");
  }
  return url;
}

function requiredSecret(bindings: LearnerAuthBindings): string {
  const secret = nonEmpty(bindings.BETTER_AUTH_SECRET);
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return "paretto-local-auth-secret-change-before-production";
  }
  throw new Error("BETTER_AUTH_SECRET is not configured.");
}

function hasSecret(value: unknown): boolean {
  return Boolean(nonEmpty(value)?.length && nonEmpty(value)!.length >= 32);
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

async function learnerAuthBindings(): Promise<LearnerAuthBindings> {
  const { env } = await import("cloudflare:workers");
  return env as LearnerAuthBindings;
}

async function accountLearningKey(
  secret: string,
  accountId: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`web-account:v1:${accountId}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
