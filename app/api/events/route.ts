import {
  apiError,
  isOpaqueId,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { REGIONS } from "@/app/learning-data";
import { stateFromUnknown, STATE_VERSION } from "@/app/learning-engine";
import { resolveRequestIdentity } from "@/app/server-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type PropertyRule =
  | { type: "boolean"; required: boolean }
  | { type: "enum"; required: boolean; values: readonly string[] }
  | {
      type: "integer";
      required: boolean;
      min: number;
      max: number;
      values?: readonly number[];
    }
  | { type: "word-id"; required: boolean };

const REGION_IDS = REGIONS.map((region) => region.id);
const EVENT_PROPERTY_SCHEMAS = {
  app_opened: {
    currentRegionId: { type: "enum", required: true, values: REGION_IDS },
    learnedWords: { type: "integer", required: true, min: 0, max: 100_000 },
  },
  onboarding_completed: {
    level: {
      type: "enum",
      required: true,
      values: ["new", "some", "returning"],
    },
    dailyGoal: {
      type: "integer",
      required: true,
      min: 5,
      max: 15,
      values: [5, 10, 15],
    },
  },
  navigation_changed: {
    screen: {
      type: "enum",
      required: true,
      values: ["today", "journey", "review", "wordbook", "profile"],
    },
  },
  lesson_started: {
    mode: { type: "enum", required: true, values: ["learn", "review"] },
    regionId: { type: "enum", required: true, values: REGION_IDS },
    wordCount: { type: "integer", required: true, min: 1, max: 100 },
  },
  lesson_completed: {
    mode: { type: "enum", required: true, values: ["learn", "review"] },
    regionId: { type: "enum", required: true, values: REGION_IDS },
    correct: { type: "integer", required: true, min: 0, max: 100 },
    wordCount: { type: "integer", required: true, min: 1, max: 100 },
  },
  challenge_started: {
    wordCount: { type: "integer", required: true, min: 1, max: 100 },
  },
  challenge_completed: {
    correct: { type: "integer", required: true, min: 0, max: 100 },
    wordCount: { type: "integer", required: true, min: 1, max: 100 },
  },
  audio_played: {
    wordId: { type: "word-id", required: true },
    source: {
      type: "enum",
      required: false,
      values: ["asset", "speech"],
    },
  },
  audio_fallback: {
    wordId: { type: "word-id", required: true },
    reason: {
      type: "enum",
      required: true,
      values: [
        "asset-unavailable",
        "asset-playback-error",
        "asset-resume-error",
        "speech-unavailable",
      ],
    },
  },
  analytics_consent_updated: {
    enabled: { type: "boolean", required: true },
  },
} as const satisfies Record<string, Record<string, PropertyRule>>;

type EventName = keyof typeof EVENT_PROPERTY_SCHEMAS;
type Scalar = string | number | boolean;

const MAX_EVENTS_PER_HOUR = 240;
export async function POST(request: Request) {
  const identity = await resolveRequestIdentity(request).catch((error: unknown) => {
    logApiError("event_identity_failed", error);
    return null;
  });
  if (!identity) return apiError(503, "Analytics is temporarily unavailable.");
  if (!identity.ok) {
    return identity.status === 401
      ? apiError(401, "A valid browser learning session is required.")
      : apiError(503, "Analytics is temporarily unavailable.");
  }

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const event = validateEvent(body.value);
  if (!event.ok) return apiError(400, event.error);

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  try {
    const database = await getDatabase();
    if (!(await hasCurrentAnalyticsOptIn(database, identity.userKey))) {
      return apiError(403, "Optional analytics are not enabled for this account.");
    }
    const result = await database
      .prepare(
        `INSERT INTO product_events (
          id, user_key, session_id, event_name, properties, occurred_at, received_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*) FROM product_events
          WHERE user_key = ? AND received_at >= ?
        ) < ?
          AND EXISTS (
            SELECT 1 FROM learning_state AS consent
            WHERE consent.user_key = ?
              AND CASE
                WHEN json_valid(consent.payload) THEN
                  json_type(consent.payload, '$.version') IN ('integer', 'real')
                  AND json_extract(consent.payload, '$.version') = ?
                  AND json_type(
                    consent.payload,
                    '$.settings.analytics'
                  ) = 'true'
                ELSE 0
              END
          )
          AND NOT EXISTS (
            SELECT 1 FROM learner_deletion_jobs
            WHERE user_key = ?
          )`,
      )
      .bind(
        crypto.randomUUID(),
        identity.userKey,
        event.value.sessionId,
        event.value.event,
        JSON.stringify(event.value.properties),
        event.value.occurredAt,
        now,
        identity.userKey,
        oneHourAgo,
        MAX_EVENTS_PER_HOUR,
        identity.userKey,
        STATE_VERSION,
        identity.userKey,
      )
      .run();

    if ((result.meta.changes ?? 0) !== 1) {
      if (!(await hasCurrentAnalyticsOptIn(database, identity.userKey))) {
        return apiError(
          403,
          "Optional analytics are not enabled for this account.",
        );
      }
      return new Response(null, {
        status: 429,
        headers: privateHeaders({ "retry-after": "3600" }),
      });
    }

    return new Response(null, { status: 204, headers: privateHeaders() });
  } catch (error) {
    logApiError("event_write_failed", error);
    return apiError(503, "Analytics is temporarily unavailable.");
  }
}

async function hasCurrentAnalyticsOptIn(
  database: D1Database,
  userKey: string,
): Promise<boolean> {
  const consent = await database
    .prepare("SELECT payload FROM learning_state WHERE user_key = ?")
    .bind(userKey)
    .first<{ payload: string }>();
  if (!consent?.payload) return false;
  try {
    return stateFromUnknown(JSON.parse(consent.payload)).settings.analytics;
  } catch {
    return false;
  }
}

export function validateEvent(
  value: unknown,
):
  | {
      ok: true;
      value: {
        event: EventName;
        sessionId: string;
        occurredAt: number;
        properties: Record<string, Scalar>;
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(value) || !hasOnlyKeys(value, ["event", "sessionId", "occurredAt", "properties"])) {
    return { ok: false, error: "Expected event, sessionId, occurredAt, and properties only." };
  }
  if (
    typeof value.event !== "string" ||
    !(value.event in EVENT_PROPERTY_SCHEMAS)
  ) {
    return { ok: false, error: "Unsupported product event." };
  }
  if (typeof value.sessionId !== "string" || !isOpaqueId(value.sessionId)) {
    return { ok: false, error: "Invalid analytics session." };
  }
  if (typeof value.occurredAt !== "string") {
    return { ok: false, error: "Invalid event timestamp." };
  }
  const occurredAt = Date.parse(value.occurredAt);
  const now = Date.now();
  if (
    !Number.isFinite(occurredAt) ||
    occurredAt < now - 7 * 24 * 60 * 60 * 1000 ||
    occurredAt > now + 10 * 60 * 1000
  ) {
    return { ok: false, error: "Event timestamp is outside the accepted window." };
  }
  if (!isRecord(value.properties)) {
    return { ok: false, error: "Event properties must be an object." };
  }

  const eventName = value.event as EventName;
  const schema = EVENT_PROPERTY_SCHEMAS[eventName] as Record<
    string,
    PropertyRule
  >;
  const properties: Record<string, Scalar> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (
      rule.required &&
      !Object.prototype.hasOwnProperty.call(value.properties, key)
    ) {
      return {
        ok: false,
        error: `Property ${key} is required for ${eventName}.`,
      };
    }
  }
  for (const [key, property] of Object.entries(value.properties)) {
    const rule = schema[key];
    if (!rule) {
      return {
        ok: false,
        error: `Property ${key} is not allowed for ${eventName}.`,
      };
    }
    const validated = validateProperty(key, property, rule);
    if (!validated.ok) return validated;
    properties[key] = validated.value;
  }

  if (
    "correct" in properties &&
    "wordCount" in properties &&
    Number(properties.correct) > Number(properties.wordCount)
  ) {
    return { ok: false, error: "Correct answers cannot exceed word count." };
  }

  return {
    ok: true,
    value: { event: eventName, sessionId: value.sessionId, occurredAt, properties },
  };
}

function validateProperty(
  key: string,
  value: unknown,
  rule: PropertyRule,
): { ok: true; value: Scalar } | { ok: false; error: string } {
  if (rule.type === "boolean") {
    return typeof value === "boolean"
      ? { ok: true, value }
      : { ok: false, error: `Property ${key} must be a boolean.` };
  }
  if (rule.type === "integer") {
    return Number.isInteger(value) &&
      Number(value) >= rule.min &&
      Number(value) <= rule.max &&
      (!rule.values || rule.values.includes(Number(value)))
      ? { ok: true, value: Number(value) }
      : {
          ok: false,
          error: `Property ${key} must be an integer from ${rule.min} to ${rule.max}.`,
        };
  }
  if (rule.type === "enum") {
    return typeof value === "string" && rule.values.includes(value)
      ? { ok: true, value }
      : { ok: false, error: `Property ${key} has an unsupported value.` };
  }
  return typeof value === "string" &&
    value.length <= 80 &&
    /^(?:cms-)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? { ok: true, value }
    : { ok: false, error: `Property ${key} must be a curriculum word ID.` };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    allowed.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function privateHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}
