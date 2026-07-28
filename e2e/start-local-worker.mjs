#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  rmSync,
} from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import {
  Agent as HttpAgent,
  request as requestHttp,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  Log,
  LogLevel,
  Miniflare,
} from "miniflare";
import { unstable_getMiniflareWorkerOptions } from "wrangler";

const root = resolve(import.meta.dirname, "..");
const E2E_TURNSTILE_TOKEN_PREFIX = "paretto-e2e-turnstile:";
const E2E_TURNSTILE_ACTIONS = new Set([
  "account_create",
  "account_sign_in",
  "account_recover",
  "recovery_codes_rotate",
]);
const wranglerArguments = process.argv.slice(2);
const externalPort = requiredNumberArgument(wranglerArguments, "--port");
const protocol = requiredStringArgument(
  wranglerArguments,
  "--local-protocol",
);

if (protocol !== "https") {
  throw new Error(
    "The browser acceptance runtime must keep an HTTPS origin.",
  );
}

await runAcceptanceRuntime(wranglerArguments, externalPort);

async function runAcceptanceRuntime(arguments_, publicPort) {
  const runtimeEvidence = await createRuntimeEvidenceLogger();
  const backendPort = publicPort + 1;
  const certificateDirectory = resolve(
    root,
    "test-results",
    "playwright-tls-boundary",
  );
  const keyPath = resolve(certificateDirectory, "localhost-key.pem");
  const certificatePath = resolve(
    certificateDirectory,
    "localhost-cert.pem",
  );

  let worker;
  let server;
  let shuttingDown = false;
  const upstreamAgent = new HttpAgent({
    // A disposable acceptance proxy does not need socket reuse. Avoiding an
    // idle pool also prevents a normal stale keep-alive reset from being
    // mistaken for loss of the Worker listener.
    keepAlive: false,
    maxSockets: 16,
  });

  const shutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtimeEvidence.writeSync("shutdown-started", {
      exitCode,
      reason,
    });
    upstreamAgent.destroy();
    if (server) {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
      });
    }
    if (worker) {
      await worker.dispose();
    }
    await rm(certificateDirectory, { recursive: true, force: true });
    runtimeEvidence.writeSync("shutdown-complete", {
      exitCode,
      reason,
    });
    process.exit(exitCode);
  };

  const shutdownFromProcessGroupSignal = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtimeEvidence.writeSync("shutdown-started", {
      exitCode: 0,
      reason,
    });
    upstreamAgent.destroy();
    server?.closeAllConnections();
    // Playwright delivers the signal to the entire disposable process group,
    // including workerd. Perform owned-file cleanup synchronously before Node
    // exits; process termination then closes the remaining sockets and handles.
    rmSync(certificateDirectory, { recursive: true, force: true });
    runtimeEvidence.writeSync("shutdown-complete", {
      exitCode: 0,
      reason,
    });
    process.exit(0);
  };

  process.once("SIGINT", () =>
    shutdownFromProcessGroupSignal("SIGINT"),
  );
  process.once("SIGTERM", () =>
    shutdownFromProcessGroupSignal("SIGTERM"),
  );

  try {
    await rm(certificateDirectory, { recursive: true, force: true });
    await mkdir(certificateDirectory, { recursive: true });
    generateCertificate(keyPath, certificatePath);
    const runtime = await createDirectWorkerRuntime(
      arguments_,
      publicPort,
      backendPort,
      async () => {
        if (shuttingDown) return;
        console.error(
          "The local Worker backend exited unexpectedly (runtime restart).",
        );
        await shutdown("runtime-restart", 1);
      },
    );
    worker = runtime.worker;
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certificatePath),
    ]);
    server = createHttpsServer({ key, cert }, (incoming, outgoing) => {
      let downstreamAborted = false;
      const upstream = requestHttp(
        {
          agent: upstreamAgent,
          headers: forwardedHeaders(incoming.headers, publicPort),
          hostname: runtime.url.hostname,
          method: incoming.method,
          path: incoming.url,
          port: runtime.url.port,
        },
        (response) => {
          response.once("error", (error) => {
            if (!outgoing.destroyed) outgoing.destroy(error);
          });
          outgoing.writeHead(
            response.statusCode ?? 502,
            response.statusMessage,
            withoutHopByHopHeaders(response.headers),
          );
          response.pipe(outgoing);
        },
      );
      upstream.on("error", (error) => {
        if (downstreamAborted || shuttingDown) return;
        if (isBackendUnavailable(error)) {
          console.error(
            `The acceptance proxy lost its Worker backend connection (${error.code}).`,
          );
          void shutdown(
            `backend-transport-failure:${error.code}`,
            1,
          );
        } else {
          runtimeEvidence.writeSync("proxy-request-error", {
            code: errorCode(error),
          });
        }
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) {
          outgoing.destroy(error);
          return;
        }
        outgoing.writeHead(502, {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        });
        outgoing.end("The local Worker backend is unavailable.");
      });
      const abortUpstream = () => {
        if (outgoing.writableEnded) return;
        downstreamAborted = true;
        upstream.destroy();
      };
      incoming.once("aborted", abortUpstream);
      outgoing.once("close", abortUpstream);
      incoming.pipe(upstream);
    });
    // Plaintext and malformed TLS probes fail their own connection without
    // terminating the acceptance runtime.
    server.on("tlsClientError", () => {});
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(publicPort, "localhost", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    await runtimeEvidence.write("runtime-ready", {
      backendPort,
      engine: "miniflare-direct",
      moduleCount: runtime.moduleCount,
      port: publicPort,
      protocol: "https",
    });
    console.log(
      `Built Worker ready behind the HTTPS acceptance boundary on ${canonicalOrigin(publicPort)}.`,
    );
  } catch (error) {
    await runtimeEvidence.write("startup-failed", {
      code: errorCode(error),
      name: error instanceof Error ? error.name : "UnknownError",
    });
    upstreamAgent.destroy();
    server?.closeAllConnections();
    await Promise.allSettled([
      worker?.dispose(),
      rm(certificateDirectory, { recursive: true, force: true }),
    ]);
    throw error;
  }
}

