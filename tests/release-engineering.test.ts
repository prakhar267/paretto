import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

describe("release engineering contracts", () => {
  it("commits cross-browser Playwright journeys without folding them into unit tests", async () => {
    const [
      packageSource,
      configuration,
      journeys,
      localAuthSeed,
      localRuntimeSetup,
      localWorker,
      workflow,
      nativeProject,
      releaseQa,
      productAcceptance,
    ] =
      await Promise.all([
        readFile(resolve(ROOT, "package.json"), "utf8"),
        readFile(resolve(ROOT, "playwright.config.ts"), "utf8"),
        readFile(resolve(ROOT, "e2e/learner-journeys.spec.ts"), "utf8"),
        readFile(resolve(ROOT, "e2e/seed-local-auth.mjs"), "utf8"),
        readFile(resolve(ROOT, "e2e/prepare-local-runtime.mjs"), "utf8"),
        readFile(resolve(ROOT, "e2e/start-local-worker.mjs"), "utf8"),
        readFile(resolve(ROOT, ".github/workflows/ci.yml"), "utf8"),
        readFile(resolve(ROOT, "ios/Paretto/project.yml"), "utf8"),
        readFile(resolve(ROOT, "docs/RELEASE-QA.md"), "utf8"),
        readFile(
          resolve(ROOT, "docs/PRODUCT-ACCEPTANCE-V1.3.md"),
          "utf8",
        ),
      ]);

    expect(packageSource).toContain('"test:e2e"');
    expect(packageSource).toContain('"test:e2e:gate"');
    expect(packageSource).not.toMatch(/"test":\s*"[^"]*test:e2e/);
    expect(packageSource).toContain('"build": "vinext build"');
    expect(packageSource).not.toMatch(
      /"(?:dev|build|start)":\s*"[A-Z_]+=.+?vinext/,
    );
    for (const project of ["chromium", "firefox", "webkit"]) {
      expect(configuration).toContain(`name: "${project}"`);
      expect(workflow).toContain(project);
    }
    expect(configuration).toContain("npm run build");
    expect(configuration).toContain("wrangler d1 migrations apply DB --local");
    expect(configuration).toContain("node e2e/start-local-worker.mjs");
    expect(configuration).toContain("--local-protocol https");
    expect(configuration).toContain("timeout: 120_000");
    expect(configuration).toContain("actionTimeout: 10_000");
    expect(configuration).toContain("navigationTimeout: 30_000");
    expect(configuration).toContain("retries: 0");
    expect(configuration).not.toContain(
      "retries: process.env.CI",
    );
    expect(configuration).toContain('trace: "retain-on-failure"');
    expect(configuration).toContain('serviceWorkers: "block"');
    expect(configuration).toContain("node e2e/prepare-local-runtime.mjs");
    expect(configuration).toContain("node e2e/seed-local-auth.mjs");
    expect(journeys).toContain("first five-card lesson");
    expect(journeys).toContain("setOffline(true)");
    expect(journeys).toContain("toBeFocused()");
    expect(journeys).toContain("axe.source");
    expect(journeys).toContain('reducedMotion: "reduce"');
    expect(journeys).toContain("font-size: 200%");
    expect(journeys).toContain('serviceWorkers: "allow"');
    expect(journeys).toContain("seeded verified email account");
    expect(journeys).toContain("Practice anyway");
    expect(journeys).toContain("See today’s result");
    expect(journeys).toContain("Export my progress");
    expect(journeys).toContain("survives a plaintext probe");
    expect(journeys).toContain("window.isSecureContext");
    expect(journeys).toContain('cookie.name.includes("session_token")');
    expect(configuration).not.toContain("BETTER_AUTH_TRUSTED_ORIGINS");
    expect(localAuthSeed).toContain('from "better-auth/crypto"');
    expect(localAuthSeed).toContain('"--local"');
    expect(localAuthSeed).not.toContain('"--remote"');
    expect(localAuthSeed).toContain("email_verified");
    expect(localAuthSeed).toContain("process.execPath");
    expect(localAuthSeed).toContain('"wrangler.js"');
    expect(localAuthSeed).not.toMatch(
      /wrangler\.cmd|node_modules[\s\S]+?\.bin/,
    );
    expect(localWorker).toContain('protocol !== "https"');
    expect(localWorker).toContain("unstable_getMiniflareWorkerOptions");
    expect(localWorker).toContain("new Miniflare({");
    expect(localWorker).toContain("unsafeHandleRuntimeRestart");
    expect(localWorker).toContain('engine: "miniflare-direct"');
    expect(localWorker).toContain("createHttpsServer({ key, cert }");
    expect(localWorker).toContain("publicUrl: publicOrigin");
    expect(localWorker).toContain("upstream: publicOrigin");
    expect(localWorker).toContain('"x-forwarded-proto": "https"');
    expect(localWorker).toContain('"x-forwarded-host"');
    expect(localWorker).toContain("withoutHopByHopHeaders");
    expect(localWorker).toContain("connectionTokens");
    expect(localWorker).toContain("requestHttp(");
    expect(localWorker).toContain('"openssl"');
    expect(localWorker).toContain(
      'defaultPersistRoot: resolve(persistDirectory, "v3")',
    );
    expect(localWorker).toContain("modules: workerModules");
    expect(localWorker).toContain('type: "ESModule"');
    expect(localWorker).toContain("delete workerOptions.modulesRules");
    expect(localWorker).toContain(
      "The local Worker backend exited unexpectedly",
    );
    expect(
      localWorker.match(
        /The local Worker backend exited unexpectedly/g,
      ),
    ).toHaveLength(1);
    expect(localWorker).toContain(
      "The acceptance proxy lost its Worker backend connection",
    );
    expect(localWorker).toContain("keepAlive: false");
    expect(localWorker).toContain(
      "downstreamAborted || shuttingDown",
    );
    expect(localWorker).toContain(
      'incoming.once("aborted", abortUpstream)',
    );
    expect(localWorker).toContain(
      'outgoing.once("close", abortUpstream)',
    );
    expect(localWorker).toContain(
      'error.code === "ECONNREFUSED"',
    );
    expect(localWorker).not.toMatch(
      /\["ECONNREFUSED",\s*"ECONNRESET"/,
    );
    expect(localWorker).toContain('"proxy-request-error"');
    expect(localWorker).toContain('"shutdown-started"');
    expect(localWorker).toContain('"shutdown-complete"');
    expect(localWorker).not.toContain('[wrangler, "dev"');
    expect(localWorker).not.toContain("process.platform");
    expect(localRuntimeSetup).toContain(
      '`test-results${sep}playwright-runtime`',
    );
    expect(workflow).toContain(
      "Compile and test the Staging configuration",
    );
    expect(workflow).toContain("-scheme Paretto-Staging");
    expect(workflow).toContain("-configuration Staging");
    expect(workflow).toContain("-only-testing:ParettoTests");
    expect(nativeProject).toMatch(
      /Staging:\n\s+ENABLE_TESTABILITY: YES\n\s+SWIFT_ACTIVE_COMPILATION_CONDITIONS: STAGING/,
    );
    expect(workflow).toContain(
      "Compile and inspect the Release configuration",
    );
    expect(workflow).toContain("-configuration Release");
    expect(workflow).toContain(
      "-destination 'generic/platform=iOS Simulator'",
    );
    expect(workflow).toContain('test "$audio_count" = "270"');
    expect(workflow).toContain('test -s "$app/fr/v1/idf-metro.wav"');
    expect(workflow).toContain("windows-chromium-compatibility:");
    expect(workflow).toContain("runs-on: windows-2022");
    expect(workflow).toContain(
      "Windows-hosted Chromium compatibility (not device certification)",
    );
    expect(workflow).not.toContain(
      "PLAYWRIGHT_SKIP_SEEDED_ACCOUNT_JOURNEY",
    );
    expect(journeys).not.toContain(
      "PLAYWRIGHT_SKIP_SEEDED_ACCOUNT_JOURNEY",
    );
    const browserJobStart = workflow.indexOf("\n  browser-gate:");
    const windowsJobStart = workflow.indexOf(
      "\n  windows-chromium-compatibility:",
    );
    const nativeJobStart = workflow.indexOf("\n  native-gate:");
    const browserJob = workflow.slice(browserJobStart, windowsJobStart);
    const windowsJob = workflow.slice(windowsJobStart, nativeJobStart);
    const nativeJob = workflow.slice(nativeJobStart);
    expect(browserJob).not.toContain(
      "PLAYWRIGHT_SKIP_SEEDED_ACCOUNT_JOURNEY",
    );
    expect(browserJob).toContain(
      'npm run test:e2e:gate -- --project="${{ matrix.browser }}"',
    );
    expect(browserJob).toContain("PARETTO_E2E_RUNTIME_LOG_PATH:");
    expect(browserJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/${{ matrix.browser }}",
    );
    expect(browserJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/${{ matrix.browser }}/",
    );
    expect(windowsJob).not.toContain(
      "PLAYWRIGHT_SKIP_SEEDED_ACCOUNT_JOURNEY",
    );
    expect(windowsJob).toContain("PARETTO_E2E_RUNTIME_LOG_PATH:");
    expect(windowsJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/windows-chromium",
    );
    expect(windowsJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/windows-chromium/",
    );
    for (const resultName of ["staging", "iphone", "ipad"]) {
      expect(nativeJob).toContain(
        `-resultBundlePath "$RUNNER_TEMP/paretto-native-results/${resultName}.xcresult"`,
      );
      expect(nativeJob).toContain(
        `tee "$RUNNER_TEMP/paretto-native-results/${resultName}.log"`,
      );
    }
    for (const logName of ["paretto-core", "paretto-package"]) {
      expect(nativeJob).toContain(
        `tee "$RUNNER_TEMP/paretto-native-results/${logName}.log"`,
      );
    }
    expect(nativeJob.match(/set -euo pipefail/g)).toHaveLength(6);
    expect(nativeJob).not.toMatch(/-retry-tests-on-failure|-test-iterations/);
    expect(nativeJob).toContain("Preserve native XCTest evidence");
    expect(nativeJob).toContain("if: ${{ !cancelled() }}");
    expect(nativeJob).toContain(
      "name: native-xcode-results-${{ github.run_attempt }}",
    );
    expect(nativeJob).toContain(
      "${{ runner.temp }}/paretto-native-results/",
    );
    expect(nativeJob).toContain("retention-days: 14");
    expect(workflow.match(/github\.event\.pull_request\.head\.sha/g)).toHaveLength(
      4,
    );
    expect(workflow).toContain(
      "npm run test:e2e -- --project=chromium",
    );
    expect(windowsJob).not.toContain("test:e2e:gate");
    expect(workflow).toContain(
      "It is not evidence for Windows 11, Microsoft Edge, high",
    );
    expect(configuration).toContain('process.platform === "win32"');
    expect(configuration).toContain("`exec ${localWorkerCommand}`");
    for (const releaseDocument of [releaseQa, productAcceptance]) {
      expect(releaseDocument).toContain("direct Miniflare");
      expect(releaseDocument).not.toContain(
        "skipped on hosted Windows",
      );
      expect(releaseDocument).not.toContain(
        "Wrangler diagnostic log",
      );
    }
  });

  it("keeps deployment automation environment-scoped and smoke tests read-only", async () => {
    const [packageSource, deploymentWorkflow, smoke] = await Promise.all([
      readFile(resolve(ROOT, "package.json"), "utf8"),
      readFile(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8"),
      readFile(resolve(ROOT, "scripts/smoke-deployment.mjs"), "utf8"),
    ]);

    expect(packageSource).toContain('"smoke:deployment"');
    expect(deploymentWorkflow).toContain("workflow_dispatch:");
    expect(deploymentWorkflow).toContain("environment:");
    expect(deploymentWorkflow).toContain("CLOUDFLARE_API_TOKEN");
    expect(deploymentWorkflow).toContain(
      "production:refs/tags/v*",
    );
    expect(deploymentWorkflow).not.toContain(
      "production:refs/heads/main",
    );
    expect(deploymentWorkflow).toContain(
      "production requires an exact v* release tag",
    );
    expect(deploymentWorkflow).toContain("actions: read");
    expect(deploymentWorkflow).toContain("release-policy:");
    expect(deploymentWorkflow).toContain("needs: release-policy");
    expect(deploymentWorkflow).toContain(
      "Require successful exact-SHA CI before production",
    );
    expect(deploymentWorkflow).toContain(
      "node scripts/verify-github-ci-run.mjs",
    );
    expect(deploymentWorkflow).not.toContain(
      "Apply reviewed D1 migrations",
    );
    expect(deploymentWorkflow).not.toContain(
      "Deploy the reviewed Worker artifact",
    );
    expect(deploymentWorkflow).toContain(
      "browser: [chromium, firefox, webkit]",
    );
    expect(deploymentWorkflow).toMatch(
      /needs:\s*\n\s+- release-policy\s*\n\s+- browser-gate/,
    );
    expect(deploymentWorkflow).toContain(
      'npm run test:e2e:gate -- --project="${{ matrix.browser }}"',
    );
    expect(deploymentWorkflow).toContain("Run mandatory read-only smoke tests");
    expect(deploymentWorkflow).toContain("npm run smoke:deployment");
    expect(deploymentWorkflow).toContain(
      "D1_BACKUP_ENCRYPTION_PASSPHRASE",
    );
    expect(deploymentWorkflow).toContain(
      "npx wrangler d1 time-travel info DB",
    );
    expect(deploymentWorkflow).toContain(
      "npx wrangler d1 export DB",
    );
    expect(deploymentWorkflow).toContain("-aes-256-cbc");
    expect(deploymentWorkflow).toContain("-pbkdf2");
    expect(deploymentWorkflow).toContain(
      'npm run --silent d1:export:verify -- "$roundtrip_export" > "$restore_report"',
    );
    expect(deploymentWorkflow).not.toContain(
      'npm run d1:export:verify -- "$roundtrip_export" > "$restore_report"',
    );
    expect(deploymentWorkflow).toContain(
      "Retain production D1 recovery evidence before migration",
    );
    expect(deploymentWorkflow).toContain("retention-days: 7");
    const recoveryCapture = deploymentWorkflow.indexOf(
      "Capture and encrypt production D1 recovery evidence",
    );
    const recoveryUpload = deploymentWorkflow.indexOf(
      "Retain production D1 recovery evidence before migration",
    );
    const migration = deploymentWorkflow.indexOf(
      "Apply verified D1 migrations",
    );
    expect(recoveryCapture).toBeGreaterThan(0);
    expect(recoveryUpload).toBeGreaterThan(recoveryCapture);
    expect(migration).toBeGreaterThan(recoveryUpload);
    const browserJobStart = deploymentWorkflow.indexOf(
      "\n  browser-gate:",
    );
    const deployJobStart = deploymentWorkflow.indexOf("\n  deploy:");
    const browserJob = deploymentWorkflow.slice(
      browserJobStart,
      deployJobStart,
    );
    expect(browserJobStart).toBeGreaterThan(0);
    expect(deployJobStart).toBeGreaterThan(browserJobStart);
    expect(browserJob).not.toContain("${{ secrets.");
    expect(browserJob).not.toContain("\n    environment:");
    expect(browserJob).toContain("PARETTO_E2E_RUNTIME_LOG_PATH:");
    expect(browserJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/${{ matrix.browser }}",
    );
    expect(browserJob).toContain(
      "${{ runner.temp }}/worker-runtime-logs/${{ matrix.browser }}/",
    );
    const jobEnvironmentStart = deploymentWorkflow.indexOf(
      "\n    env:",
      deployJobStart,
    );
    const stepsStart = deploymentWorkflow.indexOf(
      "\n    steps:",
      jobEnvironmentStart,
    );
    expect(jobEnvironmentStart).toBeGreaterThan(deployJobStart);
    expect(stepsStart).toBeGreaterThan(jobEnvironmentStart);
    expect(
      deploymentWorkflow.slice(jobEnvironmentStart, stepsStart),
    ).not.toContain("${{ secrets.");
    expect(smoke).toContain('method: "GET"');
    expect(smoke).not.toMatch(/method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
    expect(smoke).not.toContain("ADMIN_PASSWORD");
    expect(smoke).not.toContain("child_process");
    expect(smoke).not.toContain("/api/auth/get-session");
  });
});
