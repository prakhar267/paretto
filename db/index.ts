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
  CREATE TABLE IF NOT EXISTS cms_content (
    id TEXT PRIMARY KEY NOT NULL,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS cms_content_kind_slug_unique ON cms_content (kind, slug)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cms_content_kind_stable_key_unique ON cms_content (kind, stable_key)`,
  `CREATE INDEX IF NOT EXISTS cms_content_status_updated_idx ON cms_content (status, updated_at)`,
  `
  CREATE TABLE IF NOT EXISTS cms_vocabulary_aliases (
    alias TEXT PRIMARY KEY NOT NULL,
    content_id TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_vocabulary_aliases_content_idx ON cms_vocabulary_aliases (content_id)`,
  `CREATE INDEX IF NOT EXISTS cms_vocabulary_aliases_stable_idx ON cms_vocabulary_aliases (stable_key)`,
  `
  CREATE TABLE IF NOT EXISTS cms_slug_tombstones (
    kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'lesson')),
    slug TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    content_id TEXT NOT NULL,
    retired_at INTEGER NOT NULL,
    retired_by_email TEXT NOT NULL,
    PRIMARY KEY (kind, slug)
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_slug_tombstones_content_idx ON cms_slug_tombstones (content_id)`,
  `
  CREATE TABLE IF NOT EXISTS cms_content_revisions (
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
    PRIMARY KEY (content_id, revision)
  )
  `,
  `CREATE INDEX IF NOT EXISTS cms_content_revisions_created_idx ON cms_content_revisions (content_id, created_at)`,
  `
  INSERT OR IGNORE INTO cms_content_revisions (
    content_id, revision, kind, slug, stable_key, title, content, status,
    published_at, actor_email, action, created_at
  )
  SELECT id, revision, kind, slug, stable_key, title, content, status,
         published_at, updated_by_email, 'MIGRATION', updated_at
  FROM cms_content
  `,
  `
  INSERT OR IGNORE INTO cms_vocabulary_aliases (
    alias, content_id, stable_key, created_at
  )
  SELECT slug, id, stable_key, created_at
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

async function initializeLocalSchema(database: D1Database): Promise<void> {
  for (const statement of localSchemaSql) {
    await database.prepare(statement).run();
  }
}
