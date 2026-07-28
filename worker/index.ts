/** Cloudflare Worker entry point for Paretto. */
import handler from "vinext/server/app-router-entry";
import {
  runScheduledRetentionMaintenance as runRetentionMaintenance,
} from "../app/retention-policy";
import {
  appendSetCookie,
  prepareWebRequest,
  rejectUnsafeCrossOriginWebApiRequest,
} from "../app/web-session";
import { createHealthResponseCache } from "./health-cache";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  USER_KEY_SECRET?: string;
  SUPPORT_RATE_LIMIT_SECRET?: string;
  BETTER_AUTH_RATE_LIMIT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  ADMIN_EMAILS?: string;
  ADMIN_PASSWORD_VERIFIER?: string;
  ADMIN_PASSWORD_VERIFIERS?: string;
  ADMIN_SESSION_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  LAUNCH_MODE?: string;
  WORKERS_PLAN?: string;
  NATIVE_API_ENABLED?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_TOKEN_ENCRYPTION_SECRET?: string;
  NATIVE_SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_WEB_CLIENT_ID?: string;
  APPLE_WEB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  SUPPORT_NOTIFICATION_EMAIL?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const cachedHealthResponse = createHealthResponseCache();

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const prepared = prepareWebRequest(request);
    const webRequest = prepared.request;
    const url = new URL(webRequest.url);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    const rejectedMutation =
      rejectUnsafeCrossOriginWebApiRequest(webRequest);
    const isHealthProbe =
      url.pathname === "/api/health" &&
      (webRequest.method === "GET" || webRequest.method === "HEAD");
    const response = rejectedMutation ??
      (isHealthProbe
        ? await cachedHealthResponse({
            request: webRequest,
            fetchResponse: () =>
              handler.fetch(asCanonicalHealthGet(webRequest), env, ctx),
            edgeCache: defaultEdgeCache(),
            waitUntil: (promise) => ctx.waitUntil(promise),
          })
        : await handler.fetch(webRequest, env, ctx));

    const securedResponse = appendSetCookie(
      withSecurityHeaders(response, webRequest, requestId),
      rejectedMutation ? null : prepared.setCookie,
    );
    if (url.pathname.startsWith("/api/") || response.status >= 500) {
      console.info(
        JSON.stringify({
          event: "request_completed",
          requestId,
          method: request.method,
          route: url.pathname,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    return securedResponse;
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const runId = crypto.randomUUID();
    ctx.waitUntil(
      runRetentionMaintenance(env.DB, controller.scheduledTime, { runId })
        .then((result) => {
          console.info(
            JSON.stringify({
              event: "scheduled_retention_completed",
              scheduledAt: new Date(controller.scheduledTime).toISOString(),
              runId: result.runId,
              startedAt: new Date(result.startedAt).toISOString(),
              completedAt: new Date(result.completedAt).toISOString(),
              pagesProcessed: result.pagesProcessed,
              deleted: result.deleted,
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "scheduled_retention_failed",
              runId,
              message: error instanceof Error ? error.message : "unknown error",
              scheduledAt: new Date(controller.scheduledTime).toISOString(),
            }),
          );
          throw error;
        }),
    );
  },
};

function asCanonicalHealthGet(request: Request): Request {
  if (request.method === "GET") return request;
  return new Request(request, { method: "GET" });
}

function defaultEdgeCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  return (caches as CacheStorage & { default?: Cache }).default;
}

function withSecurityHeaders(
  response: Response,
  request: Request,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  headers.set("x-request-id", requestId);

  const url = new URL(request.url);
  if (url.pathname === "/service-worker.js") {
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    headers.set("service-worker-allowed", "/");
  }

  if (process.env.NODE_ENV === "production") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    headers.set(
      "content-security-policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-src https://challenges.cloudflare.com",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "manifest-src 'self'",
        "media-src 'self' blob:",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
