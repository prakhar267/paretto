import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/monitor-production-health.mjs");

function readyHealth(
  productionReady = true,
  launchMode: "controlled-beta" | "public" = "public",
  workersPlan: "free" | "paid" = launchMode === "public" ? "paid" : "free",
) {
  return {
    service: "paretto-web",
    status: "ok",
    version: "1.3.0",
    schemaRevision: "0014",
    webReady: true,
    launchMode,
    workersPlan,
    productionReady,
    database: "ready",
    warnings:
      launchMode === "controlled-beta"
        ? [
            "Controlled beta mode is operational but is not approved for a broad public launch.",
          ]
        : [],
    checks: {
      workersPlan:
        workersPlan === "paid" ? "paid" : "free-controlled-beta-only",
      schema: "ready",
      accountDeletionQueue: "ready",
      supportNotificationQueue: "ready",
      retentionSchedule: "ready",
    },
  };
}

async function withHealthServer(
  health: ReturnType<typeof readyHealth>,
  run: (origin: string, requests: string[]) => Promise<void>,
) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    response.end(JSON.stringify(health));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not expose a TCP port.");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    server.close();
    await once(server, "close");
  }
}

describe("independent production monitor", () => {
  it("accepts only a fully production-ready GET health response", async () => {
    await withHealthServer(readyHealth(), async (origin, requests) => {
      const result = await execFileAsync(process.execPath, [SCRIPT, origin], {
        cwd: ROOT,
        env: { ...process.env, ALLOW_HTTP_MONITOR: "1" },
      });
      expect(JSON.parse(result.stdout)).toMatchObject({
        origin,
        version: "1.3.0",
        schemaRevision: "0014",
        status: "ready",
        workersPlan: "paid",
      });
      expect(requests).toEqual(["GET /api/health"]);
    });
  });

  it("fails closed when the service reports degraded production readiness", async () => {
    await withHealthServer(readyHealth(false), async (origin) => {
      await expect(
        execFileAsync(process.execPath, [SCRIPT, origin], {
          cwd: ROOT,
          env: { ...process.env, ALLOW_HTTP_MONITOR: "1" },
        }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });

  it("rejects the free Workers plan for a public launch", async () => {
    await withHealthServer(
      readyHealth(true, "public", "free"),
      async (origin) => {
        await expect(
          execFileAsync(process.execPath, [SCRIPT, origin], {
            cwd: ROOT,
            env: { ...process.env, ALLOW_HTTP_MONITOR: "1" },
          }),
        ).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(
            "Public launch requires the Workers Paid plan.",
          ),
        });
      },
    );
  });

  it.each(["free", "paid"] as const)(
    "monitors a controlled beta on the %s Workers plan without treating it as public-ready",
    async (workersPlan) => {
      await withHealthServer(
        readyHealth(false, "controlled-beta", workersPlan),
        async (origin, requests) => {
          const result = await execFileAsync(
            process.execPath,
            [SCRIPT, origin, "--mode", "controlled-beta"],
            {
              cwd: ROOT,
              env: { ...process.env, ALLOW_HTTP_MONITOR: "1" },
            },
          );
          expect(JSON.parse(result.stdout)).toMatchObject({
            status: "ready",
            launchMode: "controlled-beta",
            workersPlan,
          });
          expect(requests).toEqual(["GET /api/health"]);

          await expect(
            execFileAsync(process.execPath, [SCRIPT, origin], {
              cwd: ROOT,
              env: { ...process.env, ALLOW_HTTP_MONITOR: "1" },
            }),
          ).rejects.toMatchObject({ code: 1 });
        },
      );
    },
  );

  it("keeps a deduplicated GitHub issue open until a successful probe", async () => {
    const workflow = await readFile(
      resolve(ROOT, ".github/workflows/monitor-production.yml"),
      "utf8",
    );
    expect(workflow).toContain('cron: "7 */6 * * *"');
    expect(workflow).toContain("PRODUCTION_APP_ORIGIN");
    expect(workflow).toContain("PRODUCTION_LAUNCH_MODE");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("gh issue create");
    expect(workflow).toContain("gh issue comment");
    expect(workflow).toContain("gh issue close");
    expect(workflow).toContain("simulate_failure");
    expect(workflow).not.toContain("${{ secrets.");
  });
});
