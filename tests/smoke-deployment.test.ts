import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");

describe("read-only deployment smoke", () => {
  it("checks readiness, auth pages, legal routes, and static assets with GET only", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    let redirectOffline = false;
    let health = {
      status: "ok",
      service: "paretto-web",
      version: "1.3.0",
      schemaRevision: "0012",
      launchMode: "public",
      productionReady: true,
      webReady: true,
      database: "ready",
      warnings: [] as string[],
      checks: {
        database: "ready",
        schema: "ready",
        retentionSchedule: "ready",
        accountDeletionQueue: "ready",
        supportNotificationQueue: "ready",
        userKeySecret: "ready",
        supportRateLimitSecret: "ready",
        learnerAuthRateLimitSecret: "ready",
        learnerAuthentication: "ready",
        learnerAuthOrigin: "ready",
        learnerEmailAccountCreation: "ready",
        learnerEmailVerification: "ready",
        learnerPasswordReset: "ready",
        learnerGoogleAuth: "optional-not-configured",
        learnerAppleAuth: "optional-not-configured",
        supportNotifications: "ready",
        adminAllowlist: "ready",
        adminAuthentication: "ready",
        turnstileSiteKey: "ready",
        turnstileSecret: "ready",
        nativeApi: "disabled",
        appleClientId: "native-disabled",
        appleServerCredentials: "native-disabled",
        appleTokenEncryptionSecret: "native-disabled",
        nativeSessionSecret: "native-disabled",
      },
    };
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
      });

      const path = request.url ?? "/";
      if (path === "/api/health") {
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "private, no-store",
        });
        response.end(JSON.stringify(health));
        return;
      }
      if (path === "/manifest.webmanifest") {
        response.writeHead(200, { "content-type": "application/manifest+json" });
        response.end(
          JSON.stringify({
            name: "Paretto — Learn French",
            short_name: "Paretto",
            start_url: "/",
          }),
        );
        return;
      }
      if (path === "/service-worker.js") {
        response.writeHead(200, {
          "content-type": "application/javascript",
          "service-worker-allowed": "/",
        });
        response.end('const STATIC_CACHE = "paretto-static-v4";');
        return;
      }
      if (path === "/offline.html") {
        if (redirectOffline) {
          response.writeHead(307, { location: "/offline" });
          response.end();
          return;
        }
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          "<!doctype html><title>Reconnect to Paretto</title>" +
            "<main>This offline page contains no learning or lesson data.</main>",
        );
        return;
      }
      if (path === "/icon-192.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(Buffer.alloc(1_024, 1));
        return;
      }
      if (path === "/audio/fr/v1/idf-metro.wav") {
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end(Buffer.alloc(1_024, 2));
        return;
      }

      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      });
      response.end("<!doctype html><title>Paretto</title><main>Paretto</main>");
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Test server did not expose a TCP port.");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const result = await execFileAsync(
        process.execPath,
        [resolve(ROOT, "scripts/smoke-deployment.mjs"), origin],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            ALLOW_HTTP_SMOKE: "1",
          },
        },
      );

      expect(JSON.parse(result.stdout)).toMatchObject({
        origin,
        version: "1.3.0",
        health: "ready",
        authPages: "ready",
        staticAssets: 5,
        mode: "read-only",
        launchMode: "public",
      });

      health = {
        ...health,
        launchMode: "controlled-beta",
        productionReady: false,
        warnings: [
          "Controlled beta mode is operational but is not approved for a broad public launch.",
          "Transactional email is not configured; email registration, verification, and password recovery remain unavailable.",
          "Operator support email delivery is not configured; tickets remain stored for authenticated administrator follow-up.",
        ],
        checks: {
          ...health.checks,
          learnerEmailAccountCreation: "disabled",
          learnerEmailVerification: "not-configured",
          learnerPasswordReset: "not-configured",
          supportNotifications: "not-configured",
        },
      };
      const controlled = await execFileAsync(
        process.execPath,
        [
          resolve(ROOT, "scripts/smoke-deployment.mjs"),
          origin,
          "--mode",
          "controlled-beta",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            ALLOW_HTTP_SMOKE: "1",
          },
        },
      );
      expect(JSON.parse(controlled.stdout)).toMatchObject({
        health: "ready",
        launchMode: "controlled-beta",
      });
      await expect(
        execFileAsync(
          process.execPath,
          [resolve(ROOT, "scripts/smoke-deployment.mjs"), origin],
          {
            cwd: ROOT,
            env: {
              ...process.env,
              ALLOW_HTTP_SMOKE: "1",
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      redirectOffline = true;
      await expect(
        execFileAsync(
          process.execPath,
          [
            resolve(ROOT, "scripts/smoke-deployment.mjs"),
            origin,
            "--mode",
            "controlled-beta",
          ],
          {
            cwd: ROOT,
            env: {
              ...process.env,
              ALLOW_HTTP_SMOKE: "1",
            },
          },
        ),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("/offline.html returned 307"),
      });
      expect(requests.length).toBeGreaterThan(10);
      expect(new Set(requests.map((request) => request.method))).toEqual(
        new Set(["GET"]),
      );
      expect(requests.map((request) => request.url)).toContain("/sign-in");
      expect(requests.map((request) => request.url)).toContain(
        "/reset-password",
      );
      expect(requests.map((request) => request.url)).not.toContain(
        "/api/auth/get-session",
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
