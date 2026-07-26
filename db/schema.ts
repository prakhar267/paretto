import { sql } from "drizzle-orm";
import { DEFAULT_COURSE_ID } from "../app/course-catalog";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const learningState = sqliteTable("learning_state", {
  userKey: text("user_key").primaryKey(),
  revision: integer("revision").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Server-owned reset epoch for a learner's canonical progress. Rows are
 * deliberately independent from `learning_state`: deleting the state must
 * leave a durable tombstone so an offline tab or device carrying an older
 * snapshot can never recreate it.
 */
export const learnerProgressGenerations = sqliteTable(
  "learner_progress_generations",
  {
    userKey: text("user_key").primaryKey(),
    generation: integer("generation").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "learner_progress_generations_generation_check",
      sql`${table.generation} >= 1`,
    ),
  ],
);

/**
 * Learner account tables are deliberately separate from the legacy anonymous
 * browser identity and the native Apple-only tables. Better Auth owns these
 * records; Paretto only stores the stable account id alongside learning data.
 */
export const learnerUser = sqliteTable(
  "learner_user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("learner_user_email_unique").on(table.email),
  ],
);

export const learnerSession = sqliteTable(
  "learner_session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => learnerUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("learner_session_token_unique").on(table.token),
    index("learner_session_user_idx").on(table.userId),
    index("learner_session_expiry_idx").on(table.expiresAt),
  ],
);

export const learnerAccount = sqliteTable(
  "learner_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => learnerUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("learner_account_user_idx").on(table.userId),
    uniqueIndex("learner_account_provider_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const learnerVerification = sqliteTable(
  "learner_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("learner_verification_identifier_idx").on(table.identifier),
    index("learner_verification_expiry_idx").on(table.expiresAt),
  ],
);

export const learnerAuthRateLimits = sqliteTable(
  "learner_auth_rate_limits",
  {
    bucketHash: text("bucket_hash").primaryKey(),
    requestCount: integer("request_count").notNull(),
    lastRequestAt: integer("last_request_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("learner_auth_rate_limits_updated_idx").on(table.updatedAt),
    check(
      "learner_auth_rate_limits_request_count_check",
      sql`${table.requestCount} >= 1`,
    ),
  ],
);

export const learnerIdentityLink = sqliteTable(
  "learner_identity_links",
  {
    anonymousUserKey: text("anonymous_user_key").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => learnerUser.id, { onDelete: "cascade" }),
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [
    index("learner_identity_links_account_idx").on(table.accountId),
  ],
);

export const adminLoginAttempts = sqliteTable(
  "admin_login_attempts",
  {
    ipHash: text("ip_hash").primaryKey(),
    windowStartedAt: integer("window_started_at").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    blockedUntil: integer("blocked_until"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("admin_login_attempts_updated_idx").on(table.updatedAt),
    check(
      "admin_login_attempts_failed_check",
      sql`${table.failedAttempts} >= 0`,
    ),
  ],
);

export const cmsContent = sqliteTable(
  "cms_content",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull().default(DEFAULT_COURSE_ID),
    kind: text("kind", { enum: ["vocabulary", "lesson"] }).notNull(),
    slug: text("slug").notNull(),
    stableKey: text("stable_key").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    publishedAt: integer("published_at"),
    reviewStatus: text("review_status", {
      enum: ["draft", "pending", "approved", "changes_requested"],
    })
      .notNull()
      .default("draft"),
    reviewedByEmail: text("reviewed_by_email"),
    reviewedAt: integer("reviewed_at"),
    approvedRevision: integer("approved_revision"),
    createdByEmail: text("created_by_email").notNull(),
    updatedByEmail: text("updated_by_email").notNull(),
  },
  (table) => [
    uniqueIndex("cms_content_kind_slug_unique").on(
      table.courseId,
      table.kind,
      table.slug,
    ),
    uniqueIndex("cms_content_kind_stable_key_unique").on(
      table.courseId,
      table.kind,
      table.stableKey,
    ),
    index("cms_content_status_updated_idx").on(
      table.courseId,
      table.status,
      table.updatedAt,
    ),
    check(
      "cms_content_kind_check",
      sql`${table.kind} in ('vocabulary', 'lesson')`,
    ),
    check(
      "cms_content_status_check",
      sql`${table.status} in ('draft', 'published')`,
    ),
    check(
      "cms_content_review_status_check",
      sql`${table.reviewStatus} in ('draft', 'pending', 'approved', 'changes_requested')`,
    ),
  ],
);

export const cmsVocabularyAliases = sqliteTable(
  "cms_vocabulary_aliases",
  {
    courseId: text("course_id").notNull().default(DEFAULT_COURSE_ID),
    alias: text("alias").notNull(),
    contentId: text("content_id").notNull(),
    stableKey: text("stable_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.alias] }),
    index("cms_vocabulary_aliases_content_idx").on(
      table.courseId,
      table.contentId,
    ),
    index("cms_vocabulary_aliases_stable_idx").on(
      table.courseId,
      table.stableKey,
    ),
  ],
);

export const cmsSlugTombstones = sqliteTable(
  "cms_slug_tombstones",
  {
    courseId: text("course_id").notNull().default(DEFAULT_COURSE_ID),
    kind: text("kind", { enum: ["vocabulary", "lesson"] }).notNull(),
    slug: text("slug").notNull(),
    stableKey: text("stable_key").notNull(),
    contentId: text("content_id").notNull(),
    retiredAt: integer("retired_at").notNull(),
    retiredByEmail: text("retired_by_email").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.kind, table.slug] }),
    index("cms_slug_tombstones_content_idx").on(
      table.courseId,
      table.contentId,
    ),
    check(
      "cms_slug_tombstones_kind_check",
      sql`${table.kind} in ('vocabulary', 'lesson')`,
    ),
  ],
);

