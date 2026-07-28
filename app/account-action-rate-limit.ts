import { getDatabase } from "@/db";
import {
  createBetterAuthRateLimitStorage,
  requiredBetterAuthRateLimitSecret,
} from "@/app/learner-auth-rate-limit";

export type AccountAction =
  | "register"
  | "sign-in"
  | "recover"
  | "rotate-codes"
  | "delete";

const RULES: Record<
  AccountAction,
  {
    ip: { window: number; max: number };
    identifier: { window: number; max: number };
  }
> = {
  register: {
    ip: { window: 60 * 60, max: 5 },
    identifier: { window: 60 * 60, max: 5 },
  },
  "sign-in": {
    ip: { window: 15 * 60, max: 30 },
    identifier: { window: 15 * 60, max: 15 },
  },
  recover: {
    ip: { window: 60 * 60, max: 10 },
    identifier: { window: 60 * 60, max: 5 },
  },
  "rotate-codes": {
    // Rotation already requires a signed-in session plus the learner's
    // current password. Keep the account-specific cap strict while allowing
    // several learners behind one school, office, or household IP.
    ip: { window: 60 * 60, max: 20 },
    identifier: { window: 60 * 60, max: 5 },
  },
  delete: {
    ip: { window: 60 * 60, max: 5 },
    identifier: { window: 60 * 60, max: 5 },
  },
};

type AccountActionBindings = {
  BETTER_AUTH_RATE_LIMIT_SECRET?: unknown;
  USER_KEY_SECRET?: unknown;
  SUPPORT_RATE_LIMIT_SECRET?: unknown;
  BETTER_AUTH_SECRET?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
};

export async function consumeAccountActionQuota(
  request: Request,
  action: AccountAction,
  identifier: string,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as AccountActionBindings;
  const secret = requiredBetterAuthRateLimitSecret(bindings);
  const database = await getDatabase();
  const storage = createBetterAuthRateLimitStorage(database, secret);
  const ip = normalizeClientIp(request.headers.get("cf-connecting-ip"));
  const ipQuota = await storage.consume!(
    `paretto-account-action:v1:${action}:${ip}`,
    RULES[action].ip,
  );
  if (!ipQuota.allowed) return ipQuota;
  return storage.consume!(
    `paretto-account-identifier:v1:${action}:${identifier}`,
    RULES[action].identifier,
  );
}

function normalizeClientIp(value: string | null): string {
  const candidate = value?.trim().toLowerCase() ?? "";
  return candidate.length >= 3 &&
    candidate.length <= 128 &&
    !/[\u0000-\u0020\u007f]/.test(candidate)
    ? candidate
    : "unknown";
}
