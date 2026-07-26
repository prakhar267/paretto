import { DEFAULT_COURSE_ID } from "../app/course-catalog";

const localSchemaSql = [
  `
  CREATE TABLE IF NOT EXISTS learning_state (
    user_key TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS learner_progress_generations (
    user_key TEXT PRIMARY KEY NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS learner_user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS learner_user_email_unique ON learner_user (email)`,
  `
  CREATE TABLE IF NOT EXISTS learner_session (
    id TEXT PRIMARY KEY NOT NULL,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES learner_user(id) ON DELETE CASCADE
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS learner_session_token_unique ON learner_session (token)`,
  `CREATE INDEX IF NOT EXISTS learner_session_user_idx ON learner_session (user_id)`,
  `CREATE INDEX IF NOT EXISTS learner_session_expiry_idx ON learner_session (expires_at)`,
  `
  CREATE TABLE IF NOT EXISTS learner_account (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES learner_user(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS learner_account_user_idx ON learner_account (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS learner_account_provider_unique ON learner_account (provider_id, account_id)`,
  `
  CREATE TABLE IF NOT EXISTS learner_verification (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS learner_verification_identifier_idx ON learner_verification (identifier)`,
  `CREATE INDEX IF NOT EXISTS learner_verification_expiry_idx ON learner_verification (expires_at)`,
  `
  CREATE TABLE IF NOT EXISTS learner_auth_rate_limits (
    bucket_hash TEXT PRIMARY KEY NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 1),
    last_request_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS learner_auth_rate_limits_updated_idx ON learner_auth_rate_limits (updated_at)`,
  `DROP TABLE IF EXISTS learner_rate_limit`,
  `
  CREATE TABLE IF NOT EXISTS learner_identity_links (
    anonymous_user_key TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES learner_user(id) ON DELETE CASCADE,
    linked_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS learner_identity_links_account_idx ON learner_identity_links (account_id)`,
  `
  CREATE TABLE IF NOT EXISTS admin_login_attempts (
    ip_hash TEXT PRIMARY KEY NOT NULL,
    window_started_at INTEGER NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    blocked_until INTEGER,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS admin_login_attempts_updated_idx ON admin_login_attempts (updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS cms_content (
    id TEXT PRIMARY KEY NOT NULL,
    course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
    kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
    slug TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'pending', 'approved', 'changes_requested')),
    reviewed_by_email TEXT,
    reviewed_at INTEGER,
    approved_revision INTEGER,
    created_by_email TEXT NOT NULL,
    updated_by_email TEXT NOT NULL
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS cms_content_kind_slug_unique ON cms_content (course_id, kind, slug)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cms_content_kind_stable_key_unique ON cms_content (course_id, kind, stable_key)`,
  `CREATE INDEX IF NOT EXISTS cms_content_status_updated_idx ON cms_content (course_id, status, updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS cms_vocabulary_aliases (
    course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
    alias TEXT NOT NULL,
    content_id TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, alias)
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_vocabulary_aliases_content_idx ON cms_vocabulary_aliases (course_id, content_id)`,
  `CREATE INDEX IF NOT EXISTS cms_vocabulary_aliases_stable_idx ON cms_vocabulary_aliases (course_id, stable_key)`,
  `
  CREATE TABLE IF NOT EXISTS cms_slug_tombstones (
    course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
    kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
    slug TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    content_id TEXT NOT NULL,
    retired_at INTEGER NOT NULL,
    retired_by_email TEXT NOT NULL,
    PRIMARY KEY (course_id, kind, slug)
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_slug_tombstones_content_idx ON cms_slug_tombstones (course_id, content_id)`,
  `
  CREATE TABLE IF NOT EXISTS cms_content_revisions (
    course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
    content_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
    slug TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    published_at INTEGER,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE', 'MIGRATION')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, content_id, revision)
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_content_revisions_created_idx ON cms_content_revisions (course_id, content_id, created_at)`,
  `
  INSERT OR IGNORE INTO cms_content_revisions (
    course_id, content_id, revision, kind, slug, stable_key, title, content, status,
    published_at, actor_email, action, created_at
  )
  SELECT course_id, id, revision, kind, slug, stable_key, title, content, status,
         published_at, updated_by_email, 'MIGRATION', updated_at
  FROM cms_content
  `,
  `
  INSERT OR IGNORE INTO cms_vocabulary_aliases (
    course_id, alias, content_id, stable_key, created_at
  )
  SELECT course_id, slug, id, stable_key, created_at
  FROM cms_content
  WHERE kind = 'vocabulary'
  `,
  `
  CREATE TABLE IF NOT EXISTS support_requests (
    id TEXT PRIMARY KEY NOT NULL,
    user_key TEXT NOT NULL,
    reply_email TEXT,
    category TEXT NOT NULL CHECK (category IN ('billing', 'technical', 'content', 'feedback', 'privacy', 'other')),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS support_requests_user_created_idx ON support_requests (user_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS support_requests_status_updated_idx ON support_requests (status, updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS support_rate_limits (
    bucket_hash TEXT PRIMARY KEY NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 1 AND request_count <= 20),
    last_reservation_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS support_rate_limits_updated_idx ON support_rate_limits (updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS support_notification_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    support_request_id TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('operator_created', 'requester_created', 'requester_status')),
    support_revision INTEGER NOT NULL,
    support_status TEXT NOT NULL CHECK (support_status IN ('open', 'in_progress', 'resolved', 'closed')),
    recipient_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at INTEGER NOT NULL,
    lease_expires_at INTEGER,
    last_error TEXT,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (
      (event_type = 'operator_created' AND recipient_email IS NULL) OR
      (event_type IN ('requester_created', 'requester_status') AND recipient_email IS NOT NULL)
    )
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS support_notification_jobs_event_unique ON support_notification_jobs (support_request_id, event_type, support_revision)`,
  `CREATE INDEX IF NOT EXISTS support_notification_jobs_delivery_idx ON support_notification_jobs (status, available_at, created_at)`,
  `
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('content', 'support_request', 'operation', 'legal_hold')),
    entity_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    from_revision INTEGER,
    to_revision INTEGER,
    details TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS admin_audit_entity_created_idx ON admin_audit_log (entity_type, entity_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log (created_at, id)`,
  `
  CREATE TABLE IF NOT EXISTS product_events (
    id TEXT PRIMARY KEY NOT NULL,
    user_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_name TEXT NOT NULL CHECK (event_name IN ('app_opened', 'onboarding_completed', 'navigation_changed', 'lesson_started', 'lesson_completed', 'challenge_started', 'challenge_completed', 'audio_played', 'audio_fallback', 'analytics_consent_updated')),
    properties TEXT NOT NULL DEFAULT '{}',
    occurred_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS product_events_name_occurred_idx ON product_events (event_name, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS product_events_user_occurred_idx ON product_events (user_key, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS product_events_received_idx ON product_events (received_at)`,
  `
  CREATE TABLE IF NOT EXISTS native_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    apple_subject_hash TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS native_accounts_apple_subject_unique ON native_accounts (apple_subject_hash)`,
  `
  CREATE TABLE IF NOT EXISTS native_learner_links (
    native_account_id TEXT PRIMARY KEY NOT NULL REFERENCES native_accounts(id) ON DELETE CASCADE,
    learner_user_id TEXT NOT NULL REFERENCES learner_user(id) ON DELETE CASCADE,
    linked_at INTEGER NOT NULL
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS native_learner_links_user_unique ON native_learner_links (learner_user_id)`,
  `
  CREATE TABLE IF NOT EXISTS native_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS native_sessions_id_unique ON native_sessions (id)`,
  `CREATE INDEX IF NOT EXISTS native_sessions_account_idx ON native_sessions (account_id)`,
  `CREATE INDEX IF NOT EXISTS native_sessions_expiry_idx ON native_sessions (expires_at)`,
  `
  CREATE TABLE IF NOT EXISTS native_learning_state (
    account_id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    reset_generation INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS native_apple_credentials (
    account_id TEXT PRIMARY KEY NOT NULL,
    refresh_token_ciphertext TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS native_identity_token_uses (
    token_hash TEXT PRIMARY KEY NOT NULL,
    exchange_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS native_identity_token_uses_expiry_idx ON native_identity_token_uses (expires_at)`,
  `
  CREATE TABLE IF NOT EXISTS learner_deletion_jobs (
    user_id TEXT PRIMARY KEY NOT NULL,
    user_key TEXT NOT NULL,
    native_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'completed')),
    requested_at INTEGER NOT NULL,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS learner_deletion_jobs_status_updated_idx ON learner_deletion_jobs (status, updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS retention_legal_holds (
    id TEXT PRIMARY KEY NOT NULL,
    data_class TEXT NOT NULL CHECK (data_class IN ('product_events', 'support_requests', 'admin_audit_log')),
    record_key TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    created_by_email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    released_by_email TEXT,
    released_at INTEGER
  )
  `,
  `CREATE INDEX IF NOT EXISTS retention_legal_holds_status_class_idx ON retention_legal_holds (status, data_class)`,
  `
  CREATE TABLE IF NOT EXISTS retention_schedule_state (
    job_name TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    monitoring_started_at INTEGER NOT NULL,
    run_id TEXT,
    scheduled_at INTEGER,
    started_at INTEGER,
    completed_at INTEGER,
    last_succeeded_at INTEGER,
    last_failed_at INTEGER,
    last_error TEXT,
    last_result TEXT,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  INSERT OR IGNORE INTO retention_schedule_state (
    job_name, status, monitoring_started_at, updated_at
  ) VALUES (
    'scheduled_retention',
    'pending',
    CAST(unixepoch('now') AS INTEGER) * 1000,
    CAST(unixepoch('now') AS INTEGER) * 1000
  )
  `,
];

