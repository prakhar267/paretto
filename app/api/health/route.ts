import {
  getRuntimeConfigurationReadiness,
  type RuntimeConfigurationReadiness,
} from "@/app/server-auth";
import { readScheduledRetentionStatus } from "@/app/retention-policy";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

const SERVICE_VERSION = "1.4.1";
const SCHEMA_REVISION = "0013";
const QUEUE_STALE_AFTER_MS = 60 * 60 * 1000;
const QUEUE_COUNT_REPORT_LIMIT = 1_000;

const REQUIRED_SCHEMA = {
  learning_state: ["user_key", "revision", "payload", "updated_at"],
  learner_progress_generations: ["user_key", "generation", "updated_at"],
  learner_user: [
    "id",
    "name",
    "email",
    "email_verified",
    "image",
    "username",
    "display_username",
    "created_at",
    "updated_at",
  ],
  learner_session: [
    "id",
    "expires_at",
    "token",
    "created_at",
    "updated_at",
    "ip_address",
    "user_agent",
    "user_id",
  ],
  learner_account: [
    "id",
    "account_id",
    "provider_id",
    "user_id",
    "access_token",
    "refresh_token",
    "id_token",
    "access_token_expires_at",
    "refresh_token_expires_at",
    "scope",
    "password",
    "created_at",
    "updated_at",
  ],
  learner_verification: [
    "id",
    "identifier",
    "value",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  learner_auth_rate_limits: [
    "bucket_hash",
    "request_count",
    "last_request_at",
    "updated_at",
  ],
  learner_recovery_codes: [
    "code_hash",
    "user_id",
    "generation_id",
    "created_at",
  ],
  learner_recovery_state: ["user_id", "generation_id", "updated_at"],
  learner_identity_links: ["anonymous_user_key", "account_id", "linked_at"],
  admin_login_attempts: [
    "ip_hash",
    "window_started_at",
    "failed_attempts",
    "blocked_until",
    "updated_at",
  ],
  cms_content: [
    "id",
    "course_id",
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
    "course_id",
    "alias",
    "content_id",
    "stable_key",
    "created_at",
  ],
  cms_slug_tombstones: [
    "course_id",
    "kind",
    "slug",
    "stable_key",
    "content_id",
    "retired_at",
    "retired_by_email",
  ],
  cms_content_revisions: [
    "course_id",
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
  support_rate_limits: [
    "bucket_hash",
    "window_started_at",
    "request_count",
    "last_reservation_id",
    "updated_at",
  ],
  support_notification_jobs: [
    "id",
    "support_request_id",
    "event_type",
    "support_revision",
    "support_status",
    "recipient_email",
    "status",
    "attempts",
    "available_at",
    "lease_expires_at",
    "last_error",
    "completed_at",
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
  native_learner_links: ["native_account_id", "learner_user_id", "linked_at"],
  native_sessions: [
    "token_hash",
    "id",
    "account_id",
    "expires_at",
    "created_at",
    "revoked_at",
  ],
  native_learning_state: [
    "account_id",
    "revision",
    "reset_generation",
    "payload",
    "updated_at",
  ],
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
  learner_deletion_jobs: [
    "user_id",
    "user_key",
    "native_account_id",
    "status",
    "requested_at",
    "completed_at",
    "attempts",
    "last_error",
    "updated_at",
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
  retention_schedule_state: [
    "job_name",
    "status",
    "monitoring_started_at",
    "run_id",
    "scheduled_at",
    "started_at",
    "completed_at",
    "last_succeeded_at",
    "last_failed_at",
    "last_error",
    "last_result",
    "updated_at",
  ],
} as const;

const REQUIRED_INDEXES = [
  "learner_user_email_unique",
  "learner_user_username_unique",
  "learner_session_token_unique",
  "learner_session_user_idx",
  "learner_session_expiry_idx",
  "learner_account_user_idx",
  "learner_account_provider_unique",
  "learner_verification_identifier_idx",
  "learner_verification_expiry_idx",
  "learner_auth_rate_limits_updated_idx",
  "learner_recovery_codes_user_generation_idx",
  "learner_identity_links_account_idx",
  "admin_login_attempts_updated_idx",
  "cms_content_kind_slug_unique",
  "cms_content_kind_stable_key_unique",
  "cms_content_status_updated_idx",
  "cms_vocabulary_aliases_content_idx",
  "cms_vocabulary_aliases_stable_idx",
  "cms_slug_tombstones_content_idx",
  "cms_content_revisions_created_idx",
  "support_requests_user_created_idx",
  "support_requests_status_updated_idx",
  "support_rate_limits_updated_idx",
  "support_notification_jobs_event_unique",
  "support_notification_jobs_delivery_idx",
  "admin_audit_entity_created_idx",
  "admin_audit_created_idx",
  "product_events_name_occurred_idx",
  "product_events_user_occurred_idx",
  "product_events_received_idx",
  "native_accounts_apple_subject_unique",
  "native_learner_links_user_unique",
  "native_sessions_id_unique",
  "native_sessions_account_idx",
  "native_sessions_expiry_idx",
  "native_identity_token_uses_expiry_idx",
  "learner_deletion_jobs_status_updated_idx",
  "retention_legal_holds_status_class_idx",
] as const;

type SchemaColumn = { name: string };
type SchemaIndex = { name: string };
type DeletionQueueRow = {
  pending: number | null;
  held: number | null;
  with_errors: number | null;
  oldest_pending_at: number | null;
};
type SupportQueueRow = {
  open_jobs: number | null;
  failed_jobs: number | null;
  oldest_open_at: number | null;
};

export async function GET() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const developmentPreview = process.env.NODE_ENV === "development";
  let configuration: RuntimeConfigurationReadiness = {
    launchMode: null,
    workersPlan: null,
    userKeySecret: false,
    supportRateLimitSecret: false,
    learnerAuthRateLimitSecret: false,
    learnerAuthentication: false,
    learnerAuthOrigin: false,
    learnerParettoIdAccountCreation: false,
    learnerParettoIdSignIn: false,
    learnerRecoveryCodes: false,
    learnerEmailAccountCreation: false,
    learnerEmailVerification: false,
    learnerPasswordReset: false,
    learnerGoogleAuth: false,
    learnerAppleAuth: false,
    supportNotifications: false,
    adminAllowlist: false,
    adminAuthentication: false,
    turnstileSiteKey: false,
    turnstileSecret: false,
    nativeApiEnabled: false,
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
  const runtimeReadiness = evaluateRuntimeReadiness(configuration);

  let database: D1Database;
  try {
    database = await getDatabase();
    await database.prepare("SELECT 1 AS ok").first();
  } catch (error) {
    logHealthFailure("health_database_check_failed", error);
    return healthResponse(
      {
        status: "degraded",
        service: "paretto-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        webReady: false,
        nativeReady: runtimeReadiness.nativeReady,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "unavailable",
          schema: "unknown",
          retentionSchedule: "unknown",
          ...configurationCheckStatuses(configuration),
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
        service: "paretto-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        webReady: false,
        nativeReady: runtimeReadiness.nativeReady,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "ready",
          schema: "incomplete",
          retentionSchedule: "unknown",
          ...configurationCheckStatuses(configuration),
        },
        database: "ready",
      },
      503,
    );
  }

  let retentionSchedule: Awaited<
    ReturnType<typeof readScheduledRetentionStatus>
  >;
  try {
    retentionSchedule = await readScheduledRetentionStatus(database);
  } catch (error) {
    logHealthFailure("health_retention_schedule_check_failed", error);
    return healthResponse(
      {
        status: "degraded",
        service: "paretto-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        webReady: runtimeReadiness.webReady,
        nativeReady: runtimeReadiness.nativeReady,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "ready",
          schema: "ready",
          retentionSchedule: "unavailable",
          ...configurationCheckStatuses(configuration),
        },
        database: "ready",
      },
      503,
    );
  }

  let queueReadiness: Awaited<ReturnType<typeof readQueueReadiness>>;
  try {
    queueReadiness = await readQueueReadiness(database);
  } catch (error) {
    logHealthFailure("health_queue_check_failed", error);
    return healthResponse(
      {
        status: "degraded",
        service: "paretto-web",
        version: SERVICE_VERSION,
        schemaRevision: SCHEMA_REVISION,
        productionReady: false,
        webReady: runtimeReadiness.webReady,
        nativeReady: runtimeReadiness.nativeReady,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        checks: {
          database: "ready",
          schema: "ready",
          retentionSchedule: retentionSchedule.health,
          accountDeletionQueue: "unavailable",
          supportNotificationQueue: "unavailable",
          ...configurationCheckStatuses(configuration),
        },
        database: "ready",
      },
      503,
    );
  }

  const { webReady, nativeReady } = runtimeReadiness;
  const productionReady =
    runtimeReadiness.productionReady &&
    retentionSchedule.healthy &&
    queueReadiness.healthy;
  const controlledBetaReady =
    configuration.launchMode === "controlled-beta" &&
    configuration.workersPlan !== null &&
    webReady &&
    retentionSchedule.healthy &&
    queueReadiness.healthy;
  const serviceReady =
    productionReady || controlledBetaReady || developmentPreview;
  const parettoAccountReady =
    configuration.learnerParettoIdAccountCreation &&
    configuration.learnerParettoIdSignIn &&
    configuration.learnerRecoveryCodes;
  const warnings = [
    ...(configuration.launchMode === "controlled-beta"
      ? [
          "Controlled beta mode is operational but is not approved for a broad public launch.",
        ]
      : []),
    ...(!configuration.learnerPasswordReset
      ? [
          parettoAccountReady
            ? "Optional transactional email is not configured; Paretto ID account creation and recovery codes remain available."
            : "Optional transactional email is not configured.",
        ]
      : []),
    ...(!configuration.supportNotifications
      ? [
          "Operator support email delivery is not configured; tickets remain stored for authenticated administrator follow-up.",
        ]
      : []),
    ...(configuration.launchMode === null && !developmentPreview
      ? ["LAUNCH_MODE is missing or invalid."]
      : []),
    ...(configuration.workersPlan === null && !developmentPreview
      ? ["WORKERS_PLAN is missing or invalid."]
      : []),
    ...(configuration.launchMode === "public" &&
    configuration.workersPlan !== "paid"
      ? [
          "Public Paretto ID launch requires Workers Paid for the password-security CPU workload.",
        ]
      : []),
    ...(developmentPreview
      ? [
          ...(!runtimeReadiness.productionReady
            ? [
                "Development preview is available, but production runtime bindings remain incomplete.",
              ]
            : []),
          ...(!retentionSchedule.healthy
            ? [`Scheduled retention health is ${retentionSchedule.health}.`]
            : []),
          ...(!queueReadiness.healthy
            ? ["A durable operations queue requires attention."]
            : []),
        ]
      : []),
  ];
  return healthResponse(
    {
      status: serviceReady ? "ok" : "degraded",
      service: "paretto-web",
      version: SERVICE_VERSION,
      schemaRevision: SCHEMA_REVISION,
      productionReady,
      webReady,
      nativeReady,
      launchMode: configuration.launchMode,
      workersPlan: configuration.workersPlan,
      environment: developmentPreview ? "development-preview" : "production",
      warnings,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      checks: {
        database: "ready",
        schema: "ready",
        retentionSchedule: retentionSchedule.health,
        accountDeletionQueue: queueReadiness.accountDeletion.status,
        supportNotificationQueue: queueReadiness.supportNotifications.status,
        ...configurationCheckStatuses(configuration),
      },
      queues: {
        accountDeletion: queueReadiness.accountDeletion,
        supportNotifications: queueReadiness.supportNotifications,
      },
      retentionSchedule: {
        status: retentionSchedule.health,
        missed: retentionSchedule.missed,
        monitoringStartedAt: retentionSchedule.monitoringStartedAt,
        scheduledAt: retentionSchedule.scheduledAt,
        startedAt: retentionSchedule.startedAt,
        completedAt: retentionSchedule.completedAt,
        lastSucceededAt: retentionSchedule.lastSucceededAt,
        lastFailedAt: retentionSchedule.lastFailedAt,
        nextExpectedAt: retentionSchedule.nextExpectedAt,
      },
      database: "ready",
    },
    serviceReady ? 200 : 503,
  );
}

export async function readQueueReadiness(
  database: D1Database,
  now = Date.now(),
) {
  const [deletion, support] = await Promise.all([
    database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM (
             SELECT 1 FROM learner_deletion_jobs AS jobs
             WHERE jobs.status = 'pending'
             LIMIT ?
           )) AS pending,
           (SELECT COUNT(*) FROM (
             SELECT 1 FROM learner_deletion_jobs AS jobs
             WHERE jobs.status = 'held'
             LIMIT ?
           )) AS held,
           (SELECT COUNT(*) FROM (
             SELECT 1 FROM learner_deletion_jobs AS jobs
             WHERE jobs.status IN ('pending', 'held')
               AND jobs.last_error IS NOT NULL
             LIMIT ?
           )) AS with_errors,
           (SELECT jobs.updated_at
            FROM learner_deletion_jobs AS jobs
            WHERE jobs.status = 'pending'
            ORDER BY jobs.updated_at ASC, jobs.user_id ASC
            LIMIT 1) AS oldest_pending_at`,
      )
      .bind(
        QUEUE_COUNT_REPORT_LIMIT + 1,
        QUEUE_COUNT_REPORT_LIMIT + 1,
        QUEUE_COUNT_REPORT_LIMIT + 1,
      )
      .first<DeletionQueueRow>(),
    database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM (
             SELECT 1 FROM support_notification_jobs AS jobs
             WHERE jobs.status IN ('pending', 'processing', 'failed')
             LIMIT ?
           )) AS open_jobs,
           (SELECT COUNT(*) FROM (
             SELECT 1 FROM support_notification_jobs AS jobs
             WHERE jobs.status = 'failed'
             LIMIT ?
           )) AS failed_jobs,
           (SELECT jobs.updated_at
            FROM support_notification_jobs AS jobs
            WHERE jobs.status IN ('pending', 'processing', 'failed')
            ORDER BY jobs.updated_at ASC, jobs.id ASC
            LIMIT 1) AS oldest_open_at`,
      )
      .bind(QUEUE_COUNT_REPORT_LIMIT + 1, QUEUE_COUNT_REPORT_LIMIT + 1)
      .first<SupportQueueRow>(),
  ]);
  const pending = Number(deletion?.pending ?? 0);
  const held = Number(deletion?.held ?? 0);
  const deletionErrors = Number(deletion?.with_errors ?? 0);
  const oldestPendingAt =
    typeof deletion?.oldest_pending_at === "number"
      ? deletion.oldest_pending_at
      : null;
  const deletionStalled =
    oldestPendingAt !== null && oldestPendingAt < now - QUEUE_STALE_AFTER_MS;
  const accountDeletionStatus =
    deletionErrors > 0
      ? "failed"
      : deletionStalled
        ? "stalled"
        : held > 0
          ? "legal-hold"
          : "ready";

  const supportOpen = Number(support?.open_jobs ?? 0);
  const supportFailed = Number(support?.failed_jobs ?? 0);
  const oldestSupportAt =
    typeof support?.oldest_open_at === "number" ? support.oldest_open_at : null;
  const supportStalled =
    oldestSupportAt !== null && oldestSupportAt < now - QUEUE_STALE_AFTER_MS;
  const supportStatus =
    supportFailed > 0 ? "failed" : supportStalled ? "stalled" : "ready";

  return {
    healthy:
      accountDeletionStatus !== "failed" &&
      accountDeletionStatus !== "stalled" &&
      supportStatus === "ready",
    accountDeletion: {
      status: accountDeletionStatus,
      pending,
      held,
      withErrors: deletionErrors,
      countCapped:
        pending > QUEUE_COUNT_REPORT_LIMIT ||
        held > QUEUE_COUNT_REPORT_LIMIT ||
        deletionErrors > QUEUE_COUNT_REPORT_LIMIT,
      oldestPendingAt:
        oldestPendingAt === null
          ? null
          : new Date(oldestPendingAt).toISOString(),
    },
    supportNotifications: {
      status: supportStatus,
      open: supportOpen,
      failed: supportFailed,
      countCapped:
        supportOpen > QUEUE_COUNT_REPORT_LIMIT ||
        supportFailed > QUEUE_COUNT_REPORT_LIMIT,
      oldestOpenAt:
        oldestSupportAt === null
          ? null
          : new Date(oldestSupportAt).toISOString(),
    },
  };
}

