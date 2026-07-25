import { describe, expect, it } from "vitest";

import { createHealthResponseCache } from "../worker/health-cache";

function health(status = 200, options: { cookie?: boolean } = {}) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  if (options.cookie) headers.set("set-cookie", "private=value");
  return new Response(JSON.stringify({ status: status === 200 ? "ok" : "degraded" }), {
    status,
    headers,
  });
}

describe("bounded deep health caching", () => {
  it("keeps request I/O isolated and respects the short TTL", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createHealthResponseCache({ now: () => now });
    const request = new Request("https://paretto.example/api/health?bust=one");
    const fetchResponse = async () => {
      calls += 1;
      await Promise.resolve();
      return health();
    };

    const responses = await Promise.all([
      cache({ request, fetchResponse }),
      cache({ request, fetchResponse }),
      cache({ request, fetchResponse }),
    ]);

    expect(calls).toBe(3);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { status: "ok" },
      { status: "ok" },
      { status: "ok" },
    ]);
    expect(responses[0].headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );

    now += 29_999;
    const memoryHit = await cache({ request, fetchResponse });
    await expect(memoryHit.json()).resolves.toEqual({ status: "ok" });
    expect(calls).toBe(3);

    now += 2;
    await cache({ request, fetchResponse });
    expect(calls).toBe(4);
  });

  it("caches degraded readiness briefly without hiding recovery for 30 seconds", async () => {
    let now = 10_000;
    let calls = 0;
    const cache = createHealthResponseCache({ now: () => now });
    const request = new Request("https://paretto.example/api/health");
    const fetchResponse = async () => {
      calls += 1;
      return health(503);
    };

    const first = await cache({ request, fetchResponse });
    expect(first.status).toBe(503);
    expect(first.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    now += 4_999;
    await cache({ request, fetchResponse });
    expect(calls).toBe(1);
    now += 2;
    await cache({ request, fetchResponse });
    expect(calls).toBe(2);
  });

  it("never caches a response that could carry identity state", async () => {
    let calls = 0;
    const cache = createHealthResponseCache();
    const request = new Request("https://paretto.example/api/health");
    const fetchResponse = async () => {
      calls += 1;
      return health(200, { cookie: true });
    };

    const first = await cache({ request, fetchResponse });
    const second = await cache({ request, fetchResponse });

    expect(calls).toBe(2);
    expect(first.headers.get("set-cookie")).toBe("private=value");
    expect(second.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("uses one query-independent edge key across isolates sharing a POP cache", async () => {
    const stored = new Map<string, Response>();
    const edgeCache = {
      async match(request: Request) {
        return stored.get(request.url)?.clone();
      },
      async put(request: Request, response: Response) {
        stored.set(request.url, response.clone());
      },
    };
    let calls = 0;
    const waiters: Promise<unknown>[] = [];
    const firstIsolate = createHealthResponseCache();
    await firstIsolate({
      request: new Request("https://paretto.example/api/health?bust=one"),
      fetchResponse: async () => {
        calls += 1;
        return health();
      },
      edgeCache,
      waitUntil: (promise) => waiters.push(promise),
    });
    await Promise.all(waiters);

    const secondIsolate = createHealthResponseCache();
    const edgeHit = await secondIsolate({
      request: new Request("https://paretto.example/api/health?bust=two"),
      fetchResponse: async () => {
        calls += 1;
        return health();
      },
      edgeCache,
    });

    expect(calls).toBe(1);
    expect([...stored.keys()]).toEqual([
      "https://paretto.example/api/health",
    ]);
    expect(stored.get("https://paretto.example/api/health")?.headers.get(
      "cache-control",
    )).toBe("public, max-age=30");
    expect(edgeHit.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(await edgeHit.json()).toEqual({ status: "ok" });
  });

  it("documents that simultaneous cold isolates can each perform one deep check", async () => {
    let calls = 0;
    let releaseFetches: (() => void) | undefined;
    const fetchesMayFinish = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const fetchResponse = async () => {
      calls += 1;
      await fetchesMayFinish;
      return health();
    };
    const request = new Request("https://paretto.example/api/health");
    const first = createHealthResponseCache();
    const second = createHealthResponseCache();

    const responses = Promise.all([
      first({ request, fetchResponse }),
      second({ request, fetchResponse }),
    ]);
    await Promise.resolve();
    expect(calls).toBe(2);
    releaseFetches?.();
    await responses;
  });
});