async function createDirectWorkerRuntime(
  arguments_,
  publicPort,
  backendPort,
  onUnexpectedRestart,
) {
  const workerDirectory = resolve(
    root,
    requiredStringArgument(arguments_, "--cwd"),
  );
  const configPath = resolveInside(
    workerDirectory,
    requiredStringArgument(arguments_, "--config"),
    "Worker configuration",
  );
  const persistDirectory = resolve(
    workerDirectory,
    requiredStringArgument(arguments_, "--persist-to"),
  );
  const expectedPersistence = resolve(
    root,
    "test-results",
    "playwright-runtime",
  );
  if (persistDirectory !== expectedPersistence) {
    throw new Error(
      "The browser acceptance runtime must use its disposable persistence directory.",
    );
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof config.name !== "string" || !config.name.trim()) {
    throw new Error("The built Worker configuration must include a name.");
  }
  const generated = unstable_getMiniflareWorkerOptions(configPath);
  if (!generated.main) {
    throw new Error("Wrangler did not resolve the built Worker entrypoint.");
  }
  const modulesRoot = dirname(generated.main);
  const workerModules = await explicitWorkerModules(
    modulesRoot,
    generated.main,
  );
  const workerOptions = { ...generated.workerOptions };
  // An explicit module inventory is required for Vinext's literal dynamic
  // imports. Keeping Wrangler's discovery rules as well would make Miniflare
  // try to rediscover those imports and reject the built artifact.
  delete workerOptions.modulesRules;

  const publicOrigin = canonicalOrigin(publicPort);
  const worker = new Miniflare({
    defaultPersistRoot: resolve(persistDirectory, "v3"),
    host: "127.0.0.1",
    log: new Log(LogLevel.ERROR),
    port: backendPort,
    publicUrl: publicOrigin,
    upstream: publicOrigin,
    unsafeHandleRuntimeRestart: onUnexpectedRestart,
    workers: [
      {
        ...workerOptions,
        outboundService: createAcceptanceOutboundService(),
        bindings: {
          ...(workerOptions.bindings ?? {}),
          ...variableArguments(arguments_),
          PARETTO_PASSWORD_PEPPERS:
            requiredLocalPasswordPepperKeyring(),
        },
        modules: workerModules,
        modulesRoot,
        name: config.name,
      },
      ...generated.externalWorkers,
    ],
  });

  try {
    const url = await worker.ready;
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== String(backendPort)
    ) {
      throw new Error(
        `The direct Worker bound unexpected origin ${url.origin}.`,
      );
    }
    return {
      moduleCount: workerModules.length,
      url,
      worker,
    };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}

