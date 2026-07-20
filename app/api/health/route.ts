import { getRuntimeConfigurationReadiness } from "@/app/server-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

const SERVICE_VERSION = "1.0.0";
const SCHEMA_REVISION = "0006";

const REQUIRED_SCHEMA = {
  learning_state: ["user_key", "revision", "payload", "updated_at"],
  cms_content: [
    "id",
    "kind",
    "slug",
    "stable_key",
    "title",
    "content",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "published_at",
    "review_status",
    "reviewed_by_email",
    "reviewed_at",
    "approved_revision",
    "created_by_email",
    "updated_by_email",
  ],
  cms_vocabulary_aliases: [
    "alias",
    "content_id",
    "stable_key",
    "created_at",
  ],
  cms_slug_tombstones: [
    "kind",
    "slug",
    "stable_key",
    "content_id",
    "retired_at",
    "retired_by_email",
  ],
  cms_content_revisions: [
    "content_id",
    "revision",
    "kind",
    "slug",
    "stable_key",
    "title",
    "content",
    "status",
    "published_at",
    "actor_email",
    "action",
    "created_at",
  ],
  support_requests: [
    "id",
    "user_key",
    "reply_email",
    "category",
    "subject",
    "body",
    "status",
    "revision",
    "created_at",
    "updated_at",
  ],
  admin_audit_log: [
    "id",
    "entity_type",
    "entity_id",
    "actor_email",
    "action",
    "from_revision",
    "to_revision",
    "details",
    "created_at",
  ],
  product_events: [
    "id",
    "user_key",
    "session_id",
    "event_name",
    "properties",
    "occurred_at",
    "received_at",
  ],
  native_accounts: [
    "id",
    "apple_subject_hash",
    "email",
    "display_name",
    "created_at",
    "updated_at",
  ],
  native_sessions: [
    "token_hash",
    "id",
    "account_id",
    "expires_at",
    "created_at",
    "revoked_at",
  ],
  native_learning_state: ["account_id", "revision", "payload", "updated_at"],
  native_apple_credentials: [
    "account_id",
    "refresh_token_ciphertext",
    "updated_at",
  ],
  native_identity_token_uses: [
    "token_hash",
    "exchange_id",
    "expires_at",
    "used_at",
  ],
  retention_legal_holds: [
    "id",
    "data_class",
    "record_key",
    "reason",
    "status",
    "created_by_email",
    "created_at",
    "released_by_email",
    "released_at",
  ],
} as const;

const REQUIRED_INDEXES = [
  "cms_content_kind_slug_unique",
  "cms_content_kind_stable_key_unique",
  "cms_content_status_updated_idx",
  "cms_vocabulary_aliases_content_idx",
  "cms_vocabulary_aliases_stable_idx",
  "cms_slug_tombstones_content_idx",
  "cms_content_revisions_created_idx",
  "support_requests_user_created_idx",
  "support_requests_status_updated_idx",
  "admin_audit_entity_created_idx",
  "admin_audit_created_idx",
  "product_events_name_occurred_idx",
  "product_events_user_occurred_idx",
  "product_events_received_idx",
  "native_accounts_apple_subject_unique",
  "native_sessions_id_unique",
  "native_sessions_account_idx",
  "native_sessions_expiry_idx",
  "native_identity_token_uses_expiry_idx",
  "retention_legal_holds_status_class_idx",
] as const;

