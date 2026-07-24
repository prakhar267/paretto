import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as AUDIT_GET } from "../app/api/admin/audit/route";
import {
  GET as CONTENT_LIST,
  POST as CONTENT_CREATE,
} from "../app/api/admin/content/route";
import {
  DELETE as CONTENT_DELETE,
  GET as CONTENT_GET,
  PUT as CONTENT_UPDATE,
} from "../app/api/admin/content/[id]/route";
import { POST as CONTENT_PUBLICATION } from "../app/api/admin/content/[id]/publication/route";
import { POST as CONTENT_REVIEW } from "../app/api/admin/content/[id]/review/route";
import {
  GET as CONTENT_REVISIONS,
  POST as CONTENT_RESTORE,
} from "../app/api/admin/content/[id]/revisions/route";
import { GET as ADMIN_SUPPORT_LIST } from "../app/api/admin/support/route";
import { PUT as ADMIN_SUPPORT_UPDATE } from "../app/api/admin/support/[id]/route";
import { GET as CURRICULUM_GET } from "../app/api/curriculum/route";
import { POST as SUPPORT_CREATE } from "../app/api/support/route";
import type {
  AuditRow,
  ContentRevisionRow,
  ContentRow,
  SupportRow,
} from "../app/api/_lib/cms-database";
import {
  createAdminTestAuth,
  learnerCookieHeaders,
  successfulTurnstileResponse,
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
} from "./auth-fixtures";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type StoredSupportRow = SupportRow & { user_key: string };

class CmsMemoryD1 {
  content = new Map<string, ContentRow>();
  support = new Map<string, StoredSupportRow>();
  audits: AuditRow[] = [];
  revisions: ContentRevisionRow[] = [];
  aliases = new Map<
    string,
    { contentId: string; stableKey: string; createdAt: number }
  >();
  tombstones = new Map<
    string,
    { contentId: string; stableKey: string; retiredAt: number; retiredBy: string }
  >();
  beforeContentSlugUpdate: (() => void) | null = null;
  beforeContentStatusUpdate: (() => void) | null = null;
  beforeSupportStatusUpdate: (() => void) | null = null;
  lastChanges = 0;

  prepare(sql: string) {
    return new CmsMemoryStatement(this, sql);
  }

  async batch(statements: CmsMemoryStatement[]) {
    const results = [];
    this.lastChanges = 0;
    for (const statement of statements) {
      const result = await statement.run();
      this.lastChanges = result.meta.changes;
      results.push(result);
    }
    return results;
  }
}

class CmsMemoryStatement {
  private values: unknown[] = [];
  private readonly normalizedSql: string;

