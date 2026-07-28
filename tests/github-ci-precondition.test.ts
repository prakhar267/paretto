import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/verify-github-ci-run.mjs");
const RELEASE_VERSION = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
).version as string;
const RELEASE_TAG = `v${RELEASE_VERSION}`;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const JOBS = [
  "Web release gate (Node 22.x)",
  "Web release gate (Node 24.x)",
  "Browser journeys (chromium)",
  "Browser journeys (firefox)",
  "Browser journeys (webkit)",
  "Windows-hosted Chromium compatibility (not device certification)",
  "Native iPhone and iPad release gate (Xcode 26.3)",
];

async function withGitHubApi(
  jobs: string[],
  run: (apiOrigin: string, requests: string[]) => Promise<void>,
  headBranch = RELEASE_TAG,
  comparisonStatus = "ahead",
) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    expect(request.headers.authorization).toBe("Bearer test-token");
    response.setHeader("content-type", "application/json");
    if (request.url?.includes(`/compare/${SHA}...main`)) {
      response.end(
        JSON.stringify({
          status: comparisonStatus,
          base_commit: { sha: SHA },
        }),
      );
      return;
    }
    if (request.url?.includes("/actions/workflows/ci.yml/runs?")) {
      response.end(
        JSON.stringify({
          workflow_runs: [
            {
              id: 42,
              event: "push",
              status: "completed",
              conclusion: "success",
              head_branch: headBranch,
              head_sha: SHA,
              html_url: "https://github.example/actions/runs/42",
            },
          ],
        }),
      );
      return;
    }
    if (request.url?.includes("/actions/runs/42/jobs?")) {
      response.end(
        JSON.stringify({
          jobs: jobs.map((name) => ({
            name,
            status: "completed",
            conclusion: "success",
          })),
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test GitHub API did not expose a TCP port.");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function verifierEnvironment(apiOrigin: string) {
  return {
    ...process.env,
    ALLOW_HTTP_GITHUB_API: "1",
    GITHUB_API_URL: apiOrigin,
    GITHUB_REPOSITORY: "prakhar267/paretto",
    GITHUB_REF: `refs/tags/${RELEASE_TAG}`,
    GITHUB_REF_NAME: RELEASE_TAG,
    GITHUB_SHA: SHA,
    GITHUB_TOKEN: "test-token",
  };
}

describe("exact-SHA GitHub CI production precondition", () => {
  it("accepts only after every required job passed on the exact commit", async () => {
    await withGitHubApi(JOBS, async (apiOrigin, requests) => {
      const result = await execFileAsync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        env: verifierEnvironment(apiOrigin),
      });
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "verified",
        releaseTag: RELEASE_TAG,
        sourceSha: SHA,
        workflowRunId: 42,
        requiredJobs: 7,
      });
      expect(requests).toHaveLength(3);
    });
  });

  it("fails closed when any required CI job is absent", async () => {
    await withGitHubApi(JOBS.slice(0, -1), async (apiOrigin) => {
      await expect(
        execFileAsync(process.execPath, [SCRIPT], {
          cwd: ROOT,
          env: verifierEnvironment(apiOrigin),
        }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });

  it("does not accept a branch run that happens to share the tag SHA", async () => {
    await withGitHubApi(
      JOBS,
      async (apiOrigin, requests) => {
        await expect(
          execFileAsync(process.execPath, [SCRIPT], {
            cwd: ROOT,
            env: verifierEnvironment(apiOrigin),
          }),
        ).rejects.toMatchObject({ code: 1 });
        expect(requests).toHaveLength(2);
      },
      "main",
    );
  });

  it("rejects a green tag whose commit is not reachable from main", async () => {
    await withGitHubApi(
      JOBS,
      async (apiOrigin, requests) => {
        await expect(
          execFileAsync(process.execPath, [SCRIPT], {
            cwd: ROOT,
            env: verifierEnvironment(apiOrigin),
          }),
        ).rejects.toMatchObject({ code: 1 });
        expect(requests).toHaveLength(1);
      },
      RELEASE_TAG,
      "diverged",
    );
  });

  it("rejects duplicate evidence for any required CI job", async () => {
    await withGitHubApi([...JOBS, JOBS[0]], async (apiOrigin) => {
      await expect(
        execFileAsync(process.execPath, [SCRIPT], {
          cwd: ROOT,
          env: verifierEnvironment(apiOrigin),
        }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });
});