let localSchemaReady: Promise<void> | null = null;

export async function getD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the d1 field in .openai/hosting.json to DB.",
    );
  }
  return bindings.DB;
}

export async function getDatabase(): Promise<D1Database> {
  const database = await getD1();
  if (process.env.NODE_ENV === "development") {
    localSchemaReady ??= initializeLocalSchema(database)
      .catch((error) => {
        localSchemaReady = null;
        throw error;
      });
    await localSchemaReady;
  }
  return database;
}

export async function initializeLocalSchema(
  database: D1Database,
): Promise<void> {
  await upgradeLegacyLocalSchema(database);
  for (const statement of localSchemaSql) {
    await database.prepare(statement).run();
  }
}

/**
 * Development uses a persistent Miniflare D1 database. `CREATE TABLE IF NOT
 * EXISTS` cannot evolve a database created before course scoping was added, so
 * perform the one data-preserving compatibility upgrade that those databases
 * need before creating the current schema. Production remains migration-only.
 */
async function upgradeLegacyLocalSchema(
  database: D1Database,
): Promise<void> {
  if (
    await tableNeedsColumn(
      database,
      "native_learning_state",
      "reset_generation",
    )
  ) {
    await database
      .prepare(
        `ALTER TABLE native_learning_state
         ADD reset_generation INTEGER NOT NULL DEFAULT 0`,
      )
      .run();
  }

  if (await tableNeedsCourseId(database, "cms_content")) {
    await database.batch([
      database.prepare(
        `ALTER TABLE cms_content
         ADD course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}'`,
      ),
      database.prepare("DROP INDEX IF EXISTS cms_content_kind_slug_unique"),
      database.prepare(
        "DROP INDEX IF EXISTS cms_content_kind_stable_key_unique",
      ),
      database.prepare("DROP INDEX IF EXISTS cms_content_status_updated_idx"),
    ]);
  }

  if (await tableNeedsCourseId(database, "cms_content_revisions")) {
    await database.batch([
      database.prepare("DROP TABLE IF EXISTS __local_cms_content_revisions"),
      database.prepare(`
        CREATE TABLE __local_cms_content_revisions (
          course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
          content_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
          slug TEXT NOT NULL,
          stable_key TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
          published_at INTEGER,
          actor_email TEXT NOT NULL,
          action TEXT NOT NULL CHECK (
            action IN (
              'CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'RESTORE',
              'MIGRATION'
            )
          ),
          created_at INTEGER NOT NULL,
          PRIMARY KEY (course_id, content_id, revision)
        )
      `),
      database.prepare(`
        INSERT INTO __local_cms_content_revisions (
          course_id, content_id, revision, kind, slug, stable_key, title,
          content, status, published_at, actor_email, action, created_at
        )
        SELECT '${DEFAULT_COURSE_ID}', content_id, revision, kind, slug,
               stable_key, title, content, status, published_at, actor_email,
               action, created_at
        FROM cms_content_revisions
      `),
      database.prepare("DROP TABLE cms_content_revisions"),
      database.prepare(
        "ALTER TABLE __local_cms_content_revisions RENAME TO cms_content_revisions",
      ),
    ]);
  }

  if (await tableNeedsCourseId(database, "cms_slug_tombstones")) {
    await database.batch([
      database.prepare("DROP TABLE IF EXISTS __local_cms_slug_tombstones"),
      database.prepare(`
        CREATE TABLE __local_cms_slug_tombstones (
          course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
          kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
          slug TEXT NOT NULL,
          stable_key TEXT NOT NULL,
          content_id TEXT NOT NULL,
          retired_at INTEGER NOT NULL,
          retired_by_email TEXT NOT NULL,
          PRIMARY KEY (course_id, kind, slug)
        )
      `),
      database.prepare(`
        INSERT INTO __local_cms_slug_tombstones (
          course_id, kind, slug, stable_key, content_id, retired_at,
          retired_by_email
        )
        SELECT '${DEFAULT_COURSE_ID}', kind, slug, stable_key, content_id,
               retired_at, retired_by_email
        FROM cms_slug_tombstones
      `),
      database.prepare("DROP TABLE cms_slug_tombstones"),
      database.prepare(
        "ALTER TABLE __local_cms_slug_tombstones RENAME TO cms_slug_tombstones",
      ),
    ]);
  }

  if (await tableNeedsCourseId(database, "cms_vocabulary_aliases")) {
    await database.batch([
      database.prepare("DROP TABLE IF EXISTS __local_cms_vocabulary_aliases"),
      database.prepare(`
        CREATE TABLE __local_cms_vocabulary_aliases (
          course_id TEXT NOT NULL DEFAULT '${DEFAULT_COURSE_ID}',
          alias TEXT NOT NULL,
          content_id TEXT NOT NULL,
          stable_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (course_id, alias)
        )
      `),
      database.prepare(`
        INSERT INTO __local_cms_vocabulary_aliases (
          course_id, alias, content_id, stable_key, created_at
        )
        SELECT '${DEFAULT_COURSE_ID}', alias, content_id, stable_key, created_at
        FROM cms_vocabulary_aliases
      `),
      database.prepare("DROP TABLE cms_vocabulary_aliases"),
      database.prepare(
        "ALTER TABLE __local_cms_vocabulary_aliases RENAME TO cms_vocabulary_aliases",
      ),
    ]);
  }
}

async function tableNeedsCourseId(
  database: D1Database,
  tableName: string,
): Promise<boolean> {
  return tableNeedsColumn(database, tableName, "course_id");
}

async function tableNeedsColumn(
  database: D1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const columns = await database
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all<{ name: string }>();
  return (
    columns.results.length > 0 &&
    !columns.results.some((column) => column.name === columnName)
  );
}
