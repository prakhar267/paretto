import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const database = await getDatabase();
    await database.prepare("SELECT 1 AS ok").first();
    return Response.json(
      { status: "ok", database: "ready", latencyMs: Date.now() - startedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "health_check_failed",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return Response.json(
      { status: "degraded", database: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