export const cmsContentRevisions = sqliteTable(
  "cms_content_revisions",
  {
    courseId: text("course_id").notNull().default(DEFAULT_COURSE_ID),
    contentId: text("content_id").notNull(),
    revision: integer("revision").notNull(),
    kind: text("kind", { enum: ["vocabulary", "lesson"] }).notNull(),
    slug: text("slug").notNull(),
    stableKey: text("stable_key").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: ["draft", "published"] }).notNull(),
    publishedAt: integer("published_at"),
    actorEmail: text("actor_email").notNull(),
    action: text("action", {
      enum: ["CREATE", "UPDATE", "PUBLISH", "UNPUBLISH", "RESTORE", "MIGRATION"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.courseId, table.contentId, table.revision],
    }),
    index("cms_content_revisions_created_idx").on(
      table.courseId,
      table.contentId,
      table.createdAt,
    ),
    check(
      "cms_content_revisions_kind_check",
      sql`${table.kind} in ('vocabulary', 'lesson')`,
    ),
    check(
      "cms_content_revisions_status_check",
      sql`${table.status} in ('draft', 'published')`,
    ),
    check(
      "cms_content_revisions_action_check",
      sql`${table.action} in ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE', 'MIGRATION')`,
    ),
  ],
);

export const supportRequests = sqliteTable(
  "support_requests",
  {
    id: text("id").primaryKey(),
    userKey: text("user_key").notNull(),
    replyEmail: text("reply_email"),
    category: text("category", {
      enum: ["billing", "technical", "content", "feedback", "privacy", "other"],
    }).notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["open", "in_progress", "resolved", "closed"],
    })
      .notNull()
      .default("open"),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("support_requests_user_created_idx").on(
      table.userKey,
      table.createdAt,
    ),
    index("support_requests_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "support_requests_category_check",
      sql`${table.category} in ('billing', 'technical', 'content', 'feedback', 'privacy', 'other')`,
    ),
    check(
      "support_requests_status_check",
      sql`${table.status} in ('open', 'in_progress', 'resolved', 'closed')`,
    ),
  ],
);