function evaluateRuntimeReadiness(
  configuration: RuntimeConfigurationReadiness,
): {
  webReady: boolean;
  nativeReady: boolean;
  productionReady: boolean;
} {
  const webReady =
    configuration.userKeySecret &&
    configuration.supportRateLimitSecret &&
    configuration.learnerAuthRateLimitSecret &&
    configuration.learnerAuthentication &&
    configuration.learnerAuthOrigin &&
    configuration.learnerParettoIdAccountCreation &&
    configuration.learnerParettoIdSignIn &&
    configuration.learnerRecoveryCodes &&
    configuration.adminAllowlist &&
    configuration.adminAuthentication &&
    configuration.turnstileSiteKey &&
    configuration.turnstileSecret;
  const nativeReady =
    configuration.nativeApiEnabled &&
    configuration.appleClientId &&
    configuration.appleServerCredentials &&
    configuration.appleTokenEncryptionSecret &&
    configuration.nativeSessionSecret;
  return {
    webReady,
    nativeReady,
    productionReady:
      configuration.launchMode === "public" &&
      configuration.workersPlan === "paid" &&
      webReady &&
      (!configuration.nativeApiEnabled || nativeReady),
  };
}

function configurationCheckStatuses(
  configuration: RuntimeConfigurationReadiness,
) {
  const nativeStatus = (ready: boolean) =>
    ready
      ? "ready"
      : configuration.nativeApiEnabled
        ? "misconfigured"
        : "native-disabled";
  return {
    workersPlan:
      configuration.workersPlan === "paid"
        ? "paid"
        : configuration.workersPlan === "free"
          ? "free-controlled-beta-only"
          : "misconfigured",
    userKeySecret: configuration.userKeySecret ? "ready" : "misconfigured",
    supportRateLimitSecret: configuration.supportRateLimitSecret
      ? "ready"
      : "misconfigured",
    learnerAuthRateLimitSecret: configuration.learnerAuthRateLimitSecret
      ? "ready"
      : "misconfigured",
    learnerAuthentication: configuration.learnerAuthentication
      ? "ready"
      : "misconfigured",
    learnerAuthOrigin: configuration.learnerAuthOrigin
      ? "ready"
      : "misconfigured",
    learnerParettoIdAccountCreation:
      configuration.learnerParettoIdAccountCreation ? "ready" : "misconfigured",
    learnerParettoIdSignIn: configuration.learnerParettoIdSignIn
      ? "ready"
      : "misconfigured",
    learnerRecoveryCodes: configuration.learnerRecoveryCodes
      ? "ready"
      : "misconfigured",
    learnerEmailAccountCreation: configuration.learnerEmailAccountCreation
      ? "ready"
      : "disabled",
    learnerEmailVerification: configuration.learnerEmailVerification
      ? "ready"
      : "not-configured",
    learnerPasswordReset: configuration.learnerPasswordReset
      ? "ready"
      : "not-configured",
    learnerGoogleAuth: configuration.learnerGoogleAuth
      ? "ready"
      : "optional-not-configured",
    learnerAppleAuth: configuration.learnerAppleAuth
      ? "ready"
      : "optional-not-configured",
    supportNotifications: configuration.supportNotifications
      ? "ready"
      : "not-configured",
    adminAllowlist: configuration.adminAllowlist ? "ready" : "misconfigured",
    adminAuthentication: configuration.adminAuthentication
      ? "ready"
      : "misconfigured",
    turnstileSiteKey: configuration.turnstileSiteKey
      ? "ready"
      : "misconfigured",
    turnstileSecret: configuration.turnstileSecret ? "ready" : "misconfigured",
    nativeApi: configuration.nativeApiEnabled ? "enabled" : "disabled",
    appleClientId: nativeStatus(configuration.appleClientId),
    appleServerCredentials: nativeStatus(configuration.appleServerCredentials),
    appleTokenEncryptionSecret: nativeStatus(
      configuration.appleTokenEncryptionSecret,
    ),
    nativeSessionSecret: nativeStatus(configuration.nativeSessionSecret),
  };
}

export async function verifyRequiredSchema(
  database: D1Database,
): Promise<void> {
  const tableEntries = Object.entries(REQUIRED_SCHEMA);
  const columnResults = await Promise.all(
    tableEntries.map(([tableName]) =>
      database.prepare(`PRAGMA table_info("${tableName}")`).all<SchemaColumn>(),
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
