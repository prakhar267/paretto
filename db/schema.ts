import { sql } from "drizzle-orm";
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
    uniqueIndex("cms_content_kind_slug_unique").on(table.kind, table.slug),
    uniqueIndex("cms_content_kind_stable_key_unique").on(
      table.kind,
      table.stableKey,
    ),
    index("cms_content_status_updated_idx").on(table.status, table.updatedAt),
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
    alias: text("alias").primaryKey(),
    contentId: text("content_id").notNull(),
    stableKey: text("stable_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("cms_vocabulary_aliases_content_idx").on(table.contentId),
    index("cms_vocabulary_aliases_stable_idx").on(table.stableKey),
  ],
);

export const cmsSlugTombstones = sqliteTable(
  "cms_slug_tombstones",
  {
    kind: text("kind", { enum: ["vocabulary", "lesson"] }).notNull(),
    slug: text("slug").notNull(),
    stableKey: text("stable_key").notNull(),
    contentId: text("content_id").notNull(),
    retiredAt: integer("retired_at").notNull(),
    retiredByEmail: text("retired_by_email").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.slug] }),
    index("cms_slug_tombstones_content_idx").on(table.contentId),
    check(
      "cms_slug_tombstones_kind_check",
      sql`${table.kind} in ('vocabulary', 'lesson')`,
    ),
  ],
);

export const cmsContentRevisions = sqliteTable(
  "cms_content_revisions",
  {
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
    primaryKey({ columns: [table.contentId, table.revision] }),
    index("cms_content_revisions_created_idx").on(
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
