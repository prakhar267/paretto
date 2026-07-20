export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonReadResult> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    return {
      ok: false,
      response: apiJson({ error: "Content-Type must be application/json." }, 415),
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return {
      ok: false,
      response: apiJson({ error: "Request payload is too large." }, 413),
    };
  }

  if (!request.body) {
    return {
      ok: false,
      response: apiJson({ error: "A JSON body is required." }, 400),
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: apiJson({ error: "Request payload is too large." }, 413),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: apiJson({ error: "The request body could not be read." }, 400),
    };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: apiJson({ error: "Invalid JSON body." }, 400),
    };
  }
}

export function apiJson(
  value: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(value, { status, headers });
}

export function apiError(
  status: number,
  error: string,
  code?: string,
): Response {
  return apiJson(code ? { error, code } : { error }, status);
}

export function logApiError(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : "unknown error",
      timestamp: new Date().toISOString(),
    }),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isOpaqueId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
