const PRODUCTION_COOKIE_NAME = "__Host-learner-session";
const DEVELOPMENT_COOKIE_NAME = "learner-session";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const LEARNER_SESSION_PATHS = new Set([
  "/",
  "/api/events",
  "/api/progress",
  "/api/support",
]);

export type PreparedWebRequest = {
  request: Request;
  setCookie: string | null;
};

/**
 * Removes the retired dispatcher identity surface and ensures learner requests
 * carry one high-entropy, origin-bound anonymous session.
 */
export function prepareWebRequest(
  request: Request,
  randomBytes: () => Uint8Array = secureRandomBytes,
): PreparedWebRequest {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);

  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("oai-authenticated-")) {
      headers.delete(name);
    }
  }

  if (!LEARNER_SESSION_PATHS.has(url.pathname)) {
    return {
      request: new Request(request, { headers }),
      setCookie: null,
    };
  }

  const productionCookie = isProductionCookieContext(url);
  const cookieName = productionCookie
    ? PRODUCTION_COOKIE_NAME
    : DEVELOPMENT_COOKIE_NAME;
  const existing = readUniqueCookie(headers.get("cookie"), cookieName);
  if (existing && SESSION_TOKEN_PATTERN.test(existing)) {
    return {
      request: new Request(request, { headers }),
      setCookie: null,
    };
  }

  const token = encodeSessionToken(randomBytes());
  headers.set(
    "cookie",
    replaceCookie(headers.get("cookie"), cookieName, token),
  );

  return {
    request: new Request(request, { headers }),
    setCookie: serializeSessionCookie(cookieName, token, productionCookie),
  };
}

export function readLearnerSessionToken(request: Request): string | null {
  const url = new URL(request.url);
  const preferredName = isProductionCookieContext(url)
    ? PRODUCTION_COOKIE_NAME
    : DEVELOPMENT_COOKIE_NAME;
  const token = readUniqueCookie(request.headers.get("cookie"), preferredName);
  return token && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

export function appendSetCookie(response: Response, cookie: string | null): Response {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Browser mutations must originate from the exact deployed origin. Native
 * bearer-token APIs are intentionally excluded because native clients do not
 * send browser Origin headers.
 */
export function rejectUnsafeCrossOriginWebApiRequest(
  request: Request,
): Response | null {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/api/native/") ||
    !["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())
  ) {
    return null;
  }

  const origin = request.headers.get("origin");
  if (origin === url.origin) return null;

  return Response.json(
    { error: "This request did not originate from the application." },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function isProductionCookieContext(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  );
}

function readUniqueCookie(
  header: string | null,
  cookieName: string,
): string | null {
  if (!header) return null;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => part.slice(cookieName.length + 1));
  return matches.length === 1 ? matches[0] : null;
}

function replaceCookie(
  header: string | null,
  cookieName: string,
  value: string,
): string {
  const retained = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith(`${cookieName}=`));
  retained.push(`${cookieName}=${value}`);
  return retained.join("; ");
}

function serializeSessionCookie(
  name: string,
  value: string,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
  ]
    .filter((attribute): attribute is string => Boolean(attribute))
    .join("; ");
}

function secureRandomBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function encodeSessionToken(bytes: Uint8Array): string {
  if (bytes.byteLength !== 32) {
    throw new Error("Learner session entropy must be exactly 256 bits.");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
