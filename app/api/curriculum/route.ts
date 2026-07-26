import { getPublishedCurriculum } from "@/app/published-curriculum.server";
import { DEFAULT_COURSE_ID } from "@/app/course-catalog";
import { parsePublishedCourseId } from "@/app/api/_lib/content-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawCourseId = url.searchParams.get("courseId");
  const courseId =
    rawCourseId === null
      ? DEFAULT_COURSE_ID
      : parsePublishedCourseId(rawCourseId);
  if (!courseId) {
    return Response.json(
      { error: "Invalid or unpublished course." },
      {
        status: 400,
        headers: {
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
  const curriculum = await getPublishedCurriculum(courseId);
  const payload = JSON.stringify({ schemaVersion: 1, ...curriculum });
  const etag = `"${await sha256(payload)}"`;
  const headers = responseHeaders(
    etag,
    curriculum.source !== "compiled-fallback",
  );

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(payload, { status: 200, headers });
}

function responseHeaders(etag: string, databaseReady: boolean): Headers {
  const headers = new Headers({
    etag,
    vary: "accept-encoding",
    "x-content-type-options": "nosniff",
  });
  headers.set(
    "cache-control",
    databaseReady
      ? "public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400"
      : "public, max-age=15, s-maxage=30, stale-if-error=86400",
  );
  return headers;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
