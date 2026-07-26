#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import {
  Agent as HttpAgent,
  request as requestHttp,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const wrangler = resolve(
  root,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const wranglerArguments = process.argv.slice(2);
const externalPort = requiredNumberArgument(wranglerArguments, "--port");
const protocol = requiredStringArgument(
  wranglerArguments,
  "--local-protocol",
);

if (protocol !== "https") {
  throw new Error(
    "The browser acceptance runtime must keep an HTTPS external origin.",
  );
}

// Wrangler's local TLS listener can terminate when a hosted browser follows an
// incorrectly forwarded HTTP asset URL back to the secure port. On Unix CI
// runners, terminate disposable browser TLS in Node and keep Wrangler on an
// internal HTTP port. The explicit upstream and forwarding headers preserve
// the canonical HTTPS Worker URL, secure cookies, and same-origin checks.
if (process.platform === "win32") {
  runDirectly(wranglerArguments);
} else {
  await runBehindTlsBoundary(wranglerArguments, externalPort);
}

function runDirectly(arguments_) {
  const child = spawn(process.execPath, [wrangler, "dev", ...arguments_], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  forwardTermination(child);
}

async function runBehindTlsBoundary(arguments_, publicPort) {
  const backendPort = publicPort + 1;
  const backendArguments = upsertArgument(
    upsertArgument(
      upsertArgument(
        replaceArgument(
          replaceArgument(
            arguments_,
            "--port",
            String(backendPort),
          ),
          "--local-protocol",
          "http",
        ),
        "--local-upstream",
        `localhost:${publicPort}`,
      ),
      "--upstream-protocol",
      "https",
    ),
    "--ip",
    "localhost",
  );
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

  await rm(certificateDirectory, { recursive: true, force: true });
  await mkdir(certificateDirectory, { recursive: true });
  generateCertificate(keyPath, certificatePath);

  const child = spawn(
    process.execPath,
    [wrangler, "dev", ...backendArguments],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  const upstreamAgent = new HttpAgent({
    keepAlive: true,
    maxSockets: 16,
  });
  let server;
  let shuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    upstreamAgent.destroy();
    if (server) {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
      });
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      if (!(await waitForChildExit(child, 2_000))) {
        child.kill("SIGKILL");
        await waitForChildExit(child, 1_000);
      }
    }
    await rm(certificateDirectory, { recursive: true, force: true });
    process.exit(exitCode);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `The local Wrangler backend exited unexpectedly (${signal ?? code ?? "unknown"}).`,
    );
    void shutdown("SIGTERM", code && code > 0 ? code : 1);
  });

  try {
    await waitForBackend(backendPort, publicPort, child);
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certificatePath),
    ]);
    server = createHttpsServer({ key, cert }, (incoming, outgoing) => {
      const headers = forwardedHeaders(incoming.headers, publicPort);
      const upstream = requestHttp(
        {
          hostname: "localhost",
          port: backendPort,
          method: incoming.method,
          path: incoming.url,
          headers,
          agent: upstreamAgent,
        },
        (response) => {
          outgoing.writeHead(
            response.statusCode ?? 502,
            response.statusMessage,
            withoutHopByHopHeaders(response.headers),
          );
          response.pipe(outgoing);
        },
      );
      upstream.on("error", (error) => {
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
      incoming.pipe(upstream);
    });
    // A plaintext or malformed client TLS probe must fail that connection, not
    // the acceptance runtime. Valid browser requests remain available.
    server.on("tlsClientError", () => {});
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(publicPort, "localhost", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    console.log(
      `Local HTTPS acceptance boundary ready on https://localhost:${publicPort}; Wrangler is isolated on HTTP port ${backendPort}.`,
    );
  } catch (error) {
    await shutdown("SIGTERM", 1);
    throw error;
  }
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
        result.stderr?.trim() || "OpenSSL failed"
      }`,
    );
  }
}

async function waitForBackend(backendPort, publicPort, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The local Wrangler backend exited before it was ready.");
    }
    try {
      await probeBackend(backendPort, publicPort);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error("Timed out waiting for the local HTTPS Wrangler backend.");
}

function probeBackend(backendPort, publicPort) {
  return new Promise((resolveProbe, rejectProbe) => {
    const probe = requestHttp(
      {
        hostname: "localhost",
        port: backendPort,
        method: "GET",
        // Avoid warming the application health-response cache before the
        // browser owns its first request context.
        path: "/favicon.svg",
        headers: forwardedHeaders({}, publicPort),
      },
      (response) => {
        response.resume();
        response.once("end", resolveProbe);
      },
    );
    probe.setTimeout(1_000, () => {
      probe.destroy(new Error("Local Worker readiness probe timed out."));
    });
    probe.once("error", rejectProbe);
    probe.end();
  });
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

function replaceArgument(arguments_, name, value) {
  const replaced = [...arguments_];
  const index = replaced.indexOf(name);
  if (index < 0 || !replaced[index + 1]) {
    throw new Error(`Missing required ${name} argument.`);
  }
  replaced[index + 1] = value;
  return replaced;
}

function upsertArgument(arguments_, name, value) {
  const index = arguments_.indexOf(name);
  if (index >= 0) {
    return replaceArgument(arguments_, name, value);
  }
  return [...arguments_, name, value];
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

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function forwardTermination(child) {
  let terminating = false;
  const terminate = (signal) => {
    if (terminating) return;
    terminating = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  process.once("SIGINT", () => terminate("SIGINT"));
  process.once("SIGTERM", () => terminate("SIGTERM"));
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}
