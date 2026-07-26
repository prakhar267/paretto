import { defineConfig, devices } from "@playwright/test";

const defaultBaseURL = "https://localhost:4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? defaultBaseURL;
const startsLocalServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  // Several acceptance journeys intentionally cover a complete lesson,
  // persistence, recovery, and accessibility in one isolated browser state.
  // Keep individual actions tightly bounded below, while allowing slower
  // hosted WebKit runners enough time to finish the full business journey.
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : [["list"]],
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    ignoreHTTPSErrors: startsLocalServer,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: startsLocalServer
    ? {
        command:
          "node e2e/prepare-local-runtime.mjs && " +
          "npm run build && " +
          "npx wrangler d1 migrations apply DB --local " +
          "--cwd dist/server --config wrangler.json " +
          "--persist-to ../../test-results/playwright-runtime && " +
          "node e2e/seed-local-auth.mjs && " +
          "node e2e/start-local-worker.mjs --cwd dist/server --config wrangler.json " +
          "--local-protocol https --ip localhost --port 4173 " +
          "--persist-to ../../test-results/playwright-runtime " +
          "--var BETTER_AUTH_URL:https://localhost:4173 " +
          "--var BETTER_AUTH_SECRET:paretto-e2e-auth-secret-local-only-2026 " +
          "--var BETTER_AUTH_RATE_LIMIT_SECRET:paretto-e2e-auth-rate-limit-local-only-2026 " +
          "--var USER_KEY_SECRET:paretto-e2e-user-key-local-only-2026 " +
          "--show-interactive-dev-session=false --log-level warn",
        url: defaultBaseURL,
        ignoreHTTPSErrors: true,
        reuseExistingServer: false,
        timeout: 180_000,
        // Windows does not support POSIX SIGTERM process semantics. Let
        // Playwright terminate the disposable process tree there; retain the
        // graceful shutdown on Unix runners where Wrangler can consume it.
        ...(process.platform === "win32"
          ? {}
          : {
              gracefulShutdown: {
                signal: "SIGTERM" as const,
                timeout: 5_000,
              },
            }),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          // Cloudflare's documented public always-pass test site key. The test
          // replaces the widget API before exercising deterministic failures.
          PARETTO_E2E_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        },
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
