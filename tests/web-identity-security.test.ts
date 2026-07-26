import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminAuthConfiguration,
  verifyAdminCredentials,
  verifyAdminSession,
} from "../app/admin-auth";
import { POST as APPLE_SIGN_IN } from "../app/api/native/auth/apple/route";
import { nativeApiEnabled } from "../app/api/native/_lib/native-auth";
import { resolveRequestIdentity } from "../app/server-auth";
import {
  turnstileConfiguration,
  verifySupportTurnstile,
} from "../app/turnstile";
import {
  appendSetCookie,
  prepareWebRequest,
  rejectUnsafeCrossOriginWebApiRequest,
  rotateLearnerSessionCookie,
} from "../app/web-session";
import {
  createAdminTestAuth,
  successfulTurnstileResponse,
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

describe("direct web identity security", () => {
  beforeEach(() => {
    setCloudflareEnv({});
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("strips spoofable platform headers and creates one anonymous learner session", async () => {
    setCloudflareEnv({
      USER_KEY_SECRET: "test-user-key-secret-with-more-than-thirty-two-characters",
    });
    const request = new Request("https://learn.example/", {
      headers: {
        "oai-authenticated-user-email": "attacker@example.test",
        "oai-authenticated-user-id": "forged",
      },
    });
    const prepared = prepareWebRequest(
      request,
      () => Uint8Array.from({ length: 32 }, (_, index) => index),
    );

    expect(prepared.request.headers.get("oai-authenticated-user-email")).toBeNull();
    expect(prepared.request.headers.get("oai-authenticated-user-id")).toBeNull();
    expect(prepared.request.headers.get("cookie")).toMatch(
      /^__Host-learner-session=[A-Za-z0-9_-]{43}$/,
    );
    expect(prepared.setCookie).toContain("HttpOnly");
    expect(prepared.setCookie).toContain("Secure");
    expect(prepared.setCookie).toContain("SameSite=Lax");

    const identity = await resolveRequestIdentity(prepared.request);
    expect(identity).toMatchObject({ ok: true });
    if (!identity.ok) throw new Error("Expected an anonymous learner identity.");
    expect(identity.userKey).toMatch(/^[0-9a-f]{64}$/);

    const repeated = prepareWebRequest(prepared.request);
    expect(repeated.setCookie).toBeNull();
    await expect(resolveRequestIdentity(repeated.request)).resolves.toEqual(
      identity,
    );

    const rotated = rotateLearnerSessionCookie(
      repeated.request,
      () => Uint8Array.from({ length: 32 }, () => 255),
    );
    expect(rotated).toMatch(
      /^__Host-learner-session=[A-Za-z0-9_-]{43}; Path=\//,
    );
    expect(rotated).not.toContain(
      prepared.request.headers.get("cookie")!.split("=", 2)[1],
    );
  });

  it("provisions an anonymous session for Vinext client navigation only on its exact RSC endpoint", () => {
    const prepared = prepareWebRequest(
      new Request("https://learn.example/.rsc?_rsc=route-payload"),
      () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );

    expect(prepared.request.headers.get("cookie")).toMatch(
      /^__Host-learner-session=[A-Za-z0-9_-]{43}$/,
    );
    expect(prepared.setCookie).toMatch(
      /^__Host-learner-session=[A-Za-z0-9_-]{43}; Path=\//,
    );

    for (const path of ["/.rsc-extra", "/nested/.rsc"]) {
      const unrelated = prepareWebRequest(
        new Request(`https://learn.example${path}`),
      );
      expect(unrelated.request.headers.get("cookie")).toBeNull();
      expect(unrelated.setCookie).toBeNull();
    }
  });

  it("establishes one profile on an unknown document before client navigation can prefetch", () => {
    const document = prepareWebRequest(
      new Request("https://learn.example/this-route-does-not-exist", {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "sec-fetch-dest": "document",
        },
      }),
      () => Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const browserCookie = document.setCookie?.split(";", 1)[0];

    expect(browserCookie).toMatch(
      /^__Host-learner-session=[A-Za-z0-9_-]{43}$/,
    );
    expect(document.request.headers.get("cookie")).toBe(browserCookie);

    const navigation = prepareWebRequest(
      new Request("https://learn.example/.rsc?_rsc=route-payload", {
        headers: { cookie: browserCookie! },
      }),
      () => Uint8Array.from({ length: 32 }, () => 255),
    );

    expect(navigation.request.headers.get("cookie")).toBe(browserCookie);
    expect(navigation.setCookie).toBeNull();

    const nonDocumentFetch = prepareWebRequest(
      new Request("https://learn.example/unrelated-resource", {
        headers: {
          accept: "text/html",
          "sec-fetch-dest": "empty",
        },
      }),
    );
    expect(nonDocumentFetch.request.headers.get("cookie")).toBeNull();
    expect(nonDocumentFetch.setCookie).toBeNull();

    const apiDocument = prepareWebRequest(
      new Request("https://learn.example/api/health", {
        headers: {
          accept: "text/html",
          "sec-fetch-dest": "document",
        },
      }),
    );
    expect(apiDocument.request.headers.get("cookie")).toBeNull();
    expect(apiDocument.setCookie).toBeNull();
  });

  it("makes every learner-cookie response explicitly private and non-cacheable", async () => {
    const response = appendSetCookie(
      new Response("Not found", {
        status: 404,
        headers: {
          "cache-control": "public, max-age=600",
          "cdn-cache-control": "public, s-maxage=600",
          "cloudflare-cdn-cache-control": "public, s-maxage=600",
          expires: "Sun, 26 Jul 2026 17:00:00 GMT",
          "surrogate-control": "max-age=600",
        },
      }),
      "__Host-learner-session=session-token; Path=/; HttpOnly; Secure",
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-learner-session=session-token",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    expect(response.headers.get("surrogate-control")).toBeNull();
    expect(response.headers.get("expires")).toBeNull();

    const publicResponse = new Response("Public", {
      headers: { "cache-control": "public, max-age=300" },
    });
    const unchanged = appendSetCookie(publicResponse, null);
    expect(unchanged).toBe(publicResponse);
    expect(unchanged.headers.get("cache-control")).toBe(
      "public, max-age=300",
    );
  });

  it("rejects unsafe cross-origin web mutations but leaves native bearer APIs alone", () => {
    const missingOrigin = rejectUnsafeCrossOriginWebApiRequest(
      new Request("https://learn.example/api/progress", { method: "PUT" }),
    );
    expect(missingOrigin?.status).toBe(403);

    const crossOrigin = rejectUnsafeCrossOriginWebApiRequest(
      new Request("https://learn.example/api/progress", {
        method: "DELETE",
        headers: { origin: "https://attacker.example" },
      }),
    );
    expect(crossOrigin?.status).toBe(403);

    expect(
      rejectUnsafeCrossOriginWebApiRequest(
        new Request("https://learn.example/api/progress", {
          method: "PUT",
          headers: { origin: "https://learn.example" },
        }),
      ),
    ).toBeNull();
    expect(
      rejectUnsafeCrossOriginWebApiRequest(
        new Request("https://learn.example/api/native/progress", {
          method: "PUT",
        }),
      ),
    ).toBeNull();
  });

  it("allows only Apple's exact cross-origin form-post callback", () => {
    expect(
      rejectUnsafeCrossOriginWebApiRequest(
        new Request("https://learn.example/api/auth/callback/apple", {
          method: "POST",
          headers: { origin: "https://appleid.apple.com" },
        }),
      ),
    ).toBeNull();

    for (const request of [
      new Request("https://learn.example/api/auth/callback/google", {
        method: "POST",
        headers: { origin: "https://accounts.google.com" },
      }),
      new Request("https://learn.example/api/auth/callback/apple/extra", {
        method: "POST",
        headers: { origin: "https://appleid.apple.com" },
      }),
      new Request("https://learn.example/api/auth/callback/apple", {
        method: "PUT",
        headers: { origin: "https://appleid.apple.com" },
      }),
    ]) {
      expect(rejectUnsafeCrossOriginWebApiRequest(request)?.status).toBe(403);
    }
  });

  it("verifies generated admin access keys and rejects tampered or expired sessions", async () => {
    const email = "admin@example.test";
    const auth = await createAdminTestAuth([email]);
    const configuration = adminAuthConfiguration(auth.bindings);
    if (!configuration) throw new Error("Expected valid admin configuration.");
    const accessKey = auth.accessKeys.get(email)!;

    await expect(
      verifyAdminCredentials(email, accessKey, configuration),
    ).resolves.toEqual({ ok: true, email });
    await expect(
      verifyAdminCredentials("other@example.test", accessKey, configuration),
    ).resolves.toEqual({ ok: false });
    await expect(
      verifyAdminCredentials(email, "weak-password", configuration),
    ).resolves.toEqual({ ok: false });

    const cookie = auth.cookies.get(email)!;
    const headers = new Headers({ cookie });
    const session = await verifyAdminSession(headers, configuration);
    expect(session).toEqual({ ok: true, email });

    const tampered = new Headers({
      cookie: `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`,
    });
    await expect(
      verifyAdminSession(tampered, configuration),
    ).resolves.toEqual({ ok: false });
    await expect(
      verifyAdminSession(headers, configuration, Date.now() + 9 * 60 * 60 * 1000),
    ).resolves.toEqual({ ok: false });
  });

  it("validates Turnstile success, action, hostname, response size, and availability", async () => {
    const configuration = turnstileConfiguration({
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
    });
    if (!configuration) throw new Error("Expected valid Turnstile configuration.");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("secret")).toBe(TEST_TURNSTILE_SECRET);
      expect(body.get("response")).toBe("challenge-token");
      expect(body.get("remoteip")).toBe("203.0.113.7");
      expect(body.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
      return successfulTurnstileResponse("learn.example");
    });
    const request = new Request("https://learn.example/api/support", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    await expect(
      verifySupportTurnstile("challenge-token", request, {
        configuration,
        fetcher,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();

    await expect(
      verifySupportTurnstile("challenge-token", request, {
        configuration,
        fetcher: vi.fn(async () =>
          successfulTurnstileResponse("other.example"),
        ),
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(
      verifySupportTurnstile("x".repeat(2_049), request, {
        configuration,
        fetcher,
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(
      verifySupportTurnstile("challenge-token", request, {
        configuration,
        fetcher: vi.fn(async () => {
          throw new Error("network unavailable");
        }),
      }),
    ).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it("uses only Cloudflare's official test keys for a development-only bypass", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const configuration = turnstileConfiguration(
      {},
      { allowDevelopmentFallback: true },
    );
    if (!configuration) throw new Error("Expected development Turnstile keys.");
    const fetcher = vi.fn();
    await expect(
      verifySupportTurnstile(
        "development-widget-token",
        new Request("http://localhost:3000/api/support"),
        { configuration, fetcher },
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps native APIs disabled unless the exact feature flag is enabled", async () => {
    setCloudflareEnv({ NATIVE_API_ENABLED: "false" });
    await expect(nativeApiEnabled()).resolves.toBe(false);
    const disabled = await APPLE_SIGN_IN(
      new Request("https://learn.example/api/native/auth/apple", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(disabled.status).toBe(503);
    setCloudflareEnv({ NATIVE_API_ENABLED: "true" });
    await expect(nativeApiEnabled()).resolves.toBe(true);
  });
});
