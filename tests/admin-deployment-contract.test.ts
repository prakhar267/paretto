import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const PREPARE = resolve(ROOT, "scripts/prepare-cloudflare-config.mjs");
const VERIFY_SECRETS = resolve(
  ROOT,
  "scripts/verify-cloudflare-secrets.mjs",
);
const temporaryDirectories: string[] = [];

describe("administrator deployment credentials", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("preserves the guarded single-administrator controlled-beta path", async () => {
    const directory = await fixtureDirectory();
    await prepare(directory, ["--admin-email", "Solo@Paretto.Test"]);

    const configuration = JSON.parse(
      await readFile(join(directory, "wrangler.staging.jsonc"), "utf8"),
    );
    expect(configuration.vars).toMatchObject({
      LAUNCH_MODE: "controlled-beta",
      AUTH_EMAIL_FROM: "",
      SUPPORT_NOTIFICATION_EMAIL: "",
    });
    expect(configuration.vars.ADMIN_EMAILS).toBe("solo@paretto.test");
    expect(configuration.secrets.required).toContain(
      "ADMIN_PASSWORD_VERIFIER",
    );
    expect(configuration.secrets.required).not.toContain(
      "ADMIN_PASSWORD_VERIFIERS",
    );

    await writeSecretFile(directory, {
      ADMIN_PASSWORD_VERIFIER: verifier("solo-admin-access-key"),
    });
    await expect(verify(directory)).resolves.toMatchObject({
      stdout: expect.stringContaining("1 distinct administrator credential"),
    });
  });

  it("requires an exact distinct verifier map for two-person CMS governance", async () => {
    const directory = await fixtureDirectory();
    const emails = ["author@paretto.test", "reviewer@paretto.test"];
    await prepare(directory, ["--admin-emails", emails.join(",")]);

    const configuration = JSON.parse(
      await readFile(join(directory, "wrangler.staging.jsonc"), "utf8"),
    );
    expect(configuration.vars.ADMIN_EMAILS).toBe(emails.join(","));
    expect(configuration.secrets.required).toContain(
      "ADMIN_PASSWORD_VERIFIERS",
    );
    expect(configuration.secrets.required).not.toContain(
      "ADMIN_PASSWORD_VERIFIER",
    );

    await writeSecretFile(directory, {
      ADMIN_PASSWORD_VERIFIERS: JSON.stringify({
        [emails[0]]: verifier("author-access-key"),
        [emails[1]]: verifier("reviewer-access-key"),
      }),
    });
    await expect(verify(directory)).resolves.toMatchObject({
      stdout: expect.stringContaining("2 distinct administrator credentials"),
    });
  });

  it("fails closed for missing, reordered, extra, or shared administrator verifiers", async () => {
    const emails = ["author@paretto.test", "reviewer@paretto.test"];
    const invalidMaps = [
      {
        [emails[0]]: verifier("author-access-key"),
      },
      {
        [emails[1]]: verifier("reviewer-access-key"),
        [emails[0]]: verifier("author-access-key"),
      },
      {
        [emails[0]]: verifier("author-access-key"),
        [emails[1]]: verifier("reviewer-access-key"),
        "extra@paretto.test": verifier("extra-access-key"),
      },
      {
        [emails[0]]: verifier("shared-access-key"),
        [emails[1]]: verifier("shared-access-key"),
      },
    ];

    for (const invalid of invalidMaps) {
      const directory = await fixtureDirectory();
      await prepare(directory, ["--admin-emails", emails.join(",")]);
      await writeSecretFile(directory, {
        ADMIN_PASSWORD_VERIFIERS: JSON.stringify(invalid),
      });
      await expect(verify(directory)).rejects.toMatchObject({ code: 1 });
    }
  });

  it("requires complete transactional delivery only in public mode", async () => {
    const directory = await fixtureDirectory();
    await prepare(
      directory,
      ["--admin-email", "solo@paretto.test"],
      "public",
    );
    const configuration = JSON.parse(
      await readFile(join(directory, "wrangler.staging.jsonc"), "utf8"),
    );
    expect(configuration.vars).toMatchObject({
      LAUNCH_MODE: "public",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
      SUPPORT_NOTIFICATION_EMAIL: "support@paretto.test",
    });

    await writeSecretFile(directory, {
      ADMIN_PASSWORD_VERIFIER: verifier("solo-admin-access-key"),
    });
    await expect(verify(directory)).rejects.toMatchObject({ code: 1 });

    await writeSecretFile(
      directory,
      {
        ADMIN_PASSWORD_VERIFIER: verifier("solo-admin-access-key"),
        RESEND_API_KEY: "re_abcdefghijklmnop",
      },
    );
    await expect(verify(directory)).resolves.toMatchObject({
      stdout: expect.stringContaining("public delivery policy"),
    });
  });
});

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "paretto-admin-deploy-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    ["staging", "production"].map((environment) =>
      copyFile(
        resolve(ROOT, `wrangler.${environment}.jsonc.example`),
        join(directory, `wrangler.${environment}.jsonc.example`),
      ),
    ),
  );
  return directory;
}

async function prepare(
  directory: string,
  adminArguments: string[],
  launchMode: "controlled-beta" | "public" = "controlled-beta",
) {
  const deliveryArguments =
    launchMode === "public"
      ? [
          "--auth-email-from",
          "Paretto <accounts@paretto.test>",
          "--support-notification-email",
          "support@paretto.test",
        ]
      : [];
  return execFileAsync(
    process.execPath,
    [
      PREPARE,
      "--environment",
      "staging",
      "--account-id",
      "1234567890abcdef1234567890abcdef",
      "--database-name",
      "paretto-staging-contract",
      "--database-id",
      "12345678-1234-4234-8234-1234567890ab",
      ...adminArguments,
      "--turnstile-site-key",
      "1x00000000000000000000AA",
      "--auth-url",
      "https://staging.paretto.test",
      "--launch-mode",
      launchMode,
      ...deliveryArguments,
    ],
    { cwd: directory },
  );
}

async function writeSecretFile(
  directory: string,
  admin: Record<string, string>,
) {
  const values = {
    USER_KEY_SECRET: "user-key-material-abcdefghijklmnopqrstuvwxyz-012345",
    SUPPORT_RATE_LIMIT_SECRET:
      "support-rate-material-abcdefghijklmnopqrstuvwxyz-012345",
    BETTER_AUTH_RATE_LIMIT_SECRET:
      "auth-rate-material-abcdefghijklmnopqrstuvwxyz-012345",
    BETTER_AUTH_SECRET:
      "auth-signing-material-abcdefghijklmnopqrstuvwxyz-012345",
    ...admin,
    ADMIN_SESSION_SECRET:
      "admin-session-material-abcdefghijklmnopqrstuvwxyz-012345",
    TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  };
  const path = join(directory, ".env.staging");
  await rm(path, { force: true });
  await writeFile(
    path,
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    "utf8",
  );
  await chmod(path, 0o600);
}

function verify(directory: string) {
  return execFileAsync(
    process.execPath,
    [VERIFY_SECRETS, "--environment", "staging"],
    { cwd: directory },
  );
}

function verifier(value: string) {
  return `sha256$${createHash("sha256").update(value).digest("base64url")}`;
}