function createAcceptanceOutboundService() {
  return async (request) => {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.origin === "https://challenges.cloudflare.com" &&
      url.pathname === "/turnstile/v0/siteverify"
    ) {
      const form = new URLSearchParams(await request.text());
      const response = form.get("response") ?? "";
      const action = response.startsWith(E2E_TURNSTILE_TOKEN_PREFIX)
        ? response.slice(E2E_TURNSTILE_TOKEN_PREFIX.length)
        : "";
      return Response.json({
        success: E2E_TURNSTILE_ACTIONS.has(action),
        action,
        hostname: "localhost",
        ...(E2E_TURNSTILE_ACTIONS.has(action)
          ? {}
          : { "error-codes": ["invalid-input-response"] }),
      });
    }
    return fetch(request);
  };
}

async function explicitWorkerModules(modulesRoot, main) {
  const discovered = await discoverJavaScriptModules(modulesRoot);
  const entrypoint = resolve(main);
  if (!discovered.includes(entrypoint)) {
    throw new Error("The built Worker entrypoint was not found.");
  }
  const ordered = [
    entrypoint,
    ...discovered.filter((path) => path !== entrypoint),
  ];
  return ordered.map((path) => ({
    path,
    type: "ESModule",
  }));
}

async function discoverJavaScriptModules(directory) {
  const discovered = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      discovered.push(...(await discoverJavaScriptModules(path)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
    ) {
      discovered.push(path);
    }
  }
  return discovered;
}

function variableArguments(arguments_) {
  const variables = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--var") continue;
    const value = arguments_[index + 1] ?? "";
    const separator = value.indexOf(":");
    const name = separator < 0 ? "" : value.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error("Every --var argument must use NAME:value syntax.");
    }
    if (Object.hasOwn(variables, name)) {
      throw new Error(`Duplicate --var argument for ${name}.`);
    }
    variables[name] = value.slice(separator + 1);
    index += 1;
  }
  return variables;
}

function requiredLocalPasswordPepperKeyring() {
  const value = process.env.PARETTO_E2E_PASSWORD_PEPPERS;
  if (!value || value !== value.trim()) {
    throw new Error(
      "PARETTO_E2E_PASSWORD_PEPPERS must provide the local acceptance keyring.",
    );
  }
  try {
    JSON.parse(value);
  } catch {
    throw new Error(
      "PARETTO_E2E_PASSWORD_PEPPERS must contain valid JSON.",
    );
  }
  return value;
}

function resolveInside(base, value, label) {
  const candidate = resolve(base, value);
  const relation = relative(base, candidate);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    candidate === resolve(base)
  ) {
    throw new Error(
      `${label} must resolve to a file or directory below its root.`,
    );
  }
  return candidate;
}

async function createRuntimeEvidenceLogger() {
  const directory = process.env.PARETTO_E2E_RUNTIME_LOG_PATH?.trim();
  if (!directory) {
    return {
      write: async () => {},
      writeSync: () => {},
    };
  }
  const resolvedDirectory = resolve(directory);
  await mkdir(resolvedDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(
    resolvedDirectory,
    `worker-runtime-${Date.now()}-${process.pid}.jsonl`,
  );
  return {
    async write(event, details = {}) {
      await appendFile(
        path,
        `${JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          ...details,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    },
    writeSync(event, details = {}) {
      appendFileSync(
        path,
        `${JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          ...details,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    },
  };
}

function requiredStringArgument(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : "";
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} argument.`);
  }
  return value;
}

function requiredNumberArgument(arguments_, name) {
  const value = Number(requiredStringArgument(arguments_, name));
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_534) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return value;
}

function canonicalOrigin(port) {
  return `https://localhost:${port}`;
}

function generateCertificate(keyPath, certificatePath) {
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not generate the disposable localhost TLS certificate: ${
        result.stderr?.trim() || result.error?.message || "OpenSSL failed"
      }`,
    );
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function withoutHopByHopHeaders(headers) {
  const connectionValue = headers.connection;
  const connectionTokens = new Set(
    (Array.isArray(connectionValue)
      ? connectionValue.join(",")
      : String(connectionValue ?? ""))
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) &&
        !connectionTokens.has(name.toLowerCase()),
    ),
  );
}

function forwardedHeaders(headers, publicPort) {
  return {
    ...withoutHopByHopHeaders(headers),
    host: `localhost:${publicPort}`,
    "x-forwarded-host": `localhost:${publicPort}`,
    "x-forwarded-port": String(publicPort),
    "x-forwarded-proto": "https",
  };
}

function isBackendUnavailable(error) {
  return (
    error &&
    typeof error === "object" &&
    error.code === "ECONNREFUSED"
  );
}

function errorCode(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "UNKNOWN";
}
