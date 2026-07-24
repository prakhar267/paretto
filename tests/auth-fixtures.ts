import {
  adminAuthConfiguration,
  createAdminSessionCookie,
} from "../app/admin-auth";

export const TEST_ADMIN_SESSION_SECRET =
  "test-admin-session-secret-keep-out-of-production-0001";
export const TEST_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
export const TEST_TURNSTILE_SECRET =
  "1x0000000000000000000000000000000AA";

export function learnerCookieHeaders(
  token = "L".repeat(43),
): Record<string, string> {
  return { cookie: `__Host-learner-session=${token}` };
}

export async function createAdminTestAuth(emails: readonly string[]) {
  const normalizedEmails = emails.map((email) => email.trim().toLowerCase());
  const entries = await Promise.all(
    normalizedEmails.map(async (email, index) => {
      const accessKey = `test-only-admin-access-key-${index}-${"x".repeat(36)}`;
      return [email, accessKey, await sha256Verifier(accessKey)] as const;
    }),
  );
  const bindings: Record<string, string> = {
    ADMIN_EMAILS: normalizedEmails.join(","),
    ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
  };
  if (entries.length === 1) {
    bindings.ADMIN_PASSWORD_VERIFIER = entries[0][2];
  } else {
    bindings.ADMIN_PASSWORD_VERIFIERS = JSON.stringify(
      Object.fromEntries(entries.map(([email, , verifier]) => [email, verifier])),
    );
  }

  const configuration = adminAuthConfiguration(bindings);
  if (!configuration) throw new Error("Test admin configuration is invalid.");
  const cookies = new Map<string, string>();
  for (const [email] of entries) {
    const serialized = await createAdminSessionCookie(
      configuration,
      email,
    );
    cookies.set(email, serialized.split(";", 1)[0]);
  }
  return {
    bindings,
    cookies,
    accessKeys: new Map(
      entries.map(([email, accessKey]) => [email, accessKey]),
    ),
  };
}

export function successfulTurnstileResponse(hostname = "pas-a-pas.test") {
  return new Response(
    JSON.stringify({
      success: true,
      hostname,
      action: "support_submit",
      challenge_ts: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

async function sha256Verifier(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256$${btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")}`;
}
