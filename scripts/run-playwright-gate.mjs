import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const playwrightCli = createRequire(import.meta.url).resolve(
  "@playwright/test/cli",
);

export const WRANGLER_EXIT_MARKER =
  "The local Wrangler backend exited unexpectedly";

const RETRY_NOTICE =
  "\n[playwright-gate] The disposable Wrangler backend exited unexpectedly. " +
  "Retrying the complete Playwright invocation once with a clean runtime.\n";

export async function runPlaywrightGate({
  arguments_ = process.argv.slice(2),
  invoke = runPlaywrightInvocation,
  retryOutput = process.stderr,
} = {}) {
  const first = await invoke(arguments_);
  if (succeeded(first) || !first.wranglerExitedUnexpectedly) {
    return first;
  }

  retryOutput.write(RETRY_NOTICE);

  // A new Playwright CLI process reruns the configured preparation, migration,
  // seed, and webServer commands instead of reusing the failed Worker runtime.
  return invoke(arguments_);
}

export function runPlaywrightInvocation(
  arguments_,
  {
    spawnProcess = spawn,
    stdout = process.stdout,
    stderr = process.stderr,
    cliPath = playwrightCli,
    cwd = root,
    env = process.env,
  } = {},
) {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const stdoutScanner = createMarkerScanner();
    const stderrScanner = createMarkerScanner();
    const child = spawnProcess(
      process.execPath,
      [cliPath, "test", ...arguments_],
      {
        cwd,
        env,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (chunk) => {
      stdoutScanner.inspect(chunk);
      stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrScanner.inspect(chunk);
      stderr.write(chunk);
    });
    child.once("error", rejectInvocation);
    child.once("close", (code, signal) => {
      resolveInvocation({
        code,
        signal,
        wranglerExitedUnexpectedly:
          stdoutScanner.found || stderrScanner.found,
      });
    });
  });
}

export function createMarkerScanner(marker = WRANGLER_EXIT_MARKER) {
  const markerBytes = Buffer.from(marker);
  let tail = Buffer.alloc(0);
  let found = false;

  return {
    inspect(chunk) {
      if (found) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const candidate =
        tail.length === 0 ? bytes : Buffer.concat([tail, bytes]);
      found = candidate.includes(markerBytes);
      tail = candidate.subarray(
        Math.max(0, candidate.length - markerBytes.length + 1),
      );
    },
    get found() {
      return found;
    },
  };
}

function succeeded(result) {
  return result.code === 0 && result.signal === null;
}

function finish(result) {
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.code ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    finish(await runPlaywrightGate());
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