export const supportRateLimits = sqliteTable(
  "support_rate_limits",
  {
    bucketHash: text("bucket_hash").primaryKey(),
    windowStartedAt: integer("window_started_at").notNull(),
    requestCount: integer("request_count").notNull(),
    lastReservationId: text("last_reservation_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("support_rate_limits_updated_idx").on(table.updatedAt),
    check(
      "support_rate_limits_request_count_check",
      sql`${table.requestCount} >= 1 AND ${table.requestCount} <= 20`,
    ),
  ],
);

/**
 * Durable, body-free support email outbox. Mutations enqueue these rows in
 * the same D1 batch as the support request change; scheduled retention then
 * claims and delivers a bounded page. Requester destinations are written only
 * after an exact match to a verified signed-in learner account.
 */
export const supportNotificationJobs = sqliteTable(
  "support_notification_jobs",
  {
    id: text("id").primaryKey(),
    supportRequestId: text("support_request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: [
        "operator_created",
        "requester_created",
        "requester_status",
      ],
    }).notNull(),
    supportRevision: integer("support_revision").notNull(),
    supportStatus: text("support_status", {
      enum: ["open", "in_progress", "resolved", "closed"],
    }).notNull(),
    recipientEmail: text("recipient_email"),
    status: text("status", {
      enum: ["pending", "processing", "failed", "completed"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at").notNull(),
    leaseExpiresAt: integer("lease_expires_at"),
    lastError: text("last_error"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("support_notification_jobs_event_unique").on(
      table.supportRequestId,
      table.eventType,
      table.supportRevision,
    ),
    index("support_notification_jobs_delivery_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    check(
      "support_notification_jobs_event_type_check",
      sql`${table.eventType} in ('operator_created', 'requester_created', 'requester_status')`,
    ),
    check(
      "support_notification_jobs_support_status_check",
      sql`${table.supportStatus} in ('open', 'in_progress', 'resolved', 'closed')`,
    ),
    check(
      "support_notification_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'failed', 'completed')`,
    ),
    check(
      "support_notification_jobs_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "support_notification_jobs_recipient_check",
      sql`(${table.eventType} = 'operator_created' AND ${table.recipientEmail} IS NULL) OR (${table.eventType} IN ('requester_created', 'requester_status') AND ${table.recipientEmail} IS NOT NULL)`,
    ),
  ],
);

export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type", {
      enum: ["content", "support_request", "operation", "legal_hold"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    fromRevision: integer("from_revision"),
    toRevision: integer("to_revision"),
    details: text("details").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("admin_audit_entity_created_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("admin_audit_created_idx").on(table.createdAt, table.id),
    check(
      "admin_audit_entity_type_check",
      sql`${table.entityType} in ('content', 'support_request', 'operation', 'legal_hold')`,
    ),
  ],
);

export const productEvents = sqliteTable(
  "product_events",
  {
    id: text("id").primaryKey(),
    userKey: text("user_key").notNull(),
    sessionId: text("session_id").notNull(),
    eventName: text("event_name", {
      enum: [
        "app_opened",
        "onboarding_completed",
        "navigation_changed",
        "lesson_started",
        "lesson_completed",
        "challenge_started",
        "challenge_completed",
        "audio_played",
        "audio_fallback",
        "analytics_consent_updated",
      ],
    }).notNull(),
    properties: text("properties").notNull().default("{}"),
    occurredAt: integer("occurred_at").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (table) => [
    index("product_events_name_occurred_idx").on(
      table.eventName,
      table.occurredAt,
    ),
    index("product_events_user_occurred_idx").on(
      table.userKey,
      table.occurredAt,
    ),
    index("product_events_received_idx").on(table.receivedAt),
    check(
      "product_events_name_check",
      sql`${table.eventName} in ('app_opened', 'onboarding_completed', 'navigation_changed', 'lesson_started', 'lesson_completed', 'challenge_started', 'challenge_completed', 'audio_played', 'audio_fallback', 'analytics_consent_updated')`,
    ),
  ],
);

export const nativeAccounts = sqliteTable(
  "native_accounts",
  {
    id: text("id").primaryKey(),
    appleSubjectHash: text("apple_subject_hash").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("native_accounts_apple_subject_unique").on(
      table.appleSubjectHash,
    ),
  ],
);

/**
 * A native Apple account joins the shared learner account only through the
 * exact verified Apple provider subject. The native exchange can create the
 * corresponding Better Auth provider record when Apple supplies a verified,
 * unused email, but it never links to an existing account by email address.
 *
 * Keeping the bridge in its own table makes the migration additive: existing
 * native-only accounts and progress remain valid until a verified provider
 * match exists, and a learner account can never be claimed by two native
 * identities.
 */
export const nativeLearnerLinks = sqliteTable(
  "native_learner_links",
  {
    nativeAccountId: text("native_account_id")
      .primaryKey()
      .references(() => nativeAccounts.id, { onDelete: "cascade" }),
    learnerUserId: text("learner_user_id")
      .notNull()
      .references(() => learnerUser.id, { onDelete: "cascade" }),
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [
    uniqueIndex("native_learner_links_user_unique").on(table.learnerUserId),
  ],
);

export const nativeSessions = sqliteTable(
  "native_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    id: text("id").notNull(),
    accountId: text("account_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("native_sessions_id_unique").on(table.id),
    index("native_sessions_account_idx").on(table.accountId),
    index("native_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const nativeLearningState = sqliteTable("native_learning_state", {
  accountId: text("account_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  resetGeneration: integer("reset_generation").notNull().default(0),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const nativeAppleCredentials = sqliteTable("native_apple_credentials", {
  accountId: text("account_id").primaryKey(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const nativeIdentityTokenUses = sqliteTable(
  "native_identity_token_uses",
  {
    tokenHash: text("token_hash").primaryKey(),
    exchangeId: text("exchange_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at").notNull(),
  },
  (table) => [
    index("native_identity_token_uses_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Account deletion is a two-phase operation because Better Auth removes its
 * user before product-owned rows can be cleaned up. This durable queue keeps
 * the opaque deletion target available for immediate cleanup and scheduled
 * retry without retaining an email address.
 */
export const learnerDeletionJobs = sqliteTable(
  "learner_deletion_jobs",
  {
    userId: text("user_id").primaryKey(),
    userKey: text("user_key").notNull(),
    nativeAccountId: text("native_account_id"),
    status: text("status", { enum: ["pending", "held", "completed"] })
      .notNull()
      .default("pending"),
    requestedAt: integer("requested_at").notNull(),
    completedAt: integer("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("learner_deletion_jobs_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "learner_deletion_jobs_status_check",
      sql`${table.status} in ('pending', 'held', 'completed')`,
    ),
  ],
);

export const retentionLegalHolds = sqliteTable(
  "retention_legal_holds",
  {
    id: text("id").primaryKey(),
    dataClass: text("data_class", {
      enum: ["product_events", "support_requests", "admin_audit_log"],
    }).notNull(),
    recordKey: text("record_key"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["active", "released"] })
      .notNull()
      .default("active"),
    createdByEmail: text("created_by_email").notNull(),
    createdAt: integer("created_at").notNull(),
    releasedByEmail: text("released_by_email"),
    releasedAt: integer("released_at"),
  },
  (table) => [
    index("retention_legal_holds_status_class_idx").on(
      table.status,
      table.dataClass,
    ),
    check(
      "retention_legal_holds_data_class_check",
      sql`${table.dataClass} in ('product_events', 'support_requests', 'admin_audit_log')`,
    ),
    check(
      "retention_legal_holds_status_check",
      sql`${table.status} in ('active', 'released')`,
    ),
  ],
);

export const retentionScheduleState = sqliteTable(
  "retention_schedule_state",
  {
    jobName: text("job_name").primaryKey(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed"],
    })
      .notNull()
      .default("pending"),
    monitoringStartedAt: integer("monitoring_started_at").notNull(),
    runId: text("run_id"),
    scheduledAt: integer("scheduled_at"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    lastSucceededAt: integer("last_succeeded_at"),
    lastFailedAt: integer("last_failed_at"),
    lastError: text("last_error"),
    lastResult: text("last_result"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "retention_schedule_state_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
  ],
);
