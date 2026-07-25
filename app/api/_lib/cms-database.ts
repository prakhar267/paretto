import type {
  AdminAuditRecord,
  CmsContentRevision,
  CmsContentRecord,
  CmsContentSummary,
  ContentKind,
  ContentReviewStatus,
  ContentStatus,
  SupportCategory,
  SupportRequestRecord,
  SupportStatus,
} from "@/app/admin/admin-types";
import { vocabularyPublicId } from "@/app/curriculum-identity";
import {
  hasCourseAudioAsset,
  isCourseAudioDistributionReady,
} from "@/app/audio/french-audio-manifest";
import {
  DEFAULT_COURSE_ID,
  isCourseId,
  type CourseId,
} from "@/app/course-catalog";
import { getDatabase } from "@/db";
import { isRecord } from "./api-utils";
import { parseStoredContent } from "./content-validation";

export type ContentRow = {
  id: string;
  course_id?: CourseId;
  kind: ContentKind;
  slug: string;
  stable_key: string;
  title: string;
  content: string;
  status: ContentStatus;
  revision: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  review_status: ContentReviewStatus;
  reviewed_by_email: string | null;
  reviewed_at: number | null;
  approved_revision: number | null;
  created_by_email: string;
  updated_by_email: string;
};

export type SupportRow = {
  id: string;
  reply_email: string | null;
  category: SupportCategory;
  subject: string;
  body: string;
  status: SupportStatus;
  revision: number;
  created_at: number;
  updated_at: number;
};

export type ContentRevisionRow = {
  course_id?: CourseId;
  content_id: string;
  revision: number;
  kind: ContentKind;
  slug: string;
  stable_key: string;
  title: string;
  content: string;
  status: ContentStatus;
  published_at: number | null;
  actor_email: string;
  action: CmsContentRevision["action"];
  created_at: number;
};

export type AuditRow = {
  id: number;
  entity_type: "content" | "support_request" | "operation" | "legal_hold";
  entity_id: string;
  actor_email: string;
  action: string;
  from_revision: number | null;
  to_revision: number | null;
  details: string;
  created_at: number;
};

export const CONTENT_COLUMNS = `
  id, course_id, kind, slug, stable_key, title, content, status, revision, created_at,
  updated_at, published_at, review_status, reviewed_by_email, reviewed_at,
  approved_revision, created_by_email, updated_by_email
`;

export const QUALIFIED_CONTENT_COLUMNS = `
  content.id, content.course_id, content.kind, content.slug, content.stable_key, content.title,
  content.content, content.status, content.revision, content.created_at,
  content.updated_at, content.published_at, content.review_status,
  content.reviewed_by_email, content.reviewed_at, content.approved_revision,
  content.created_by_email, content.updated_by_email
`;

export const REVISION_COLUMNS = `
  course_id, content_id, revision, kind, slug, stable_key, title, content, status,
  published_at, actor_email, action, created_at
`;

export function getCmsDatabase(): Promise<D1Database> {
  return getDatabase();
}

export function contentSummaryFromRow(row: ContentRow): CmsContentSummary {
  const courseId = rowCourseId(row.course_id);
  return {
    id: row.id,
    courseId,
    kind: row.kind,
    slug: row.slug,
    stableKey: row.stable_key,
    publicId:
      row.kind === "vocabulary"
        ? vocabularyPublicId(row.stable_key, courseId)
        : row.stable_key,
    title: row.title,
    status: row.status,
    reviewStatus: row.review_status,
    reviewedByEmail: row.reviewed_by_email,
    reviewedAt: row.reviewed_at === null ? null : timestamp(row.reviewed_at),
    approvedRevision: row.approved_revision,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    publishedAt: row.published_at === null ? null : timestamp(row.published_at),
    createdByEmail: row.created_by_email,
    updatedByEmail: row.updated_by_email,
  };
}

export function contentRecordFromRow(row: ContentRow): CmsContentRecord | null {
  const courseId = rowCourseId(row.course_id);
  const content = parseStoredContent(row.kind, row.content, courseId);
  if (!content) return null;
  return {
    ...contentSummaryFromRow(row),
    content,
    packagedAudioReady:
      row.kind === "vocabulary" && "french" in content
        ? isCourseAudioDistributionReady(courseId) &&
          hasCourseAudioAsset(
            courseId,
            vocabularyPublicId(row.stable_key, courseId),
            content.french,
          )
        : null,
  };
}

export function contentRevisionFromRow(
  row: ContentRevisionRow,
): CmsContentRevision | null {
  const courseId = rowCourseId(row.course_id);
  const content = parseStoredContent(row.kind, row.content, courseId);
  if (!content) return null;
  return {
    courseId,
    contentId: row.content_id,
    revision: row.revision,
    kind: row.kind,
    slug: row.slug,
    stableKey: row.stable_key,
    title: row.title,
    content,
    status: row.status,
    publishedAt: row.published_at === null ? null : timestamp(row.published_at),
    actorEmail: row.actor_email,
    action: row.action,
    createdAt: timestamp(row.created_at),
  };
}

function rowCourseId(value: unknown): CourseId {
  return isCourseId(value) ? value : DEFAULT_COURSE_ID;
}

export function supportRecordFromRow(row: SupportRow): SupportRequestRecord {
  return {
    id: row.id,
    replyEmail: row.reply_email,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export function auditRecordFromRow(row: AuditRow): AdminAuditRecord {
  let details: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.details) as unknown;
    if (isRecord(parsed)) details = parsed;
  } catch {
    // Historical audit rows remain readable even if details are malformed.
  }
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorEmail: row.actor_email,
    action: row.action,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    details,
    createdAt: timestamp(row.created_at),
  };
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}
