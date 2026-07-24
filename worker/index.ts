/** Cloudflare Worker entry point for Paretto. */
import handler from "vinext/server/app-router-entry";
import { runRetentionMaintenance } from "../app/retention-policy";
import {
  appendSetCookie,
  prepareWebRequest,
  rejectUnsafeCrossOriginWebApiRequest,
} from "../app/web-session";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  USER_KEY_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_PASSWORD_VERIFIER?: string;
  ADMIN_PASSWORD_VERIFIERS?: string;
  ADMIN_SESSION_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  NATIVE_API_ENABLED?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_TOKEN_ENCRYPTION_SECRET?: string;
  NATIVE_SESSION_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const prepared = prepareWebRequest(request);
    const webRequest = prepared.request;
    const url = new URL(webRequest.url);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    const rejectedMutation =
      rejectUnsafeCrossOriginWebApiRequest(webRequest);
    const response =
      rejectedMutation ??
      (await handler.fetch(webRequest, env, ctx));

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
    ctx.waitUntil(
      runRetentionMaintenance(env.DB)
        .then((deleted) => {
          console.info(
            JSON.stringify({
              event: "scheduled_retention_completed",
              scheduledAt: new Date(controller.scheduledTime).toISOString(),
              deleted,
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "scheduled_retention_failed",
              message: error instanceof Error ? error.message : "unknown error",
              scheduledAt: new Date(controller.scheduledTime).toISOString(),
            }),
          );
        }),
    );
  },
};

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
