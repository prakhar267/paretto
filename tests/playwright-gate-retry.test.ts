import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  runPlaywrightGate,
  runPlaywrightInvocation,
  RUNTIME_RESTART_MARKER,
} from "../scripts/run-playwright-gate.mjs";

type InvocationResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  runtimeRestartedUnexpectedly: boolean;
};

describe("bounded Playwright gate retry", () => {
  it("retries the complete invocation once after exact Worker exit evidence", async () => {
    const arguments_ = ["--project=chromium"];
    const first: InvocationResult = {
      code: 1,
      signal: null,
      runtimeRestartedUnexpectedly: true,
    };
    const second: InvocationResult = {
      code: 0,
      signal: null,
      runtimeRestartedUnexpectedly: false,
    };
    const invoke = vi
      .fn<(arguments_: string[]) => Promise<InvocationResult>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const retryOutput = recordingOutput();

    const result = await runPlaywrightGate({
      arguments_,
      invoke,
      retryOutput: retryOutput as unknown as typeof process.stderr,
    });

    expect(result).toEqual(second);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, arguments_);
    expect(invoke).toHaveBeenNthCalledWith(2, arguments_);
    expect(retryOutput.text()).toContain(
      "Retrying the complete Playwright invocation once",
    );
  });

  it("does not retry assertion or product failures without Worker exit evidence", async () => {
    const failure: InvocationResult = {
      code: 23,
      signal: null,
      runtimeRestartedUnexpectedly: false,
    };
    const invoke = vi.fn().mockResolvedValue(failure);
    const retryOutput = recordingOutput();

    const result = await runPlaywrightGate({
      invoke,
      retryOutput: retryOutput as unknown as typeof process.stderr,
    });

    expect(result).toEqual(failure);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(retryOutput.text()).toBe("");
  });

  it("requires a failed invocation even if successful output contains the marker", async () => {
    const success: InvocationResult = {
      code: 0,
      signal: null,
      runtimeRestartedUnexpectedly: true,
    };
    const invoke = vi.fn().mockResolvedValue(success);

    const result = await runPlaywrightGate({ invoke });

    expect(result).toEqual(success);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns the retry exit code and never attempts a third invocation", async () => {
    const first: InvocationResult = {
      code: 1,
      signal: null,
      runtimeRestartedUnexpectedly: true,
    };
    const second: InvocationResult = {
      code: 37,
      signal: null,
      runtimeRestartedUnexpectedly: true,
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const result = await runPlaywrightGate({
      invoke,
      retryOutput: recordingOutput() as unknown as typeof process.stderr,
    });

    expect(result).toEqual(second);
    expect(result.code).toBe(37);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("preserves stdout and stderr while detecting a marker split across chunks", async () => {
    const stdout = recordingOutput();
    const stderr = recordingOutput();
    const spawnProcess = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.write("browser stdout\n");
        child.stderr.write("The local Worker backend ");
        child.stderr.write("exited unexpectedly (1).\n");
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 19, null);
      });
      return child;
    });

    const result = await runPlaywrightInvocation(
      ["--project=webkit"],
      {
        spawnProcess:
          spawnProcess as unknown as typeof import("node:child_process").spawn,
        stdout: stdout as unknown as typeof process.stdout,
        stderr: stderr as unknown as typeof process.stderr,
        cliPath: "/test/playwright-cli.js",
        cwd: "/test/repository",
        env: { ...process.env, TEST_GATE: "1" },
      },
    );

    expect(result).toEqual({
      code: 19,
      signal: null,
      runtimeRestartedUnexpectedly: true,
    });
    expect(stdout.text()).toBe("browser stdout\n");
    expect(stderr.text()).toBe(
      `${RUNTIME_RESTART_MARKER} (1).\n`,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [
        "/test/playwright-cli.js",
        "test",
        "--project=webkit",
      ],
      {
        cwd: "/test/repository",
        env: { ...process.env, TEST_GATE: "1" },
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
  });
});

function recordingOutput() {
  const chunks: Buffer[] = [];
  return {
    write(chunk: Uint8Array | string) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
