import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { scheduleServiceWorkerRegistration } from "../app/PwaRegistration";

describe("production PWA runtime", () => {
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
        location: { origin: "https://pas-a-pas.test" },
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
      Response,
      console,
    });

    let responsePromise: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://pas-a-pas.test/",
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
        location: { origin: "https://pas-a-pas.test" },
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
      Response,
      console,
    });

    const respondWith = vi.fn();
    handlers.get("fetch")?.({
      request: {
        method: "GET",
        mode: "cors",
        url: "https://pas-a-pas.test/api/progress",
        headers: new Headers(),
      },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