type SchemaColumn = { name: string };
type SchemaIndex = { name: string };

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const developmentPreview = process.env.NODE_ENV === "development";
  let configuration = {
    userKeySecret: false,
    adminAllowlist: false,
    appleClientId: false,
    appleServerCredentials: false,
    appleTokenEncryptionSecret: false,
    nativeSessionSecret: false,
  };

  try {
    configuration = await getRuntimeConfigurationReadiness();
  } catch (error) {
    logHealthFailure("health_configuration_check_failed", error);
  }

  let database: D1Database;
  try {
    database = await getDatabase();
    await database.prepare("SELECT 1 AS ok").first();
  } catch (error) {
    logHealthFailure("health_database_check_failed", error);
    return healthResponse(
      {
        status: "degraded",
        service: "pas-a-pas-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "unavailable",
          schema: "unknown",
          userKeySecret: configuration.userKeySecret
            ? "ready"
            : "misconfigured",
          adminAllowlist: configuration.adminAllowlist
            ? "ready"
            : "misconfigured",
          appleClientId: configuration.appleClientId
            ? "ready"
            : "misconfigured",
          appleServerCredentials: configuration.appleServerCredentials
            ? "ready"
            : "misconfigured",
          appleTokenEncryptionSecret: configuration.appleTokenEncryptionSecret
            ? "ready"
            : "misconfigured",
          nativeSessionSecret: configuration.nativeSessionSecret
            ? "ready"
            : "misconfigured",
        },
        database: "unavailable",
      },
      503,
    );
  }

  try {
    await verifyRequiredSchema(database);
  } catch (error) {
    logHealthFailure("health_schema_check_failed", error);
    return healthResponse(
      {
        status: "degraded",
        service: "pas-a-pas-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "ready",
          schema: "incomplete",
          userKeySecret: configuration.userKeySecret
            ? "ready"
            : "misconfigured",
          adminAllowlist: configuration.adminAllowlist
            ? "ready"
            : "misconfigured",
          appleClientId: configuration.appleClientId
            ? "ready"
            : "misconfigured",
          appleServerCredentials: configuration.appleServerCredentials
            ? "ready"
            : "misconfigured",
          appleTokenEncryptionSecret: configuration.appleTokenEncryptionSecret
            ? "ready"
            : "misconfigured",
          nativeSessionSecret: configuration.nativeSessionSecret
            ? "ready"
            : "misconfigured",
        },
        database: "ready",
      },
      503,
    );
  }

  const productionReady =
    configuration.userKeySecret &&
    configuration.adminAllowlist &&
    configuration.appleClientId &&
    configuration.appleServerCredentials &&
    configuration.appleTokenEncryptionSecret &&
    configuration.nativeSessionSecret;
  const serviceReady = productionReady || developmentPreview;
  return healthResponse(
    {
      status: serviceReady ? "ok" : "degraded",
      service: "pas-a-pas-web",
      version: SERVICE_VERSION,
      schemaRevision: SCHEMA_REVISION,
      productionReady,
      environment: developmentPreview ? "development-preview" : "production",
      warnings:
        developmentPreview && !productionReady
          ? [
              "Local preview fallbacks are active; production runtime values remain required before deployment.",
            ]
          : [],
      checkedAt,
      latencyMs: Date.now() - startedAt,
      checks: {
        database: "ready",
        schema: "ready",
        userKeySecret: configuration.userKeySecret
          ? "ready"
          : developmentPreview
            ? "preview-fallback"
            : "misconfigured",
        adminAllowlist: configuration.adminAllowlist
          ? "ready"
          : developmentPreview
            ? "preview-fallback"
            : "misconfigured",
        appleClientId: configuration.appleClientId
          ? "ready"
          : developmentPreview
            ? "native-disabled"
            : "misconfigured",
        appleServerCredentials: configuration.appleServerCredentials
          ? "ready"
          : developmentPreview
            ? "native-disabled"
            : "misconfigured",
        appleTokenEncryptionSecret: configuration.appleTokenEncryptionSecret
          ? "ready"
          : developmentPreview
            ? "native-disabled"
            : "misconfigured",
        nativeSessionSecret: configuration.nativeSessionSecret
          ? "ready"
          : developmentPreview
            ? "native-disabled"
            : "misconfigured",
      },
      database: "ready",
    },
    serviceReady ? 200 : 503,
  );
}

export async function verifyRequiredSchema(database: D1Database): Promise<void> {
  const tableEntries = Object.entries(REQUIRED_SCHEMA);
  const columnResults = await Promise.all(
    tableEntries.map(([tableName]) =>
      database
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all<SchemaColumn>(),
    ),
  );

  const missing: string[] = [];
  for (let index = 0; index < tableEntries.length; index += 1) {
    const [tableName, requiredColumns] = tableEntries[index];
    const actualColumns = new Set(
      columnResults[index].results.map((column) => column.name),
    );
    for (const column of requiredColumns) {
      if (!actualColumns.has(column)) missing.push(`${tableName}.${column}`);
    }
  }

  const placeholders = REQUIRED_INDEXES.map(() => "?").join(", ");
  const indexes = await database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${placeholders})`,
    )
    .bind(...REQUIRED_INDEXES)
    .all<SchemaIndex>();
  const actualIndexes = new Set(indexes.results.map((index) => index.name));
  for (const indexName of REQUIRED_INDEXES) {
    if (!actualIndexes.has(indexName)) missing.push(`index:${indexName}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Required database migration ${SCHEMA_REVISION} is incomplete (${missing.join(", ")}).`,
    );
  }
}

function healthResponse(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function logHealthFailure(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : "unknown error",
      timestamp: new Date().toISOString(),
    }),
  );
}
