import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { scheduleServiceWorkerRegistration } from "../app/PwaRegistration";

describe("production PWA runtime", () => {
  it("keeps the offline shell on the current Paretto brand", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/offline.html"),
      "utf8",
    );

    expect(source).toContain("<title>Reconnect to Paretto</title>");
    expect(source).toContain('<span class="mark" aria-hidden="true">P</span>');
    expect(source).toContain(
      "Paretto needs a connection to reopen the application",
    );
    expect(source).toContain(
      "This offline page contains no learning or lesson data.",
    );
    expect(source).not.toMatch(/Loquivo|class="mark"[^>]*>L</i);
  });

  it("registers immediately when hydration runs after window load", () => {
    const register = vi.fn(async () => undefined);
    const addLoadListener = vi.fn();
    const removeLoadListener = vi.fn();

    const cleanup = scheduleServiceWorkerRegistration({
      readyState: "complete",
      addLoadListener,
      removeLoadListener,
      register,
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(addLoadListener).not.toHaveBeenCalled();
    cleanup();
    expect(removeLoadListener).toHaveBeenCalledTimes(1);
  });

  it("waits for load when needed and ignores a late event after cleanup", () => {
    const register = vi.fn(async () => undefined);
    let loadListener: (() => void) | undefined;
    const cleanup = scheduleServiceWorkerRegistration({
      readyState: "interactive",
      addLoadListener: (listener) => {
        loadListener = listener;
      },
      removeLoadListener: vi.fn(),
      register,
    });

    expect(register).not.toHaveBeenCalled();
    loadListener?.();
    expect(register).toHaveBeenCalledTimes(1);
    cleanup();
    loadListener?.();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("serves only the identity-free shell after an offline app navigation", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/service-worker.js"),
      "utf8",
    );
    expect(source).toContain('const STATIC_CACHE = "paretto-static-v6"');
    const handlers = new Map<string, (event: unknown) => void>();
    const offlineShell = new Response("identity-free offline shell", {
      headers: { "content-type": "text/html" },
    });
    const cache = {
      addAll: vi.fn(async () => undefined),
      match: vi.fn(async () => offlineShell),
      put: vi.fn(async () => undefined),
    };
    const networkFetch = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });

    runInNewContext(source, {
      self: {
        location: { origin: "https://paretto.test" },
        clients: { claim: vi.fn(async () => undefined) },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
        },
      },
      caches: {
        open: vi.fn(async () => cache),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      fetch: networkFetch,
      URL,
      Request,
      Response,
      console,
    });

    let responsePromise: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://paretto.test/",
        headers: new Headers(),
      },
      respondWith: (response: Promise<Response>) => {
        responsePromise = response;
      },
    });

    expect(responsePromise).toBeDefined();
    if (!responsePromise) throw new Error("Navigation was not intercepted.");
    const response = await responsePromise;
    expect(await response.text()).toBe("identity-free offline shell");
    expect(cache.match).toHaveBeenCalledWith("/offline.html");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("keeps progress APIs network-only", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/service-worker.js"),
      "utf8",
    );
    const handlers = new Map<string, (event: unknown) => void>();
    const networkFetch = vi.fn();

    runInNewContext(source, {
      self: {
        location: { origin: "https://paretto.test" },
        clients: { claim: vi.fn(async () => undefined) },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
        },
      },
      caches: {
        open: vi.fn(),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      fetch: networkFetch,
      URL,
      Request,
      Response,
      console,
    });

    const respondWith = vi.fn();
    handlers.get("fetch")?.({
      request: {
        method: "GET",
        mode: "cors",
        url: "https://paretto.test/api/progress",
        headers: new Headers(),
      },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("refreshes identity-free install assets without credentials", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/service-worker.js"),
      "utf8",
    );
    const handlers = new Map<string, (event: unknown) => void>();
    const addAll = vi.fn(async (requests: Request[]) => {
      void requests;
    });

    runInNewContext(source, {
      self: {
        location: { origin: "https://paretto.test" },
        clients: { claim: vi.fn(async () => undefined) },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
        },
      },
      caches: {
        open: vi.fn(async () => ({ addAll })),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      fetch: vi.fn(),
      URL,
      Request,
      Response,
      console,
    });

    let installWork: Promise<unknown> | undefined;
    handlers.get("install")?.({
      waitUntil: (work: Promise<unknown>) => {
        installWork = work;
      },
    });
    await installWork;

    const requests = addAll.mock.calls[0][0] as Request[];
    expect(
      requests.map((request) => ({
        pathname: new URL(request.url).pathname,
        cache: request.cache,
        credentials: request.credentials,
      })),
    ).toEqual([
      { pathname: "/offline.html", cache: "reload", credentials: "omit" },
      { pathname: "/favicon.svg", cache: "reload", credentials: "omit" },
      {
        pathname: "/apple-touch-icon.png",
        cache: "reload",
        credentials: "omit",
      },
      { pathname: "/icon-192.png", cache: "reload", credentials: "omit" },
      { pathname: "/icon-512.png", cache: "reload", credentials: "omit" },
      {
        pathname: "/manifest.webmanifest",
        cache: "reload",
        credentials: "omit",
      },
    ]);
  });

  it("replaces the redirected v5 shell cache while preserving pronunciation audio", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/service-worker.js"),
      "utf8",
    );
    const handlers = new Map<string, (event: unknown) => void>();
    const deleteCache = vi.fn(async () => true);
    const claim = vi.fn(async () => undefined);

    runInNewContext(source, {
      self: {
        location: { origin: "https://paretto.test" },
        clients: { claim },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
        },
      },
      caches: {
        open: vi.fn(),
        keys: vi.fn(async () => [
          "paretto-static-v5",
          "paretto-static-v6",
          "pas-a-pas-audio-v1",
        ]),
        delete: deleteCache,
      },
      fetch: vi.fn(),
      URL,
      Request,
      Response,
      console,
    });

    let activateWork: Promise<unknown> | undefined;
    handlers.get("activate")?.({
      waitUntil: (work: Promise<unknown>) => {
        activateWork = work;
      },
    });
    await activateWork;

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith("paretto-static-v5");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("caches only allowlisted public assets without query data or credentials", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../public/service-worker.js"),
      "utf8",
    );
    const handlers = new Map<string, (event: unknown) => void>();
    const cache = {
      addAll: vi.fn(async (requests: Request[]) => {
        void requests;
      }),
      match: vi.fn(async (request: Request) => {
        void request;
        return new Response("audio");
      }),
      put: vi.fn(async (request: Request, response: Response) => {
        void request;
        void response;
      }),
    };

    runInNewContext(source, {
      self: {
        location: { origin: "https://paretto.test" },
        clients: { claim: vi.fn(async () => undefined) },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
        },
      },
      caches: {
        open: vi.fn(async () => cache),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      fetch: vi.fn(),
      URL,
      Request,
      Response,
      console,
    });

    let cacheResponse: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: new Request(
        "https://paretto.test/audio/fr/v1/le-metro.wav",
        { headers: { cookie: "private=learner" } },
      ),
      respondWith: (response: Promise<Response>) => {
        cacheResponse = response;
      },
    });
    expect(cacheResponse).toBeDefined();
    await cacheResponse;
    const cachedRequest = cache.match.mock.calls[0][0] as Request;
    expect(cachedRequest.credentials).toBe("omit");
    expect(cachedRequest.headers.get("cookie")).toBeNull();

    let staticResponse: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: new Request(
        "https://paretto.test/manifest.webmanifest",
        { headers: { cookie: "private=learner" } },
      ),
      respondWith: (response: Promise<Response>) => {
        staticResponse = response;
      },
    });
    expect(staticResponse).toBeDefined();
    await staticResponse;
    const cachedStaticRequest = cache.match.mock.calls.at(-1)?.[0] as Request;
    expect(cachedStaticRequest.credentials).toBe("omit");
    expect(cachedStaticRequest.headers.get("cookie")).toBeNull();

    for (const url of [
      "https://paretto.test/audio/fr/v1/le-metro.wav?learner=private",
      "https://paretto.test/audio/generated/private.wav",
      "https://paretto.test/manifest.webmanifest?learner=private",
      "https://paretto.test/sign-in",
    ]) {
      const respondWith = vi.fn();
      handlers.get("fetch")?.({
        request: new Request(url),
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
});