  constructor(
    private readonly database: CmsMemoryD1,
    sql: string,
  ) {
    this.normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.normalizedSql.includes("FROM CMS_SLUG_TOMBSTONES")) {
      const [kind, slug, excludedContentId] = this.values.map(String);
      const tombstone = this.database.tombstones.get(`${kind}:${slug}`);
      if (!tombstone || tombstone.contentId === excludedContentId) return null;
      return { content_id: tombstone.contentId } as T;
    }
    if (this.normalizedSql.includes("FROM CMS_CONTENT_REVISIONS")) {
      const [contentId, revision] = this.values;
      return (
        this.database.revisions.find(
          (row) =>
            row.content_id === String(contentId) &&
            row.revision === Number(revision),
        ) ?? null
      ) as T | null;
    }
    if (
      this.normalizedSql.includes("JSON_EACH") &&
      this.normalizedSql.includes("FROM CMS_CONTENT AS CONTENT")
    ) {
      const references = this.values.map(String);
      const row = [...this.database.content.values()]
        .filter((candidate) => candidate.kind === "lesson" && candidate.status === "published")
        .find((candidate) => {
          const content = JSON.parse(candidate.content) as { vocabularyIds?: unknown };
          return (
            Array.isArray(content.vocabularyIds) &&
            content.vocabularyIds.some((wordId) => references.includes(String(wordId)))
          );
        });
      return (row ?? null) as T | null;
    }
    if (
      this.normalizedSql.includes("FROM CMS_CONTENT WHERE ID = ?")
    ) {
      return (this.database.content.get(String(this.values[0])) ?? null) as T | null;
    }
    if (
      this.normalizedSql.includes("FROM SUPPORT_REQUESTS WHERE ID = ?")
    ) {
      const row = this.database.support.get(String(this.values[0]));
      return (row ? publicSupportRow(row) : null) as T | null;
    }
    throw new Error(`Unexpected first() SQL: ${this.normalizedSql}`);
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: object }> {
    if (
      this.normalizedSql.includes(
        "FROM CMS_VOCABULARY_ALIASES AS VOCABULARY_ALIAS",
      ) && this.normalizedSql.includes("AS MATCHED_ALIAS")
    ) {
      const requested = new Set(this.values.map(String));
      const rows = [...this.database.aliases.entries()].flatMap(
        ([alias, identity]) => {
          if (!requested.has(alias)) return [];
          const content = this.database.content.get(identity.contentId);
          return content && content.kind === "vocabulary"
            ? [{ matched_alias: alias, ...content }]
            : [];
        },
      );
      return { results: rows as T[], success: true, meta: {} };
    }

    if (
      this.normalizedSql.includes("FROM CMS_VOCABULARY_ALIASES") &&
      this.normalizedSql.includes("ORDER BY VOCABULARY_ALIAS.ALIAS ASC")
    ) {
      const aliasAfter = String(this.values[0]);
      const limit = Number(this.values[1]);
      const rows = [...this.database.aliases.entries()]
        .filter(([alias]) => alias > aliasAfter)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit)
        .flatMap(([alias, identity]) => {
          const content = this.database.content.get(identity.contentId);
          return content?.kind === "vocabulary" && content.status === "published"
            ? [{ alias, content_id: identity.contentId }]
            : [];
        });
      return { results: rows as T[], success: true, meta: {} };
    }

    if (this.normalizedSql.includes("FROM CMS_VOCABULARY_ALIASES")) {
      const [contentId, stableKey] = this.values.map(String);
      const rows = [...this.database.aliases.entries()]
        .filter(
          ([, identity]) =>
            identity.contentId === contentId || identity.stableKey === stableKey,
        )
        .map(([alias]) => ({ alias }));
      return { results: rows as T[], success: true, meta: {} };
    }

    if (this.normalizedSql.includes("FROM CMS_CONTENT_REVISIONS")) {
      const contentId = String(this.values[0]);
      let rows = this.database.revisions.filter((row) => row.content_id === contentId);
      let cursor = 1;
      if (this.normalizedSql.includes("REVISION < ?")) {
        const beforeRevision = Number(this.values[cursor++]);
        rows = rows.filter((row) => row.revision < beforeRevision);
      }
      const limit = Number(this.values[cursor]);
      rows.sort((left, right) => right.revision - left.revision);
      return { results: rows.slice(0, limit) as T[], success: true, meta: {} };
    }

    if (this.normalizedSql.includes("FROM CMS_CONTENT")) {
      let rows = [...this.database.content.values()];
      let cursor = 0;
      if (this.normalizedSql.includes("KIND = ?")) {
        const kind = String(this.values[cursor++]);
        rows = rows.filter((row) => row.kind === kind);
      }
      if (this.normalizedSql.includes("STATUS = ?")) {
        const status = String(this.values[cursor++]);
        rows = rows.filter((row) => row.status === status);
      }
      if (this.normalizedSql.includes("STATUS = 'PUBLISHED'")) {
        rows = rows.filter((row) => row.status === "published");
      }
      if (this.normalizedSql.includes("SLUG IN (")) {
        const slugs = new Set(this.values.map(String));
        rows = rows.filter((row) => slugs.has(row.slug));
        return {
          results: rows.map((row) => ({ slug: row.slug })) as T[],
          success: true,
          meta: {},
        };
      }
      if (this.normalizedSql.includes("UPDATED_AT > ?")) {
        const updatedAfter = Number(this.values[cursor]);
        const idAfter = String(this.values[cursor + 2]);
        cursor += 3;
        rows = rows.filter(
          (row) =>
            row.updated_at > updatedAfter ||
            (row.updated_at === updatedAfter && row.id > idAfter),
        );
        rows.sort(
          (left, right) => left.updated_at - right.updated_at || left.id.localeCompare(right.id),
        );
      } else {
        if (this.normalizedSql.includes("UPDATED_AT < ?")) {
          const updatedBefore = Number(this.values[cursor]);
          const idAfter = String(this.values[cursor + 2]);
          cursor += 3;
          rows = rows.filter(
            (row) =>
              row.updated_at < updatedBefore ||
              (row.updated_at === updatedBefore && row.id > idAfter),
          );
        }
        rows.sort(
          (left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id),
        );
      }
      const rawLimit = this.normalizedSql.includes("LIMIT ?")
        ? this.values[this.values.length - 1]
        : 1000;
      const limit = Number(rawLimit);
      return { results: rows.slice(0, limit) as T[], success: true, meta: {} };
    }

    if (this.normalizedSql.includes("FROM SUPPORT_REQUESTS")) {
      let rows = [...this.database.support.values()];
      let cursor = 0;
      if (this.normalizedSql.includes("STATUS = ?")) {
        const status = String(this.values[cursor++]);
        rows = rows.filter((row) => row.status === status);
      }
      if (this.normalizedSql.includes("CATEGORY = ?")) {
        const category = String(this.values[cursor++]);
        rows = rows.filter((row) => row.category === category);
      }
      if (this.normalizedSql.includes("UPDATED_AT < ?")) {
        const updatedBefore = Number(this.values[cursor]);
        const idAfter = String(this.values[cursor + 2]);
        rows = rows.filter(
          (row) =>
            row.updated_at < updatedBefore ||
            (row.updated_at === updatedBefore && row.id > idAfter),
        );
      }
      const limit = Number(this.values[this.values.length - 1] ?? 100);
      rows.sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id));
      return {
        results: rows.slice(0, limit).map(publicSupportRow) as T[],
        success: true,
        meta: {},
      };
    }

    if (this.normalizedSql.includes("FROM ADMIN_AUDIT_LOG")) {
      let rows = [...this.database.audits];
      let cursor = 0;
      if (this.normalizedSql.includes("ENTITY_TYPE = ?")) {
        const entityType = String(this.values[cursor++]);
        rows = rows.filter((row) => row.entity_type === entityType);
      }
      if (this.normalizedSql.includes("ENTITY_ID = ?")) {
        const entityId = String(this.values[cursor++]);
        rows = rows.filter((row) => row.entity_id === entityId);
      }
      if (this.normalizedSql.includes("CREATED_AT < ?")) {
        const createdBefore = Number(this.values[cursor]);
        const idBefore = Number(this.values[cursor + 2]);
        cursor += 3;
        rows = rows.filter(
          (row) =>
            row.created_at < createdBefore ||
            (row.created_at === createdBefore && row.id < idBefore),
        );
      }
      const limit = Number(this.values[this.values.length - 1] ?? 100);
      rows.sort((left, right) => right.created_at - left.created_at || right.id - left.id);
      return { results: rows.slice(0, limit) as T[], success: true, meta: {} };
    }

    throw new Error(`Unexpected all() SQL: ${this.normalizedSql}`);
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.normalizedSql.startsWith("INSERT INTO CMS_CONTENT_REVISIONS")) {
      if (
        this.normalizedSql.includes("CHANGES() = 1") &&
        this.database.lastChanges !== 1
      ) {
        return changed(0);
      }
      const action = this.normalizedSql.includes("'CREATE'")
        ? "CREATE"
        : this.normalizedSql.includes("'UPDATE'")
          ? "UPDATE"
          : this.normalizedSql.includes("'RESTORE'")
            ? "RESTORE"
            : String(this.values[1]);
      const idIndex = action === "PUBLISH" || action === "UNPUBLISH" ? 3 : 2;
      const row = this.database.content.get(String(this.values[idIndex]));
      if (!row) return changed(0);
      if (
        this.database.revisions.some(
          (revision) =>
            revision.content_id === row.id && revision.revision === row.revision,
        )
      ) {
        throw new Error(
          "UNIQUE constraint failed: cms_content_revisions.content_id, cms_content_revisions.revision",
        );
      }
      this.database.revisions.push({
        content_id: row.id,
        revision: row.revision,
        kind: row.kind,
        slug: row.slug,
        stable_key: row.stable_key,
        title: row.title,
        content: row.content,
        status: row.status,
        published_at: row.published_at,
        actor_email: String(this.values[0]),
        action: action as ContentRevisionRow["action"],
        created_at: Number(action === "PUBLISH" || action === "UNPUBLISH" ? this.values[2] : this.values[1]),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("INSERT OR IGNORE INTO CMS_SLUG_TOMBSTONES")) {
      if (
        this.normalizedSql.includes("CHANGES() = 1") &&
        this.database.lastChanges !== 1
      ) {
        return changed(0);
      }
      const deleting = this.normalizedSql.includes(
        "SELECT KIND, SLUG, STABLE_KEY, ID",
      );
      const id = String(this.values[deleting ? 2 : 3]);
      const requiredRevision = Number(this.values[deleting ? 3 : 4]);
      const row = this.database.content.get(id);
      if (!row || row.revision !== requiredRevision || row.status !== "draft") {
        return changed(0);
      }
      const slug = deleting ? row.slug : String(this.values[0]);
      if (!deleting && slug === String(this.values.at(-1))) return changed(0);
      const key = `${row.kind}:${slug}`;
      if (this.database.tombstones.has(key)) return changed(0);
      this.database.tombstones.set(key, {
        contentId: row.id,
        stableKey: row.stable_key,
        retiredAt: Number(this.values[deleting ? 0 : 1]),
        retiredBy: String(this.values[deleting ? 1 : 2]),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("INSERT INTO CMS_CONTENT")) {
      const [
        id,
        kind,
        slug,
        stableKey,
        title,
        content,
        createdAt,
        updatedAt,
        creator,
        updater,
      ] =
        this.values;
      if (this.database.tombstones.has(`${String(kind)}:${String(slug)}`)) {
        return changed(0);
      }
      if (
        [...this.database.content.values()].some(
          (row) => row.kind === kind && row.slug === slug,
        )
      ) {
        throw new Error("UNIQUE constraint failed: cms_content.kind, cms_content.slug");
      }
      this.database.content.set(String(id), {
        id: String(id),
        kind: kind as ContentRow["kind"],
        slug: String(slug),
        stable_key: String(stableKey),
        title: String(title),
        content: String(content),
        status: "draft",
        revision: 1,
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
        published_at: null,
        review_status: "draft",
        reviewed_by_email: null,
        reviewed_at: null,
        approved_revision: null,
        created_by_email: String(creator),
        updated_by_email: String(updater),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("UPDATE CMS_CONTENT SET SLUG")) {
      const beforeUpdate = this.database.beforeContentSlugUpdate;
      this.database.beforeContentSlugUpdate = null;
      beforeUpdate?.();
      const [slug, title, content, updatedAt, updater, id, revision, guardedSlug] = this.values;
      const row = this.database.content.get(String(id));
      if (!row || row.revision !== Number(revision) || row.status !== "draft") {
        return changed(0);
      }
      const retired = this.database.tombstones.get(`${row.kind}:${String(guardedSlug)}`);
      if (retired && retired.contentId !== row.id) return changed(0);
      if (
        [...this.database.content.values()].some(
          (other) =>
            other.id !== row.id && other.kind === row.kind && other.slug === slug,
        )
      ) {
        throw new Error("UNIQUE constraint failed: cms_content.kind, cms_content.slug");
      }
      this.database.content.set(row.id, {
        ...row,
        slug: String(slug),
        title: String(title),
        content: String(content),
        revision: row.revision + 1,
        updated_at: Number(updatedAt),
        updated_by_email: String(updater),
        review_status: "draft",
        reviewed_by_email: null,
        reviewed_at: null,
        approved_revision: null,
      });
      return changed(1);
    }

    if (
      this.normalizedSql.startsWith(
        "INSERT OR IGNORE INTO CMS_VOCABULARY_ALIASES",
      )
    ) {
      const createdAt = Number(this.values[0]);
      const id = String(this.values[1]);
      const requiredRevision =
        this.values.length > 2 ? Number(this.values[2]) : 1;
      const row = this.database.content.get(id);
      if (
        !row ||
        row.kind !== "vocabulary" ||
        row.revision !== requiredRevision ||
        this.database.aliases.has(row.slug)
      ) {
        return changed(0);
      }
      this.database.aliases.set(row.slug, {
        contentId: row.id,
        stableKey: row.stable_key,
        createdAt,
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("UPDATE CMS_CONTENT SET STATUS")) {
      const beforeUpdate = this.database.beforeContentStatusUpdate;
      this.database.beforeContentStatusUpdate = null;
      beforeUpdate?.();
      const [
        status,
        publishedAt,
        updatedAt,
        reviewStatus,
        reviewedBy,
        reviewedAt,
        approvedRevision,
        id,
        revision,
        previousStatus,
      ] = this.values;
      const row = this.database.content.get(String(id));
      if (
        !row ||
        row.revision !== Number(revision) ||
        row.status !== previousStatus
      ) {
        return changed(0);
      }
      const dependencyValues = this.values.slice(10).map(String);
      if (
        this.normalizedSql.includes("LIVE_VOCABULARY") &&
        dependencyValues.some((value, index) => {
          if (index % 3 !== 0) return false;
          const candidate = this.database.content.get(value);
          return !(
            candidate &&
            candidate.kind === "vocabulary" &&
            candidate.stable_key === dependencyValues[index + 1] &&
            candidate.revision === Number(dependencyValues[index + 2]) &&
            candidate.status === "published"
          );
        })
      ) {
        return changed(0);
      }
      if (
        this.normalizedSql.includes("JSON_EACH") &&
        [...this.database.content.values()].some((candidate) => {
          if (candidate.kind !== "lesson" || candidate.status !== "published") {
            return false;
          }
          const content = JSON.parse(candidate.content) as { vocabularyIds?: unknown };
          return (
            Array.isArray(content.vocabularyIds) &&
            content.vocabularyIds.some((wordId) => dependencyValues.includes(String(wordId)))
          );
        })
      ) {
        return changed(0);
      }
      this.database.content.set(row.id, {
        ...row,
        status: status as ContentRow["status"],
        published_at: publishedAt === null ? null : Number(publishedAt),
        revision: row.revision + 1,
        updated_at: Number(updatedAt),
        review_status: reviewStatus as ContentRow["review_status"],
        reviewed_by_email: reviewedBy === null ? null : String(reviewedBy),
        reviewed_at: reviewedAt === null ? null : Number(reviewedAt),
        approved_revision:
          approvedRevision === null ? null : Number(approvedRevision),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("UPDATE CMS_CONTENT SET REVIEW_STATUS")) {
      const [
        reviewStatus,
        reviewedBy,
        reviewedAt,
        approvedRevision,
        id,
        revision,
        previousReviewStatus,
      ] = this.values;
      const row = this.database.content.get(String(id));
      if (
        !row ||
        row.revision !== Number(revision) ||
        row.status !== "draft" ||
        row.review_status !== previousReviewStatus
      ) {
        return changed(0);
      }
      this.database.content.set(row.id, {
        ...row,
        review_status: reviewStatus as ContentRow["review_status"],
        reviewed_by_email: reviewedBy === null ? null : String(reviewedBy),
        reviewed_at: reviewedAt === null ? null : Number(reviewedAt),
        approved_revision:
          approvedRevision === null ? null : Number(approvedRevision),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("DELETE FROM CMS_CONTENT")) {
      const [id, revision] = this.values;
      const row = this.database.content.get(String(id));
      if (!row || row.revision !== Number(revision)) return changed(0);
      this.database.content.delete(row.id);
      return changed(1);
    }

    if (this.normalizedSql.startsWith("INSERT INTO SUPPORT_REQUESTS")) {
      const [
        id,
        userKey,
        replyEmail,
        category,
        subject,
        body,
        createdAt,
        updatedAt,
        rateUserKey,
        oneHourAgo,
        maximum,
      ] = this.values;
      const recent = [...this.database.support.values()].filter(
        (row) =>
          row.user_key === rateUserKey && row.created_at >= Number(oneHourAgo),
      ).length;
      if (recent >= Number(maximum)) return changed(0);
      this.database.support.set(String(id), {
        id: String(id),
        user_key: String(userKey),
        reply_email: replyEmail === null ? null : String(replyEmail),
        category: category as SupportRow["category"],
        subject: String(subject),
        body: String(body),
        status: "open",
        revision: 1,
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("UPDATE SUPPORT_REQUESTS")) {
      const beforeUpdate = this.database.beforeSupportStatusUpdate;
      this.database.beforeSupportStatusUpdate = null;
      beforeUpdate?.();
      const [status, updatedAt, id, revision] = this.values;
      const row = this.database.support.get(String(id));
      if (!row || row.revision !== Number(revision)) return changed(0);
      this.database.support.set(row.id, {
        ...row,
        status: status as SupportRow["status"],
        revision: row.revision + 1,
        updated_at: Number(updatedAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.startsWith("INSERT INTO ADMIN_AUDIT_LOG")) {
      if (
        this.normalizedSql.includes("CHANGES() = 1") &&
        this.database.lastChanges !== 1
      ) {
        return changed(0);
      }
      return this.insertAudit();
    }

    throw new Error(`Unexpected run() SQL: ${this.normalizedSql}`);
  }

  private insertAudit(): { meta: { changes: number } } {
    if (this.normalizedSql.includes("'CREATE'")) {
      const [actor, details, createdAt, entityId] = this.values;
      this.addAudit({
        entityType: "content",
        entityId: String(entityId),
        actor: String(actor),
        action: "CREATE",
        fromRevision: null,
        toRevision: 1,
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.includes("'RESTORE'")) {
      const [actor, fromRevision, toRevision, details, createdAt, id, requiredRevision] =
        this.values;
      const row = this.database.content.get(String(id));
      if (!row || row.revision !== Number(requiredRevision)) return changed(0);
      this.addAudit({
        entityType: "content",
        entityId: row.id,
        actor: String(actor),
        action: "RESTORE",
        fromRevision: Number(fromRevision),
        toRevision: Number(toRevision),
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.includes("'DELETE'")) {
      const [actor, details, createdAt, id, revision] = this.values;
      const row = this.database.content.get(String(id));
      if (!row || row.revision !== Number(revision)) return changed(0);
      this.addAudit({
        entityType: "content",
        entityId: row.id,
        actor: String(actor),
        action: "DELETE",
        fromRevision: row.revision,
        toRevision: null,
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.includes("'UPDATE'")) {
      const [actor, fromRevision, toRevision, details, createdAt, id, requiredRevision] =
        this.values;
      const row = this.database.content.get(String(id));
      if (!row || row.revision !== Number(requiredRevision)) return changed(0);
      this.addAudit({
        entityType: "content",
        entityId: row.id,
        actor: String(actor),
        action: "UPDATE",
        fromRevision: Number(fromRevision),
        toRevision: Number(toRevision),
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    if (this.normalizedSql.includes("SUPPORT_STATUS_CHANGED")) {
      const [actor, fromRevision, toRevision, details, createdAt, id, requiredRevision, status] =
        this.values;
      const row = this.database.support.get(String(id));
      if (
        !row ||
        row.revision !== Number(requiredRevision) ||
        row.status !== status
      ) {
        return changed(0);
      }
      this.addAudit({
        entityType: "support_request",
        entityId: row.id,
        actor: String(actor),
        action: "SUPPORT_STATUS_CHANGED",
        fromRevision: Number(fromRevision),
        toRevision: Number(toRevision),
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    if (
      this.values.length === 7 &&
      ["REVIEW_SUBMITTED", "REVIEW_APPROVED", "CHANGES_REQUESTED"].includes(
        String(this.values[1]),
      )
    ) {
      const [actor, action, details, createdAt, id, revision, reviewStatus] =
        this.values;
      const row = this.database.content.get(String(id));
      if (
        !row ||
        row.revision !== Number(revision) ||
        row.review_status !== reviewStatus
      ) {
        return changed(0);
      }
      this.addAudit({
        entityType: "content",
        entityId: row.id,
        actor: String(actor),
        action: String(action),
        fromRevision: row.revision,
        toRevision: row.revision,
        details: String(details),
        createdAt: Number(createdAt),
      });
      return changed(1);
    }

    const [actor, action, fromRevision, toRevision, details, createdAt, id, requiredRevision] =
      this.values;
    const row = this.database.content.get(String(id));
    if (!row || row.revision !== Number(requiredRevision)) return changed(0);
    this.addAudit({
      entityType: "content",
      entityId: row.id,
      actor: String(actor),
      action: String(action),
      fromRevision: Number(fromRevision),
      toRevision: Number(toRevision),
      details: String(details),
      createdAt: Number(createdAt),
    });
    return changed(1);
  }

  private addAudit(value: {
    entityType: AuditRow["entity_type"];
    entityId: string;
    actor: string;
    action: string;
    fromRevision: number | null;
    toRevision: number | null;
    details: string;
    createdAt: number;
  }) {
    this.database.audits.push({
      id: this.database.audits.length + 1,
      entity_type: value.entityType,
      entity_id: value.entityId,
      actor_email: value.actor,
      action: value.action,
      from_revision: value.fromRevision,
      to_revision: value.toRevision,
      details: value.details,
      created_at: value.createdAt,
    });
  }
}

function changed(changes: number) {
  return { meta: { changes } };
}

function publicSupportRow(row: StoredSupportRow): SupportRow {
  return {
    id: row.id,
    reply_email: row.reply_email,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ADMIN_EMAIL = "editor@paretto.test";
const REVIEWER_EMAIL = "reviewer@paretto.test";
let adminCookie = "";
let reviewerCookie = "";
const ADMIN_HEADERS = {
  "content-type": "application/json",
};
const LEARNER_HEADERS = {
  "content-type": "application/json",
};

function adminRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://paretto.test${path}`, {
    ...init,
    headers: {
      ...ADMIN_HEADERS,
      cookie: adminCookie,
      ...headersObject(init.headers),
    },
  });
}

function reviewerRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://paretto.test${path}`, {
    ...init,
    headers: {
      ...ADMIN_HEADERS,
      cookie: reviewerCookie,
      ...headersObject(init.headers),
    },
  });
}

function learnerRequest(body: object, email = "learner@paretto.test") {
  const token =
    email === "learner@paretto.test" ? "L".repeat(43) : "S".repeat(43);
  return new Request("https://paretto.test/api/support", {
    method: "POST",
    headers: { ...LEARNER_HEADERS, ...learnerCookieHeaders(token) },
    body: JSON.stringify({
      ...body,
      turnstileToken: "test-turnstile-token",
    }),
  });
}

function headersObject(headers?: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function validVocabulary(overrides: Record<string, unknown> = {}) {
  return {
    french: "le métro",
    english: "subway",
    ipa: "/lə metʁo/",
    partOfSpeech: "noun",
    gender: "masculine",
    regionId: "ile-de-france",
    exampleFr: "Je prends le métro.",
    exampleEn: "I take the subway.",
    cefr: "A1",
    lesson: 1,
    topic: "city landmarks",
    emoji: "🚇",
    sensitive: false,
    tags: ["transport"],
    ...overrides,
  };
}

function validLesson(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Learn practical transport language for a trip across Paris.",
    regionId: "ile-de-france",
    cefr: "A1",
    lesson: 1,
    topic: "city landmarks",
    sensitive: false,
    introduction: "Use these words to navigate the Métro and ask for help.",
    estimatedMinutes: 8,
    vocabularyIds: [
      "idf-metro",
      "idf-musee",
      "idf-banlieue",
      "idf-se-depecher",
      "idf-anime",
    ],
    blocks: [{ type: "text", content: "Read each phrase aloud twice." }],
    ...overrides,
  };
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe("admin CMS and support APIs", () => {
  let database: CmsMemoryD1;

  beforeEach(async () => {
    database = new CmsMemoryD1();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const adminAuth = await createAdminTestAuth([
      ADMIN_EMAIL,
      REVIEWER_EMAIL,
    ]);
    adminCookie = adminAuth.cookies.get(ADMIN_EMAIL)!;
    reviewerCookie = adminAuth.cookies.get(REVIEWER_EMAIL)!;
    setCloudflareEnv({
      DB: database,
      ...adminAuth.bindings,
      USER_KEY_SECRET: "test-user-key-secret-with-more-than-thirty-two-characters",
      TURNSTILE_SITE_KEY: TEST_TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successfulTurnstileResponse()),
    );
  });

  it("authorizes every admin operation and strictly validates draft creation", async () => {
    const anonymous = await CONTENT_LIST(
      new Request("https://paretto.test/api/admin/content"),
    );
    expect(anonymous.status).toBe(401);

    const forbidden = await CONTENT_LIST(
      new Request("https://paretto.test/api/admin/content", {
        headers: { cookie: "__Host-admin-session=invalid" },
      }),
    );
    expect(forbidden.status).toBe(401);

    const invalid = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "bad draft",
          title: "Draft",
          content: validVocabulary(),
          status: "published",
        }),
      }),
    );
    expect(invalid.status).toBe(400);

    const oversized = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        headers: { "content-length": String(64 * 1024 + 1) },
        body: JSON.stringify({}),
      }),
    );
    expect(oversized.status).toBe(413);

    const created = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "idf-metro",
          title: "Métro basics",
          content: validVocabulary(),
        }),
      }),
    );
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({
      entry: {
        kind: "vocabulary",
        slug: "idf-metro",
        stableKey: "idf-metro",
        publicId: "idf-metro",
        status: "draft",
        revision: 1,
      },
    });
    expect(database.audits).toHaveLength(1);
    expect(database.audits[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "CREATE",
    });
  });

  it("blocks incomplete lessons and unshipped audio, and resets approval after edits", async () => {
    const incompleteLesson = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "lesson",
          slug: "four-card-lesson",
          title: "Incomplete lesson",
          content: validLesson({
            vocabularyIds: [
              "idf-metro",
              "idf-musee",
              "idf-banlieue",
              "idf-se-depecher",
            ],
          }),
        }),
      }),
    );
    expect(incompleteLesson.status).toBe(400);

    const audioDraft = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "new-audio-card",
          title: "New audio card",
          content: validVocabulary(),
        }),
      }),
    );
    const audioEntry = await json<{ entry: ContentRow }>(audioDraft);
    const audioContext = { params: Promise.resolve({ id: audioEntry.entry.id }) };
    expect(
      (
        await CONTENT_REVIEW(
          adminRequest(`/api/admin/content/${audioEntry.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 1, action: "submit" }),
          }),
          audioContext,
        )
      ).status,
    ).toBe(200);
    const audioApproval = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${audioEntry.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "approve" }),
      }),
      audioContext,
    );
    expect(audioApproval.status).toBe(422);
    expect(await json(audioApproval)).toMatchObject({ code: "AUDIO_NOT_PACKAGED" });

    const reviewedDraft = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "idf-metro",
          title: "Reviewed card",
          content: validVocabulary(),
        }),
      }),
    );
    const reviewed = await json<{ entry: ContentRow }>(reviewedDraft);
    const reviewedContext = { params: Promise.resolve({ id: reviewed.entry.id }) };
    await CONTENT_REVIEW(
      adminRequest(`/api/admin/content/${reviewed.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "submit" }),
      }),
      reviewedContext,
    );
    const missingNote = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${reviewed.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "request_changes" }),
      }),
      reviewedContext,
    );
    expect(missingNote.status).toBe(400);
    const approved = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${reviewed.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "approve" }),
      }),
      reviewedContext,
    );
    expect(approved.status).toBe(200);
    const edited = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${reviewed.entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "metro-reviewed-copy",
          title: "Edited after approval",
          content: validVocabulary(),
        }),
      }),
      reviewedContext,
    );
    expect(edited.status).toBe(200);
    expect(await json(edited)).toMatchObject({
      entry: {
        revision: 2,
        stableKey: "idf-metro",
        publicId: "idf-metro",
        reviewStatus: "draft",
        reviewedByEmail: null,
        approvedRevision: null,
      },
    });

    const misalignedLesson = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "lesson",
          slug: "misaligned-lesson",
          title: "Misaligned lesson",
          content: validLesson({ topic: "unrelated topic" }),
        }),
      }),
    );
    const misaligned = await json<{ entry: ContentRow }>(misalignedLesson);
    const misalignedContext = {
      params: Promise.resolve({ id: misaligned.entry.id }),
    };
    await CONTENT_REVIEW(
      adminRequest(`/api/admin/content/${misaligned.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "submit" }),
      }),
      misalignedContext,
    );
    const mismatch = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${misaligned.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "approve" }),
      }),
      misalignedContext,
    );
    expect(mismatch.status).toBe(422);
    expect(await json(mismatch)).toMatchObject({
      code: "VOCABULARY_METADATA_MISMATCH",
    });
  });

  it("supports revision-safe CRUD, publishing, audit, and public curriculum ETags", async () => {
    const createResponse = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "idf-metro",
          title: "Métro basics",
          content: validVocabulary(),
        }),
      }),
    );
    const created = await json<{ entry: ContentRow }>(createResponse);
    const id = created.entry.id;
    const context = { params: Promise.resolve({ id }) };

    const read = await CONTENT_GET(
      adminRequest(`/api/admin/content/${id}`),
      context,
    );
    expect(read.status).toBe(200);

    const updated = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "metro-basics",
          title: "Métro essentials",
          content: validVocabulary({ tags: ["transport", "paris"] }),
        }),
      }),
      context,
    );
    expect(updated.status).toBe(200);
    expect(await json(updated)).toMatchObject({
      entry: {
        revision: 2,
        title: "Métro essentials",
        slug: "metro-basics",
        stableKey: "idf-metro",
        publicId: "idf-metro",
        reviewStatus: "draft",
      },
    });
    expect([...database.aliases.keys()].sort()).toEqual([
      "idf-metro",
      "metro-basics",
    ]);

    const stale = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "metro-old",
          title: "Stale title",
          content: validVocabulary(),
        }),
      }),
      context,
    );
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: "REVISION_CONFLICT" });

    const publishWithoutReview = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "publish" }),
      }),
      context,
    );
    expect(publishWithoutReview.status).toBe(409);
    expect(await json(publishWithoutReview)).toMatchObject({ code: "REVIEW_REQUIRED" });

    const submitted = await CONTENT_REVIEW(
      adminRequest(`/api/admin/content/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "submit" }),
      }),
      context,
    );
    expect(submitted.status).toBe(200);
    expect(await json(submitted)).toMatchObject({
      entry: { reviewStatus: "pending", approvedRevision: null },
    });

    const selfApproval = await CONTENT_REVIEW(
      adminRequest(`/api/admin/content/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "approve" }),
      }),
      context,
    );
    expect(selfApproval.status).toBe(409);
    expect(await json(selfApproval)).toMatchObject({
      code: "SEPARATION_OF_DUTIES_REQUIRED",
    });

    const approved = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "approve" }),
      }),
      context,
    );
    expect(approved.status).toBe(200);
    expect(await json(approved)).toMatchObject({
      entry: {
        reviewStatus: "approved",
        reviewedByEmail: REVIEWER_EMAIL,
        approvedRevision: 2,
        packagedAudioReady: true,
      },
    });

    const published = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "publish" }),
      }),
      context,
    );
    expect(published.status).toBe(200);
    expect(await json(published)).toMatchObject({
      entry: { status: "published", revision: 3 },
    });

    const publishedEdit = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 3,
          slug: "idf-metro",
          title: "Unsafe live edit",
          content: validVocabulary(),
        }),
      }),
      context,
    );
    expect(publishedEdit.status).toBe(409);
    expect(await json(publishedEdit)).toMatchObject({ code: "STATUS_CONFLICT" });

    const curriculum = await CURRICULUM_GET(
      new Request("https://paretto.test/api/curriculum"),
    );
    expect(curriculum.status).toBe(200);
    expect(curriculum.headers.get("cache-control")).toMatch(/public/);
    const etag = curriculum.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await json(curriculum)).toMatchObject({
      schemaVersion: 1,
      source: "cms",
      records: [
        {
          id,
          kind: "vocabulary",
          title: "Métro essentials",
          stableKey: "idf-metro",
          aliases: ["idf-metro", "metro-basics"],
        },
      ],
    });
    const notModified = await CURRICULUM_GET(
      new Request("https://paretto.test/api/curriculum", {
        headers: { "if-none-match": String(etag) },
      }),
    );
    expect(notModified.status).toBe(304);

    const unpublished = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 3, action: "unpublish" }),
      }),
      context,
    );
    expect(unpublished.status).toBe(200);
    expect(await json(unpublished)).toMatchObject({
      entry: { status: "draft", revision: 4 },
    });

    const deleted = await CONTENT_DELETE(
      adminRequest(`/api/admin/content/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ revision: 4 }),
      }),
      context,
    );
    expect(deleted.status).toBe(200);
    expect(database.content.size).toBe(0);
    expect(database.revisions.map((revision) => revision.action)).toEqual([
      "CREATE",
      "UPDATE",
      "PUBLISH",
      "UNPUBLISH",
    ]);

    const reusedSlug = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "idf-metro",
          title: "Different word using a retired ID",
          content: validVocabulary({ french: "le tram", english: "tram" }),
        }),
      }),
    );
    expect(reusedSlug.status).toBe(409);
    expect(await json(reusedSlug)).toMatchObject({ code: "SLUG_RETIRED" });

    const audit = await AUDIT_GET(adminRequest("/api/admin/audit"));
    expect(audit.status).toBe(200);
    const auditBody = await json<{ events: Array<{ action: string }> }>(audit);
    expect(auditBody.events.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "CREATE",
        "UPDATE",
        "REVIEW_SUBMITTED",
        "REVIEW_APPROVED",
        "PUBLISH",
        "UNPUBLISH",
        "DELETE",
      ]),
    );
  });

  it("keeps immutable snapshots and restores an approved revision as a new draft", async () => {
    const createdResponse = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "stable-greeting",
          title: "Approved greeting",
          content: validVocabulary({ french: "bonjour", english: "hello" }),
        }),
      }),
    );
    const created = await json<{ entry: ContentRow }>(createdResponse);
    const context = { params: Promise.resolve({ id: created.entry.id }) };

    const originalRow = database.content.get(created.entry.id);
    const auditCountBeforeRace = database.audits.length;
    database.beforeContentSlugUpdate = () => {
      const row = database.content.get(created.entry.id);
      if (row) {
        database.content.set(row.id, {
          ...row,
          title: "Another editor won",
          revision: row.revision + 1,
          updated_at: row.updated_at + 1,
          updated_by_email: "other-editor@paretto.test",
        });
      }
    };
    const lostUpdate = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${created.entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "temporary-greeting",
          title: "Losing update",
          content: validVocabulary({ french: "salut", english: "hi" }),
        }),
      }),
      context,
    );
    expect(lostUpdate.status).toBe(409);
    expect(database.audits).toHaveLength(auditCountBeforeRace);
    expect(database.revisions).toHaveLength(1);
    if (originalRow) database.content.set(originalRow.id, originalRow);

    const changedResponse = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${created.entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "temporary-greeting",
          title: "Unapproved replacement",
          content: validVocabulary({ french: "salut", english: "hi" }),
        }),
      }),
      context,
    );
    expect(changedResponse.status).toBe(200);

    const history = await CONTENT_REVISIONS(
      adminRequest(`/api/admin/content/${created.entry.id}/revisions`),
      context,
    );
    expect(history.status).toBe(200);
    expect(await json(history)).toMatchObject({
      revisions: [
        { revision: 2, action: "UPDATE", slug: "temporary-greeting" },
        { revision: 1, action: "CREATE", slug: "stable-greeting" },
      ],
      nextBeforeRevision: null,
    });

    const restored = await CONTENT_RESTORE(
      adminRequest(`/api/admin/content/${created.entry.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, sourceRevision: 1 }),
      }),
      context,
    );
    expect(restored.status).toBe(200);
    expect(await json(restored)).toMatchObject({
      entry: {
        revision: 3,
        status: "draft",
        slug: "stable-greeting",
        stableKey: "stable-greeting",
        publicId: "cms-stable-greeting",
        reviewStatus: "draft",
        title: "Approved greeting",
        content: { french: "bonjour", english: "hello" },
      },
    });
    expect(database.revisions.at(-1)).toMatchObject({
      revision: 3,
      action: "RESTORE",
      slug: "stable-greeting",
    });
    expect(database.audits.at(-1)).toMatchObject({ action: "RESTORE" });
  });

  it("publishes lessons only with live vocabulary and protects their dependencies", async () => {
    const vocabularyResponse = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "vocabulary",
          slug: "idf-metro",
          title: "Métro override",
          content: validVocabulary(),
        }),
      }),
    );
    const vocabulary = await json<{ entry: ContentRow }>(vocabularyResponse);
    const vocabularyContext = { params: Promise.resolve({ id: vocabulary.entry.id }) };
    expect(
      (
        await CONTENT_REVIEW(
          adminRequest(`/api/admin/content/${vocabulary.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 1, action: "submit" }),
          }),
          vocabularyContext,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await CONTENT_REVIEW(
          reviewerRequest(`/api/admin/content/${vocabulary.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 1, action: "approve" }),
          }),
          vocabularyContext,
        )
      ).status,
    ).toBe(200);
    const vocabularyPublished = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${vocabulary.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "publish" }),
      }),
      vocabularyContext,
    );
    expect(vocabularyPublished.status).toBe(200);

    const lessonResponse = await CONTENT_CREATE(
      adminRequest("/api/admin/content", {
        method: "POST",
        body: JSON.stringify({
          kind: "lesson",
          slug: "paris-navigation",
          title: "Navigate Paris",
          content: validLesson({
            vocabularyIds: [
              "idf-metro",
              "idf-musee",
              "idf-banlieue",
              "idf-se-depecher",
              "missing-card",
            ],
          }),
        }),
      }),
    );
    const lesson = await json<{ entry: ContentRow }>(lessonResponse);
    const lessonContext = { params: Promise.resolve({ id: lesson.entry.id }) };

    expect(
      (
        await CONTENT_REVIEW(
          adminRequest(`/api/admin/content/${lesson.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 1, action: "submit" }),
          }),
          lessonContext,
        )
      ).status,
    ).toBe(200);
    const missingReference = await CONTENT_REVIEW(
      reviewerRequest(`/api/admin/content/${lesson.entry.id}/review`, {
        method: "POST",
        body: JSON.stringify({ revision: 1, action: "approve" }),
      }),
      lessonContext,
    );
    expect(missingReference.status).toBe(422);
    expect(await json(missingReference)).toMatchObject({ code: "MISSING_VOCABULARY" });

    const correctedLesson = await CONTENT_UPDATE(
      adminRequest(`/api/admin/content/${lesson.entry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          revision: 1,
          slug: "paris-navigation",
          title: "Navigate Paris",
          content: validLesson(),
        }),
      }),
      lessonContext,
    );
    expect(correctedLesson.status).toBe(200);
    expect(
      (
        await CONTENT_REVIEW(
          adminRequest(`/api/admin/content/${lesson.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 2, action: "submit" }),
          }),
          lessonContext,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await CONTENT_REVIEW(
          reviewerRequest(`/api/admin/content/${lesson.entry.id}/review`, {
            method: "POST",
            body: JSON.stringify({ revision: 2, action: "approve" }),
          }),
          lessonContext,
        )
      ).status,
    ).toBe(200);

    database.beforeContentStatusUpdate = () => {
      const row = database.content.get(vocabulary.entry.id);
      if (row) database.content.set(row.id, { ...row, status: "draft" });
    };
    const racedLessonPublish = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${lesson.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "publish" }),
      }),
      lessonContext,
    );
    expect(racedLessonPublish.status).toBe(409);
    const racedVocabulary = database.content.get(vocabulary.entry.id);
    if (racedVocabulary) {
      database.content.set(racedVocabulary.id, {
        ...racedVocabulary,
        status: "published",
      });
    }

    const lessonPublished = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${lesson.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "publish" }),
      }),
      lessonContext,
    );
    expect(lessonPublished.status).toBe(200);

    const dependencyConflict = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${vocabulary.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "unpublish" }),
      }),
      vocabularyContext,
    );
    expect(dependencyConflict.status).toBe(409);
    expect(await json(dependencyConflict)).toMatchObject({ code: "CONTENT_IN_USE" });

    const lessonUnpublished = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${lesson.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 3, action: "unpublish" }),
      }),
      lessonContext,
    );
    expect(lessonUnpublished.status).toBe(200);

    database.beforeContentStatusUpdate = () => {
      const row = database.content.get(lesson.entry.id);
      if (row) database.content.set(row.id, { ...row, status: "published" });
    };
    const racedVocabularyUnpublish = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${vocabulary.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "unpublish" }),
      }),
      vocabularyContext,
    );
    expect(racedVocabularyUnpublish.status).toBe(409);
    const racedLesson = database.content.get(lesson.entry.id);
    if (racedLesson) {
      database.content.set(racedLesson.id, { ...racedLesson, status: "draft" });
    }

    const vocabularyUnpublished = await CONTENT_PUBLICATION(
      adminRequest(`/api/admin/content/${vocabulary.entry.id}/publication`, {
        method: "POST",
        body: JSON.stringify({ revision: 2, action: "unpublish" }),
      }),
      vocabularyContext,
    );
    expect(vocabularyUnpublished.status).toBe(200);
  });

  it("paginates complete admin queues and the public curriculum without silent caps", async () => {
    const now = Date.now();
    for (let index = 0; index < 251; index += 1) {
      const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      database.content.set(id, {
        id,
        kind: "vocabulary",
        slug: `word-${index}`,
        stable_key: `word-${index}`,
        title: `Word ${index}`,
        content: JSON.stringify(
          validVocabulary({ french: `mot ${index}`, english: `word ${index}` }),
        ),
        status: "published",
        revision: 1,
        created_at: now,
        updated_at: now,
        published_at: now,
        review_status: "approved",
        reviewed_by_email: REVIEWER_EMAIL,
        reviewed_at: now,
        approved_revision: 1,
        created_by_email: ADMIN_EMAIL,
        updated_by_email: ADMIN_EMAIL,
      });
    }

    const firstContentPage = await CONTENT_LIST(
      adminRequest("/api/admin/content?limit=100"),
    );
    const firstContent = await json<{
      entries: ContentRow[];
      nextCursor: string | null;
    }>(firstContentPage);
    expect(firstContent.entries).toHaveLength(100);
    expect(firstContent.nextCursor).not.toBeNull();

    const secondContentPage = await CONTENT_LIST(
      adminRequest(
        `/api/admin/content?limit=100&cursor=${encodeURIComponent(String(firstContent.nextCursor))}`,
      ),
    );
    const secondContent = await json<{
      entries: ContentRow[];
      nextCursor: string | null;
    }>(secondContentPage);
    expect(secondContent.entries).toHaveLength(100);
    expect(secondContent.nextCursor).not.toBeNull();

    const thirdContentPage = await CONTENT_LIST(
      adminRequest(
        `/api/admin/content?limit=100&cursor=${encodeURIComponent(String(secondContent.nextCursor))}`,
      ),
    );
    const thirdContent = await json<{ entries: ContentRow[] }>(thirdContentPage);
    expect(thirdContent.entries).toHaveLength(51);

    const curriculum = await CURRICULUM_GET(
      new Request("https://paretto.test/api/curriculum"),
    );
    const curriculumBody = await json<{ records: ContentRow[] }>(curriculum);
    expect(curriculumBody.records).toHaveLength(251);

    for (let index = 1; index <= 205; index += 1) {
      database.audits.push({
        id: index,
        entity_type: "content",
        entity_id: "10000000-0000-4000-8000-000000000000",
        actor_email: ADMIN_EMAIL,
        action: "MIGRATION_CHECK",
        from_revision: null,
        to_revision: null,
        details: "{}",
        created_at: now,
      });
    }
    const auditIds: number[] = [];
    let auditCursor: string | null = null;
    do {
      const url = auditCursor
        ? `/api/admin/audit?limit=100&cursor=${encodeURIComponent(auditCursor)}`
        : "/api/admin/audit?limit=100";
      const response = await AUDIT_GET(adminRequest(url));
      const page = await json<{
        events: AuditRow[];
        nextCursor: string | null;
      }>(response);
      auditIds.push(...page.events.map((event) => event.id));
      auditCursor = page.nextCursor;
    } while (auditCursor);
    expect(auditIds).toHaveLength(205);
    expect(new Set(auditIds)).toHaveLength(205);

    for (let index = 0; index < 101; index += 1) {
      const id = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      database.support.set(id, {
        id,
        user_key: `user-${index}`,
        reply_email: null,
        category: "other",
        subject: `Support ${index}`,
        body: "A sufficiently long support request body.",
        status: "open",
        revision: 1,
        created_at: now,
        updated_at: now,
      });
    }
    const firstSupportPage = await ADMIN_SUPPORT_LIST(
      adminRequest("/api/admin/support?limit=100"),
    );
    const firstSupport = await json<{
      requests: SupportRow[];
      nextCursor: string | null;
    }>(firstSupportPage);
    expect(firstSupport.requests).toHaveLength(100);
    expect(firstSupport.nextCursor).not.toBeNull();
    const secondSupportPage = await ADMIN_SUPPORT_LIST(
      adminRequest(
        `/api/admin/support?limit=100&cursor=${encodeURIComponent(String(firstSupport.nextCursor))}`,
      ),
    );
    const secondSupport = await json<{ requests: SupportRow[] }>(secondSupportPage);
    expect(secondSupport.requests).toHaveLength(1);
  });

  it("creates privacy-safe learner support requests, rate limits abuse, and audits status changes", async () => {
    const anonymous = await SUPPORT_CREATE(
      new Request("https://paretto.test/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "technical",
          subject: "Cannot hear audio",
          body: "Audio does not play during my lesson.",
        }),
      }),
    );
    expect(anonymous.status).toBe(401);

    const created = await SUPPORT_CREATE(
      learnerRequest({
        category: "technical",
        subject: "Cannot hear audio",
        body: "Audio does not play during my lesson.",
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await json<{ request: { id: string } }>(created);
    const stored = database.support.get(createdBody.request.id);
    expect(stored?.reply_email).toBeNull();
    expect(stored?.user_key).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.user_key).not.toContain("learner@paretto.test");

    const explicitReply = await SUPPORT_CREATE(
      learnerRequest({
        replyEmail: "REPLY@example.test",
        category: "content",
        subject: "French example question",
        body: "The example translation may need another look.",
      }, "second-learner@paretto.test"),
    );
    expect(explicitReply.status).toBe(201);
    const explicitBody = await json<{ request: { id: string } }>(explicitReply);
    expect(database.support.get(explicitBody.request.id)?.reply_email).toBe(
      "reply@example.test",
    );

    const listing = await ADMIN_SUPPORT_LIST(
      adminRequest("/api/admin/support?status=open"),
    );
    const listingText = await listing.text();
    expect(listing.status).toBe(200);
    expect(listingText).not.toContain("user_key");
    expect(listingText).not.toContain(stored?.user_key ?? "never");

    const supportAuditCount = database.audits.length;
    const originalSupport = database.support.get(createdBody.request.id);
    database.beforeSupportStatusUpdate = () => {
      const row = database.support.get(createdBody.request.id);
      if (row) {
        database.support.set(row.id, {
          ...row,
          status: "resolved",
          revision: row.revision + 1,
          updated_at: row.updated_at + 1,
        });
      }
    };
    const lostSupportRace = await ADMIN_SUPPORT_UPDATE(
      adminRequest(`/api/admin/support/${createdBody.request.id}`, {
        method: "PUT",
        body: JSON.stringify({ revision: 1, status: "resolved" }),
      }),
      { params: Promise.resolve({ id: createdBody.request.id }) },
    );
    expect(lostSupportRace.status).toBe(409);
    expect(database.audits).toHaveLength(supportAuditCount);
    if (originalSupport) database.support.set(originalSupport.id, originalSupport);

    const statusUpdate = await ADMIN_SUPPORT_UPDATE(
      adminRequest(`/api/admin/support/${createdBody.request.id}`, {
        method: "PUT",
        body: JSON.stringify({ revision: 1, status: "resolved" }),
      }),
      { params: Promise.resolve({ id: createdBody.request.id }) },
    );
    expect(statusUpdate.status).toBe(200);
    expect(await json(statusUpdate)).toMatchObject({
      request: { status: "resolved", revision: 2 },
    });
    expect(database.audits.at(-1)).toMatchObject({
      entity_type: "support_request",
      action: "SUPPORT_STATUS_CHANGED",
      actor_email: ADMIN_EMAIL,
    });

    for (let index = 0; index < 4; index += 1) {
      const response = await SUPPORT_CREATE(
        learnerRequest({
          category: "feedback",
          subject: `Feedback number ${index}`,
          body: "This is a sufficiently long feedback message.",
        }),
      );
      expect(response.status).toBe(201);
    }
    const limited = await SUPPORT_CREATE(
      learnerRequest({
        category: "feedback",
        subject: "One request too many",
        body: "This request should be blocked by the rolling limit.",
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
  });

  it("serves a compiled-curriculum fallback instead of failing when D1 is unavailable", async () => {
    setCloudflareEnv({
      DB: {
        prepare() {
          throw new Error("D1 unavailable");
        },
      },
      ADMIN_EMAILS: ADMIN_EMAIL,
      USER_KEY_SECRET: "test-user-key-secret-with-more-than-thirty-two-characters",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await CURRICULUM_GET(
      new Request("https://paretto.test/api/curriculum"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=15");
    expect(await json(response)).toEqual({
      schemaVersion: 1,
      source: "compiled-fallback",
      revision: "compiled-v1",
      records: [],
    });
  });
});
