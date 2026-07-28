import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { frenchAudioManifest } from "./build/french-audio-manifest-plugin";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const e2eTurnstileSiteKey =
  process.env.PARETTO_E2E_TURNSTILE_SITE_KEY?.trim() || null;

const localRuntimeVars = {
  // Local-only identity material makes a fresh checkout usable without
  // weakening or embedding any production credential.
  USER_KEY_SECRET: "local-only-paretto-user-key-secret-never-deploy",
  SUPPORT_RATE_LIMIT_SECRET:
    "local-only-paretto-support-rate-limit-secret-never-deploy",
  BETTER_AUTH_RATE_LIMIT_SECRET:
    "local-only-paretto-better-auth-rate-limit-secret-never-deploy",
  LAUNCH_MODE: "controlled-beta",
  WORKERS_PLAN: "free",
  NATIVE_API_ENABLED: "false",
  ...(e2eTurnstileSiteKey
    ? {
        // Cloudflare's public test credentials are included only in a
        // Playwright-managed build. They are intentionally not valid for a
        // production widget.
        TURNSTILE_SITE_KEY: e2eTurnstileSiteKey,
        TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
        BETTER_AUTH_SECRET:
          "local-only-paretto-browser-gate-auth-secret-never-deploy",
        BETTER_AUTH_URL: "https://localhost:4173",
      }
    : {}),
};

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          migrations_dir: "drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  triggers: {
    // Daily at 03:17 UTC; the odd minute avoids common top-of-hour load spikes.
    crons: ["17 3 * * *"],
  },
  assets: {
    binding: "ASSETS",
    html_handling: "none" as const,
  },
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      frenchAudioManifest(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config:
          command === "serve" || e2eTurnstileSiteKey
            ? {
                ...localBindingConfig,
                vars: localRuntimeVars,
              }
            : localBindingConfig,
      }),
    ],
  };
});
