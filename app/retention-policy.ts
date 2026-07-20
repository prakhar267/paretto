export const PRODUCT_EVENT_RETENTION_DAYS = 400;
export const OPERATIONAL_RECORD_RETENTION_DAYS = 730;
export const RETENTION_FALLBACK_INTERVAL_MS = 60 * 60 * 1000;
export const RETENTION_BATCH_LIMIT = 500;
export const MAX_RETENTION_BATCH_LIMIT = 1_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionMaintenanceResult = {
  productEvents: number;
  supportRequests: number;
  auditEvents: number;
  nativeSessions: number;
  nativeIdentityTokens: number;
};

export function retentionCutoffs(now = Date.now()) {
  return {
    productEvents: now - PRODUCT_EVENT_RETENTION_DAYS * DAY_MS,
    operationalRecords: now - OPERATIONAL_RECORD_RETENTION_DAYS * DAY_MS,
  };
}

/**
 * Deletes one bounded page from every expired retention class as a D1 batch.
 * Active class-wide or record/user/entity legal holds are excluded. Repeated
 * scheduled runs drain a backlog without creating an unbounded transaction.
 */
export async function runRetentionMaintenance(
  database: D1Database,
  now = Date.now(),
  batchLimit = RETENTION_BATCH_LIMIT,
): Promise<RetentionMaintenanceResult> {
  if (
    !Number.isInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > MAX_RETENTION_BATCH_LIMIT
  ) {
    throw new Error("Retention batch limit is outside the supported range.");
  }
  const cutoffs = retentionCutoffs(now);
  const [events, support, audit, sessions, identityTokens] =
    await database.batch([
    database
      .prepare(
        `DELETE FROM product_events WHERE id IN (
           SELECT events.id FROM product_events AS events
           WHERE events.received_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'product_events'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = events.id OR
                   holds.record_key = events.user_key
                 )
             )
           ORDER BY events.received_at ASC, events.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.productEvents, batchLimit),
    database
      .prepare(
        `DELETE FROM support_requests WHERE id IN (
           SELECT support.id FROM support_requests AS support
           WHERE support.status IN ('resolved', 'closed')
             AND support.updated_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'support_requests'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = support.id OR
                   holds.record_key = support.user_key
                 )
             )
           ORDER BY support.updated_at ASC, support.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.operationalRecords, batchLimit),
    database
      .prepare(
        `DELETE FROM admin_audit_log WHERE id IN (
           SELECT audit.id FROM admin_audit_log AS audit
           WHERE audit.created_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'admin_audit_log'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = CAST(audit.id AS TEXT) OR
                   holds.record_key = audit.entity_id
                 )
             )
           ORDER BY audit.created_at ASC, audit.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.operationalRecords, batchLimit),
    database
      .prepare(
        `DELETE FROM native_sessions WHERE token_hash IN (
           SELECT token_hash FROM native_sessions
           WHERE expires_at < ? OR revoked_at IS NOT NULL
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
    database
      .prepare(
        `DELETE FROM native_identity_token_uses WHERE token_hash IN (
           SELECT token_hash FROM native_identity_token_uses
           WHERE expires_at < ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
  ]);

  return {
    productEvents: Number(events.meta.changes ?? 0),
    supportRequests: Number(support.meta.changes ?? 0),
    auditEvents: Number(audit.meta.changes ?? 0),
    nativeSessions: Number(sessions.meta.changes ?? 0),
    nativeIdentityTokens: Number(identityTokens.meta.changes ?? 0),
  };
}
