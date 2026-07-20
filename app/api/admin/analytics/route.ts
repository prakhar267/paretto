import { apiError, apiJson, logApiError } from "@/app/api/_lib/api-utils";
import { requireAdmin } from "@/app/server-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type TotalsRow = {
  total_events: number;
  active_learners: number;
  sessions: number;
};

type EventRow = { event_name: string; events: number };
type DailyRow = { date: string; active_learners: number; events: number };

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return apiError(400, "Days must be an integer from 1 to 90.");
  }

  const to = Date.now();
  const from = to - days * 24 * 60 * 60 * 1000;
  try {
    const database = await getDatabase();
    const [totals, byEvent, daily] = await Promise.all([
      database
        .prepare(
          `SELECT COUNT(*) AS total_events,
                  COUNT(DISTINCT user_key) AS active_learners,
                  COUNT(DISTINCT session_id) AS sessions
           FROM product_events WHERE occurred_at >= ? AND occurred_at <= ?`,
        )
        .bind(from, to)
        .first<TotalsRow>(),
      database
        .prepare(
          `SELECT event_name, COUNT(*) AS events
           FROM product_events WHERE occurred_at >= ? AND occurred_at <= ?
           GROUP BY event_name ORDER BY events DESC, event_name ASC`,
        )
        .bind(from, to)
        .all<EventRow>(),
      database
        .prepare(
          `SELECT date(occurred_at / 1000, 'unixepoch') AS date,
                  COUNT(DISTINCT user_key) AS active_learners,
                  COUNT(*) AS events
           FROM product_events WHERE occurred_at >= ? AND occurred_at <= ?
           GROUP BY date ORDER BY date ASC`,
        )
        .bind(from, to)
        .all<DailyRow>(),
    ]);

    return apiJson({
      window: {
        days,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
      totals: {
        events: Number(totals?.total_events ?? 0),
        activeLearners: Number(totals?.active_learners ?? 0),
        sessions: Number(totals?.sessions ?? 0),
      },
      byEvent: byEvent.results.map((row) => ({
        name: row.event_name,
        events: Number(row.events),
      })),
      daily: daily.results.map((row) => ({
        date: row.date,
        activeLearners: Number(row.active_learners),
        events: Number(row.events),
      })),
      privacy: "Aggregate counts only; raw learner identifiers are never returned.",
    });
  } catch (error) {
    logApiError("admin_analytics_failed", error);
    return apiError(503, "Analytics reporting is temporarily unavailable.");
  }
}
