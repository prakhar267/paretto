import {
  CEFR_LEVELS,
  type CefrLevel,
} from "../curriculum-metadata";
import type { CourseId } from "../course-catalog";

export { CEFR_LEVELS };
export type { CefrLevel };

export const CONTENT_KINDS = ["vocabulary", "lesson"] as const;
export const CONTENT_STATUSES = ["draft", "published"] as const;
export const CONTENT_REVIEW_STATUSES = [
  "draft",
  "pending",
  "approved",
  "changes_requested",
] as const;
export const SUPPORT_CATEGORIES = [
  "billing",
  "technical",
  "content",
  "feedback",
  "privacy",
  "other",
] as const;
export const SUPPORT_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type ContentReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export type VocabularyContent = {
  french: string;
  english: string;
  ipa: string;
  partOfSpeech:
    | "noun"
    | "verb"
    | "pronominal verb"
    | "adjective"
    | "adverb"
    | "phrase";
  gender: "masculine" | "feminine" | null;
  regionId: string;
  exampleFr: string;
  exampleEn: string;
  cefr: CefrLevel;
  lesson: number;
  topic: string;
  emoji: string;
  sensitive: boolean;
  tags: string[];
};

export type LessonBlock = {
  type: "text" | "tip" | "exercise";
  content: string;
};

export type LessonContent = {
  summary: string;
  regionId: string;
  cefr: CefrLevel;
  lesson: number;
  topic: string;
  sensitive: boolean;
  introduction: string;
  estimatedMinutes: number;
  vocabularyIds: string[];
  blocks: LessonBlock[];
};

export type CmsContentPayload = VocabularyContent | LessonContent;

export type CmsContentSummary = {
  id: string;
  courseId: CourseId;
  kind: ContentKind;
  slug: string;
  stableKey: string;
  publicId: string;
  title: string;
  status: ContentStatus;
  reviewStatus: ContentReviewStatus;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  approvedRevision: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdByEmail: string;
  updatedByEmail: string;
};

export type CmsContentRecord = CmsContentSummary & {
  content: CmsContentPayload;
  packagedAudioReady: boolean | null;
};

export type CmsContentRevision = {
  courseId: CourseId;
  contentId: string;
  revision: number;
  kind: ContentKind;
  slug: string;
  stableKey: string;
  title: string;
  content: CmsContentPayload;
  status: ContentStatus;
  publishedAt: string | null;
  actorEmail: string;
  action: "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "RESTORE" | "MIGRATION";
  createdAt: string;
};

export type SupportRequestRecord = {
  id: string;
  replyEmail: string | null;
  category: SupportCategory;
  subject: string;
  body: string;
  status: SupportStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminAuditRecord = {
  id: number;
  entityType: "content" | "support_request" | "operation" | "legal_hold";
  entityId: string;
  actorEmail: string;
  action: string;
  fromRevision: number | null;
  toRevision: number | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AnalyticsSummary = {
  window: { days: number; from: string; to: string };
  totals: { events: number; activeLearners: number; sessions: number };
  byEvent: Array<{ name: string; events: number }>;
  daily: Array<{ date: string; activeLearners: number; events: number }>;
  privacy: string;
};

export type OperationsSummary = {
  checkedAt: string;
  service: { status: "ready"; healthPath: string };
  configuration: {
    database: boolean;
    userKeySecret: boolean;
    supportRateLimitSecret: boolean;
    learnerAuthRateLimitSecret: boolean;
    learnerAuthentication: boolean;
    learnerAuthOrigin: boolean;
    learnerEmailAccountCreation: boolean;
    learnerEmailVerification: boolean;
    learnerPasswordReset: boolean;
    learnerGoogleAuth: boolean;
    learnerAppleAuth: boolean;
    supportNotifications: boolean;
    adminAllowlist: boolean;
    appleClientId: boolean;
    appleServerCredentials: boolean;
    appleTokenEncryptionSecret: boolean;
    nativeSessionSecret: boolean;
  };
  content: { published: number; drafts: number };
  support: { open: number };
  retentionDue: {
    productEvents: number;
    supportRequests: number;
    auditEvents: number;
    adminLoginAttempts: number;
    learnerSessions: number;
    learnerVerifications: number;
    learnerAuthRateLimits: number;
    supportRateLimits: number;
  };
  activeLegalHolds: number;
  accountDeletionQueue: {
    pending: number;
    held: number;
    withErrors: number;
    oldestUpdatedAt: string | null;
  };
  supportNotificationQueue: {
    pending: number;
    failed: number;
    oldestCreatedAt: string | null;
  };
  retentionBatchLimit: number;
};

export type LegalHoldRecord = {
  id: string;
  dataClass: "product_events" | "support_requests" | "admin_audit_log";
  recordKey: string | null;
  reason: string;
  status: "active" | "released";
  createdByEmail: string;
  createdAt: string;
  releasedByEmail: string | null;
  releasedAt: string | null;
};
