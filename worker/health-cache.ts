type HealthCacheEntry = {
  expiresAt: number;
  response: HealthResponseSnapshot;
};

type HealthResponseSnapshot = {
  body: ArrayBuffer;
  headers: [string, string][];
  status: number;
  statusText: string;
};

type EdgeResponseCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type HealthResponseCacheOptions = {
  successTtlMs?: number;
  degradedTtlMs?: number;
  now?: () => number;
};

type HealthResponseRequest = {
  request: Request;
  fetchResponse: () => Promise<Response>;
  edgeCache?: EdgeResponseCache;
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * Briefly caches the expensive, identity-free deep health result.
 *
 * The cache key deliberately ignores the query string so an attacker cannot
 * force fresh D1 schema queries with cache-busting parameters. Security and
 * request-ID headers are added after this layer by the Worker entry point.
 * Only plain response data is retained globally: Cloudflare request-owned
 * streams and in-flight I/O promises must never cross invocation contexts.
 */
export function createHealthResponseCache(
  options: HealthResponseCacheOptions = {},
) {
  const successTtlMs = options.successTtlMs ?? 30_000;
  const degradedTtlMs = options.degradedTtlMs ?? 5_000;
  const now = options.now ?? Date.now;
  let memory: HealthCacheEntry | undefined;

  return async function cachedHealthResponse({
    request,
    fetchResponse,
    edgeCache,
    waitUntil,
  }: HealthResponseRequest): Promise<Response> {
    const cacheKey = normalizedHealthCacheKey(request);

    if (edgeCache) {
      const edgeHit = await edgeCache.match(cacheKey).catch(() => undefined);
      if (edgeHit) {
        return clientHealthResponse(
          await snapshotHealthResponse(edgeHit),
          request.method,
        );
      }
    }

    const checkedAt = now();
    if (memory && memory.expiresAt > checkedAt) {
      return clientHealthResponse(memory.response, request.method);
    }

    const response = await fetchResponse();
    const snapshot = await snapshotHealthResponse(response);
    if (!cacheableHealthResponse(response)) {
      return clientHealthResponse(snapshot, request.method);
    }

    const ttlMs = response.status === 200
      ? successTtlMs
      : degradedTtlMs;
    const cacheable = withEdgeHealthCachePolicy(snapshot, ttlMs);
    memory = {
      expiresAt: now() + ttlMs,
      response: cacheable,
    };

    if (edgeCache) {
      const write = edgeCache
        .put(cacheKey, responseFromSnapshot(cacheable))
        .catch(() => undefined);
      if (waitUntil) waitUntil(write);
      else await write;
    }
    return clientHealthResponse(cacheable, request.method);
  };
}

function normalizedHealthCacheKey(request: Request): Request {
  const url = new URL("/api/health", request.url);
  return new Request(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
}

function cacheableHealthResponse(response: Response): boolean {
  return (
    (response.status === 200 || response.status === 503) &&
    !response.headers.has("set-cookie") &&
    response.headers.get("content-type")?.includes("application/json") === true
  );
}

function withEdgeHealthCachePolicy(
  response: HealthResponseSnapshot,
  ttlMs: number,
): HealthResponseSnapshot {
  const headers = new Headers(response.headers);
  const seconds = Math.max(1, Math.floor(ttlMs / 1_000));
  headers.set("cache-control", `public, max-age=${seconds}`);
  return {
    ...response,
    headers: [...headers.entries()],
  };
}

function clientHealthResponse(
  response: HealthResponseSnapshot,
  requestMethod: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  return new Response(
    requestMethod.toUpperCase() === "HEAD"
      ? null
      : response.body.slice(0),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

async function snapshotHealthResponse(
  response: Response,
): Promise<HealthResponseSnapshot> {
  return {
    body: await response.arrayBuffer(),
    headers: [...response.headers.entries()],
    status: response.status,
    statusText: response.statusText,
  };
}

function responseFromSnapshot(
  response: HealthResponseSnapshot,
): Response {
  return new Response(response.body.slice(0), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
