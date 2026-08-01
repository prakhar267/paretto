import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function cssDeclaration(css: string, selector: string, property: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!rule) throw new Error(`Missing CSS rule: ${selector}`);
  const declaration = rule[1].match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`),
  );
  if (!declaration) throw new Error(`Missing ${property} in ${selector}`);
  return declaration[1].trim();
}

function resolveCssColor(css: string, value: string): string {
  const variable = value.match(/^var\((--[a-z0-9-]+)\)$/i)?.[1];
  if (!variable) return value;
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = css.match(
    new RegExp(`${escapedVariable}\\s*:\\s*(#[a-f0-9]{6})`, "i"),
  );
  if (!declaration) throw new Error(`Missing CSS variable: ${variable}`);
  return declaration[1];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(
      (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
    );
    const linear = channels.map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe("mobile, PWA, security, and launch contracts", () => {
  it("keeps scheduled retention heartbeat schema in migration and local development", async () => {
    const [migration, localDatabase, worker] = await Promise.all([
      readFile(
        resolve(ROOT, "drizzle/0009_thick_hercules.sql"),
        "utf8",
      ),
      readFile(resolve(ROOT, "db/index.ts"), "utf8"),
      readFile(resolve(ROOT, "worker/index.ts"), "utf8"),
    ]);
    for (const source of [migration, localDatabase]) {
      expect(source).toContain("retention_schedule_state");
      expect(source).toContain("monitoring_started_at");
      expect(source).toContain("scheduled_retention");
    }
    expect(migration).toContain(
      "CAST(unixepoch('now') AS INTEGER) * 1000",
    );
    expect(localDatabase).toContain(
      "INSERT OR IGNORE INTO retention_schedule_state",
    );
    expect(worker).toContain(
      "runScheduledRetentionMaintenance as runRetentionMaintenance",
    );
  });

  it("ships an installable iOS/Android web app without caching private routes", async () => {
    const [manifestText, serviceWorker, staticHeaders, css, worker, viteConfig] =
      await Promise.all([
        readFile(resolve(ROOT, "public/manifest.webmanifest"), "utf8"),
        readFile(resolve(ROOT, "public/service-worker.js"), "utf8"),
        readFile(resolve(ROOT, "public/_headers"), "utf8"),
        readFile(resolve(ROOT, "app/globals.css"), "utf8"),
        readFile(resolve(ROOT, "worker/index.ts"), "utf8"),
        readFile(resolve(ROOT, "vite.config.ts"), "utf8"),
      ]);
    const manifest = JSON.parse(manifestText) as {
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    expect(manifest.icons.every((icon) => icon.purpose.includes("maskable"))).toBe(true);
    await Promise.all(manifest.icons.map((icon) => access(resolve(ROOT, `public${icon.src}`))));

    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).toContain('const OFFLINE_SHELL_PATH = "/offline.html"');
    expect(serviceWorker).toMatch(/STATIC_ASSETS\s*=\s*\[\s*OFFLINE_SHELL_PATH/);
    expect(serviceWorker).toContain("networkNavigationWithOfflineShell");
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain("PUBLIC_AUDIO_PATH.test(url.pathname)");
    expect(serviceWorker).toContain('url.search === ""');
    expect(serviceWorker).toContain('credentials: "omit"');
    expect(serviceWorker).toContain("AUDIO_CACHE");
    expect(serviceWorker).toContain('request.headers.has("range")');
    expect(serviceWorker).toContain("response.status === 200");
    expect(serviceWorker).toContain("cache write skipped");
    expect(worker).toContain("async scheduled(");
    expect(worker).toContain(
      "runScheduledRetentionMaintenance as runRetentionMaintenance",
    );
    expect(worker).toContain("runRetentionMaintenance");
    expect(worker).toContain("runId: result.runId");
    expect(worker).toContain("throw error");
    expect(viteConfig).toContain('crons: ["17 3 * * *"]');
    expect(viteConfig).toContain('migrations_dir: "drizzle"');
    expect(viteConfig).toMatch(
      /assets:\s*\{\s*binding:\s*"ASSETS",\s*html_handling:\s*"none"/,
    );
    expect(staticHeaders).toMatch(
      /\/service-worker\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/,
    );
    expect(staticHeaders).toContain("Service-Worker-Allowed: /");
    expect(css).toMatch(/@media \(max-width: 760px\)/);
    expect(css).toMatch(/@media \(max-width: 480px\)/);
    expect(css).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.hero-card-art\s*\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.cream-button\s*\{[^}]*z-index:\s*3;[^}]*min-height:\s*52px;/,
    );
    expect(css).toContain("safe-area-inset-bottom");
    await access(resolve(ROOT, "public/offline.html"));
  });

  it("keeps production security headers and every launch document in source control", async () => {
    const worker = await readFile(resolve(ROOT, "worker/index.ts"), "utf8");
    for (const header of [
      "x-content-type-options",
      "referrer-policy",
      "x-frame-options",
      "permissions-policy",
      "strict-transport-security",
      "content-security-policy",
    ]) {
      expect(worker).toContain(header);
    }
    expect(worker).toContain("frame-ancestors 'none'");
    expect(worker).toContain("object-src 'none'");
    expect(worker).toContain('url.protocol !== "http:"');
    expect(worker).toContain('url.protocol = "https:"');
    expect(worker).toContain("status: 308");
    expect(worker).toContain(
      "frame-src https://challenges.cloudflare.com",
    );
    expect(worker).toContain(
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    );
    expect(worker).toContain('event: "request_completed"');
    expect(worker).toContain('event: "scheduled_retention_completed"');

    await Promise.all(
      [
        "app/privacy/page.tsx",
        "app/terms/page.tsx",
        "app/cookies/page.tsx",
        "app/accessibility/page.tsx",
        "app/attributions/page.tsx",
        "app/support/page.tsx",
        "docs/OPERATIONS.md",
        "docs/RELEASE-QA.md",
        "docs/LEGAL-LAUNCH-CHECKLIST.md",
      ].map((path) => access(resolve(ROOT, path))),
    );
  });

  it("guards direct Cloudflare staging and production deployment", async () => {
    const [
      worker,
      stagingTemplate,
      productionTemplate,
      verifier,
      preparer,
      secretVerifier,
      secretMaterializer,
      deployWorkflow,
      viteConfiguration,
      packageSource,
    ] = await Promise.all([
      readFile(resolve(ROOT, "worker/index.ts"), "utf8"),
      readFile(resolve(ROOT, "wrangler.staging.jsonc.example"), "utf8"),
      readFile(resolve(ROOT, "wrangler.production.jsonc.example"), "utf8"),
      readFile(resolve(ROOT, "scripts/verify-cloudflare-config.mjs"), "utf8"),
      readFile(resolve(ROOT, "scripts/prepare-cloudflare-config.mjs"), "utf8"),
      readFile(resolve(ROOT, "scripts/verify-cloudflare-secrets.mjs"), "utf8"),
      readFile(
        resolve(ROOT, "scripts/materialize-cloudflare-secrets.mjs"),
        "utf8",
      ),
      readFile(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8"),
      readFile(resolve(ROOT, "vite.config.ts"), "utf8"),
      readFile(resolve(ROOT, "package.json"), "utf8"),
    ]);

    expect(worker).not.toMatch(
      /handleImageOptimization|env\.IMAGES|\/_vinext\/image/,
    );
    for (const [environment, template] of [
      ["staging", stagingTemplate],
      ["production", productionTemplate],
    ]) {
      expect(template).toContain(
        environment === "staging"
          ? '"name": "paretto-staging"'
          : '"name": "paretto"',
      );
      expect(template).toContain('"main": "dist/server/index.js"');
      expect(template).toContain('"ADMIN_EMAILS": "__ADMIN_EMAILS__"');
      expect(template).toContain('"LAUNCH_MODE": "__LAUNCH_MODE__"');
      expect(template).toContain('"WORKERS_PLAN": "__WORKERS_PLAN__"');
      expect(template).toContain('"NATIVE_API_ENABLED": "false"');
      expect(template).toContain(
        '"TURNSTILE_SITE_KEY": "__TURNSTILE_SITE_KEY__"',
      );
      expect(JSON.parse(template).secrets.required).toEqual([
        "USER_KEY_SECRET",
        "SUPPORT_RATE_LIMIT_SECRET",
        "BETTER_AUTH_RATE_LIMIT_SECRET",
        "BETTER_AUTH_SECRET",
        "PARETTO_PASSWORD_PEPPERS",
        "__ADMIN_PASSWORD_SECRET_NAME__",
        "ADMIN_SESSION_SECRET",
        "TURNSTILE_SECRET",
      ]);
      expect(template).toContain('"directory": "dist/client"');
      expect(template).toContain('"binding": "ASSETS"');
      expect(JSON.parse(template).assets.html_handling).toBe("none");
      expect(JSON.parse(template).assets.run_worker_first).toEqual([
        "/",
        "/accessibility",
        "/admin",
        "/admin/*",
        "/api/*",
        "/auth/*",
        "/attributions",
        "/cookies",
        "/privacy",
        "/reset-password",
        "/sign-in",
        "/support",
        "/terms",
      ]);
      expect(template).toContain('"binding": "DB"');
      expect(template).toContain('"migrations_dir": "drizzle"');
      expect(template).toContain('"crons": ["17 3 * * *"]');
      expect(template).toContain('"enabled": true');
      expect(template).toContain("__CLOUDFLARE_ACCOUNT_ID__");
      expect(template).toContain("__D1_DATABASE_ID__");
      expect(template).not.toMatch(/"images"|"r2_buckets"|"limits"/);
    }
    expect(verifier).toContain("FREE_MAX_ASSET_FILES = 20_000");
    expect(verifier).toContain("FREE_MAX_ASSET_BYTES = 25 * 1024 * 1024");
    expect(verifier).toContain(
      "FREE_MAX_COMPRESSED_WORKER_MODULE_BYTES = 3_000_000",
    );
    expect(verifier).toContain("gzipSync(await readFile(path)");
    expect(verifier).toContain("database.migrations_dir === \"drizzle\"");
    expect(preparer).toContain("isPlaceholderDatabaseId");
    expect(secretVerifier).toContain(
      '"ADMIN_PASSWORD_VERIFIER"',
    );
    expect(secretVerifier).toContain(
      '"ADMIN_PASSWORD_VERIFIERS"',
    );
    expect(secretVerifier).toContain(
      "verifyAdminPasswordVerifierMap",
    );
    expect(secretVerifier).toContain("emailDeliveryConfigured");
    expect(secretVerifier).toContain(
      'emailDeliveryConfigured ? ["RESEND_API_KEY"] : []',
    );
    expect(secretVerifier).toContain('"SUPPORT_RATE_LIMIT_SECRET"');
    expect(secretVerifier).toContain(
      '"BETTER_AUTH_RATE_LIMIT_SECRET"',
    );
    expect(secretVerifier).toContain('"PARETTO_PASSWORD_PEPPERS"');
    expect(secretVerifier).toContain("metadata.mode & 0o077");
    expect(secretMaterializer).toContain(
      "Paretto Staging Support Rate Limit Secret",
    );
    expect(secretMaterializer).toContain(
      "Paretto Production Support Rate Limit Secret",
    );
    expect(secretMaterializer).toContain(
      "Paretto Staging Better Auth Rate Limit Secret",
    );
    expect(secretMaterializer).toContain(
      "Paretto Production Better Auth Rate Limit Secret",
    );
    expect(secretMaterializer).toContain(
      "Paretto Staging Password Pepper Keyring",
    );
    expect(secretMaterializer).toContain(
      "Paretto Production Password Pepper Keyring",
    );
    expect(secretMaterializer).toContain(
      "Paretto Staging Admin Password Verifiers",
    );
    expect(secretMaterializer).toContain(
      "Paretto Production Admin Password Verifiers",
    );
    expect(deployWorkflow).toContain(
      "SUPPORT_RATE_LIMIT_SECRET: ${{ secrets.SUPPORT_RATE_LIMIT_SECRET }}",
    );
    expect(deployWorkflow).toContain(
      "BETTER_AUTH_RATE_LIMIT_SECRET: ${{ secrets.BETTER_AUTH_RATE_LIMIT_SECRET }}",
    );
    expect(deployWorkflow).toContain(
      "PARETTO_PASSWORD_PEPPERS: ${{ secrets.PARETTO_PASSWORD_PEPPERS }}",
    );
    expect(deployWorkflow).toContain(
      "ADMIN_PASSWORD_VERIFIERS: ${{ secrets.ADMIN_PASSWORD_VERIFIERS }}",
    );
    expect(deployWorkflow).toContain(
      "vars.ADMIN_EMAILS || vars.ADMIN_EMAIL",
    );
    expect(deployWorkflow).toContain(
      "default: controlled-beta",
    );
    expect(deployWorkflow).toContain(
      "SUPPORT_EMAIL_DELIVERY_ENABLED=false",
    );
    expect(deployWorkflow).toContain(
      "SUPPORT_EMAIL_DELIVERY_ENABLED=true",
    );
    expect(deployWorkflow).toContain(
      'npm run smoke:deployment --',
    );
    expect(deployWorkflow).toContain(
      '--mode "$LAUNCH_MODE"',
    );
    expect(viteConfiguration).toContain(
      "local-only-paretto-support-rate-limit-secret-never-deploy",
    );
    expect(viteConfiguration).toContain(
      "local-only-paretto-better-auth-rate-limit-secret-never-deploy",
    );
    expect(packageSource).toContain('"cloudflare:dry-run:staging"');
    expect(packageSource).toContain('"cloudflare:dry-run:production"');
    expect(packageSource).toContain('"cloudflare:deploy:staging"');
    expect(packageSource).toContain('"cloudflare:deploy:production"');
    expect(packageSource).toContain(
      "--secrets-file .env.staging --keep-vars --strict",
    );
    expect(packageSource).toContain(
      "--secrets-file .env.production --keep-vars --strict",
    );
    expect(packageSource).not.toMatch(
      /"cloudflare:deploy:[^"]+":\s*"[^"]*dist\/server\/wrangler\.json/,
    );
  });

  it("keeps small learner-interface text at WCAG AA contrast", async () => {
    const css = await readFile(resolve(ROOT, "app/globals.css"), "utf8");
    const pairs = [
      {
        selector: ".gender-chip",
        foreground: cssDeclaration(css, ".gender-chip", "color"),
        background: cssDeclaration(css, ".gender-chip", "background"),
      },
      {
        selector: ".practice-gold .eyebrow",
        foreground: cssDeclaration(css, ".practice-gold .eyebrow", "color"),
        background: cssDeclaration(css, ".practice-gold", "background"),
      },
      {
        selector: ".practice-gold > p:not(.eyebrow)",
        foreground: cssDeclaration(
          css,
          ".practice-gold > p:not(.eyebrow)",
          "color",
        ),
        background: cssDeclaration(css, ".practice-gold", "background"),
      },
      {
        selector: ".collection-mini-grid span",
        foreground: cssDeclaration(css, ".collection-mini-grid span", "color"),
        background: cssDeclaration(css, ".collection-mini-grid span", "background"),
      },
    ];

    for (const pair of pairs) {
      const foreground = resolveCssColor(css, pair.foreground);
      const background = resolveCssColor(css, pair.background);
      expect(
        contrastRatio(foreground, background),
        `${pair.selector}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
