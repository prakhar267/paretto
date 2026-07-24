"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WORDS, type Word } from "@/app/learning-data";

import {
  CONTENT_KINDS,
  SUPPORT_STATUSES,
  type AdminAuditRecord,
  type AnalyticsSummary,
  type CmsContentRecord,
  type CmsContentRevision,
  type CmsContentSummary,
  type ContentKind,
  type ContentReviewStatus,
  type LegalHoldRecord,
  type OperationsSummary,
  type SupportRequestRecord,
  type SupportStatus,
} from "./admin-types";
import styles from "./admin.module.css";

type Tab = "content" | "support" | "analytics" | "operations" | "audit";

type Editor = {
  id: string | null;
  kind: ContentKind;
  slug: string;
  stableKey: string | null;
  publicId: string | null;
  title: string;
  revision: number | null;
  status: "draft" | "published";
  reviewStatus: ContentReviewStatus;
  reviewedByEmail: string | null;
  approvedRevision: number | null;
  authorEmail: string | null;
  packagedAudioReady: boolean | null;
  contentText: string;
};

const CONTENT_TEMPLATES: Record<ContentKind, object> = {
  vocabulary: {
    french: "",
    english: "",
    ipa: "",
    partOfSpeech: "noun",
    gender: "masculine",
    regionId: "ile-de-france",
    exampleFr: "",
    exampleEn: "",
    cefr: "A1",
    lesson: 1,
    topic: "city landmarks",
    emoji: "✨",
    sensitive: false,
    tags: ["editorial"],
  },
  lesson: {
    summary: "",
    regionId: "ile-de-france",
    cefr: "A1",
    lesson: 1,
    topic: "city landmarks",
    sensitive: false,
    introduction: "",
    estimatedMinutes: 5,
    vocabularyIds: [],
    blocks: [{ type: "text", content: "" }],
  },
};

export default function AdminConsole({ adminEmail }: { adminEmail: string }) {
  const [tab, setTab] = useState<Tab>("content");
  const [entries, setEntries] = useState<CmsContentSummary[]>([]);
  const [contentRevisions, setContentRevisions] = useState<CmsContentRevision[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportRequestRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminAuditRecord[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [operations, setOperations] = useState<OperationsSummary | null>(null);
  const [legalHolds, setLegalHolds] = useState<LegalHoldRecord[]>([]);
  const [legalHoldCursor, setLegalHoldCursor] = useState<string | null>(null);
  const [legalHoldLoadingMore, setLegalHoldLoadingMore] = useState(false);
  const [holdDataClass, setHoldDataClass] = useState<LegalHoldRecord["dataClass"]>("product_events");
  const [holdRecordKey, setHoldRecordKey] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [releaseTargetId, setReleaseTargetId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [editor, setEditor] = useState<Editor>(() => emptyEditor("vocabulary"));
  const [catalogQuery, setCatalogQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadEntries = useCallback(async () => {
    setEntries(await fetchAllContentEntries());
  }, []);

  const loadAudit = useCallback(async () => {
    const result = await apiRequest<{
      events: AdminAuditRecord[];
      nextCursor: string | null;
    }>(
      "/api/admin/audit?limit=100",
    );
    setAuditEvents(result.events);
    setAuditCursor(result.nextCursor);
  }, []);

  const loadOperations = useCallback(async () => {
    const [summary, holds] = await Promise.all([
      apiRequest<OperationsSummary>("/api/admin/operations"),
      apiRequest<{
        holds: LegalHoldRecord[];
        nextCursor: string | null;
      }>("/api/admin/legal-holds?limit=100"),
    ]);
    setOperations(summary);
    setLegalHolds(holds.holds);
    setLegalHoldCursor(holds.nextCursor);
  }, []);

  useEffect(() => {
    let active = true;
    let operation: Promise<void>;
    if (tab === "content") {
      operation = fetchAllContentEntries().then((result) => {
        if (active) setEntries(result);
      });
    } else if (tab === "support") {
      operation = fetchAllSupportRequests().then((result) => {
        if (active) setSupportRequests(result);
      });
    } else if (tab === "analytics") {
      operation = apiRequest<AnalyticsSummary>("/api/admin/analytics?days=30").then(
        (result) => {
          if (active) setAnalytics(result);
        },
      );
    } else if (tab === "operations") {
      operation = Promise.all([
        apiRequest<OperationsSummary>("/api/admin/operations"),
        apiRequest<{
          holds: LegalHoldRecord[];
          nextCursor: string | null;
        }>("/api/admin/legal-holds?limit=100"),
      ]).then(([summary, holds]) => {
        if (active) {
          setOperations(summary);
          setLegalHolds(holds.holds);
          setLegalHoldCursor(holds.nextCursor);
        }
      });
    } else {
      operation = apiRequest<{
        events: AdminAuditRecord[];
        nextCursor: string | null;
      }>(
        "/api/admin/audit?limit=100",
      ).then((result) => {
        if (active) {
          setAuditEvents(result.events);
          setAuditCursor(result.nextCursor);
        }
      });
    }
    operation
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab]);

  function selectTab(nextTab: Tab) {
    if (nextTab === tab) return;
    setLoading(true);
    setError("");
    setMessage("");
    setTab(nextTab);
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign-out could not be completed.");
      window.location.assign("/admin/login");
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  const counts = useMemo(
    () => ({
      drafts: entries.filter((entry) => entry.status === "draft").length,
      published: entries.filter((entry) => entry.status === "published").length,
      openSupport: supportRequests.filter(
        (request) => request.status === "open" || request.status === "in_progress",
      ).length,
    }),
    [entries, supportRequests],
  );
  const catalogWords = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase();
    return WORDS.filter((word) =>
      !query || `${word.id} ${word.french} ${word.english}`.toLocaleLowerCase().includes(query),
    ).slice(0, 60);
  }, [catalogQuery]);

  async function selectEntry(id: string) {
    setBusy(true);
    setError("");
    try {
      const [{ entry }, revisions] = await Promise.all([
        apiRequest<{ entry: CmsContentRecord }>(
          `/api/admin/content/${encodeURIComponent(id)}`,
        ),
        fetchAllContentRevisions(id),
      ]);
      setEditor({
        id: entry.id,
        kind: entry.kind,
        slug: entry.slug,
        stableKey: entry.stableKey,
        publicId: entry.publicId,
        title: entry.title,
        revision: entry.revision,
        status: entry.status,
        reviewStatus: entry.reviewStatus,
        reviewedByEmail: entry.reviewedByEmail,
        approvedRevision: entry.approvedRevision,
        authorEmail: entry.updatedByEmail,
        packagedAudioReady: entry.packagedAudioReady,
        contentText: JSON.stringify(entry.content, null, 2),
      });
      setContentRevisions(revisions);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function startNew(kind: ContentKind) {
    setEditor(emptyEditor(kind));
    setContentRevisions([]);
    setError("");
    setMessage("");
  }

  function startOverride(word: Word) {
    setEditor({
      id: null,
      kind: "vocabulary",
      slug: word.id,
      stableKey: null,
      publicId: word.id,
      title: `${word.french} — ${word.english}`,
      revision: null,
      status: "draft",
      reviewStatus: "draft",
      reviewedByEmail: null,
      approvedRevision: null,
      authorEmail: null,
      packagedAudioReady: true,
      contentText: JSON.stringify(
        {
          french: word.french,
          english: word.english,
          ipa: word.ipa,
          partOfSpeech: word.partOfSpeech,
          gender: word.gender,
          regionId: word.regionId,
          exampleFr: word.exampleFr,
          exampleEn: word.exampleEn,
          cefr: word.cefr,
          lesson: word.lesson,
          topic: word.topic,
          emoji: word.emoji,
          sensitive: false,
          tags: [word.topic],
        },
        null,
        2,
      ),
    });
    setContentRevisions([]);
    setError("");
    setMessage("Compiled card loaded as a new CMS override. Review and save it as a draft.");
  }

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let content: unknown;
      try {
        content = JSON.parse(editor.contentText) as unknown;
      } catch {
        throw new Error("Content JSON is not valid JSON.");
      }

      const endpoint = editor.id
        ? `/api/admin/content/${encodeURIComponent(editor.id)}`
        : "/api/admin/content";
      const body = editor.id
        ? {
            revision: editor.revision,
            slug: editor.slug,
            title: editor.title,
            content,
          }
        : { kind: editor.kind, slug: editor.slug, title: editor.title, content };
      const { entry } = await apiRequest<{ entry: CmsContentRecord }>(endpoint, {
        method: editor.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditor({
        id: entry.id,
        kind: entry.kind,
        slug: entry.slug,
        stableKey: entry.stableKey,
        publicId: entry.publicId,
        title: entry.title,
        revision: entry.revision,
        status: entry.status,
        reviewStatus: entry.reviewStatus,
        reviewedByEmail: entry.reviewedByEmail,
        approvedRevision: entry.approvedRevision,
        authorEmail: entry.updatedByEmail,
        packagedAudioReady: entry.packagedAudioReady,
        contentText: JSON.stringify(entry.content, null, 2),
      });
      await loadEntries();
      setContentRevisions(await fetchAllContentRevisions(entry.id));
      setMessage(editor.id ? "Changes saved." : "Draft created.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changePublication(action: "publish" | "unpublish") {
    if (!editor.id || !editor.revision) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { entry } = await apiRequest<{ entry: CmsContentRecord }>(
        `/api/admin/content/${encodeURIComponent(editor.id)}/publication`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: editor.revision, action }),
        },
      );
      setEditor((current) => ({
        ...current,
        revision: entry.revision,
        status: entry.status,
        reviewStatus: entry.reviewStatus,
        reviewedByEmail: entry.reviewedByEmail,
        approvedRevision: entry.approvedRevision,
      }));
      const [, , revisions] = await Promise.all([
        loadEntries(),
        loadAudit(),
        fetchAllContentRevisions(entry.id),
      ]);
      setContentRevisions(revisions);
      setMessage(action === "publish" ? "Published to the curriculum." : "Returned to draft.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeReview(
    action: "submit" | "approve" | "request_changes",
  ) {
    if (!editor.id || !editor.revision) return;
    const note =
      action === "request_changes"
        ? window.prompt("Describe the required editorial changes:")
        : null;
    if (action === "request_changes" && !note) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { entry } = await apiRequest<{ entry: CmsContentRecord }>(
        `/api/admin/content/${encodeURIComponent(editor.id)}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: editor.revision, action, note }),
        },
      );
      setEditor((current) => ({
        ...current,
        reviewStatus: entry.reviewStatus,
        reviewedByEmail: entry.reviewedByEmail,
        approvedRevision: entry.approvedRevision,
        packagedAudioReady: entry.packagedAudioReady,
      }));
      await Promise.all([loadEntries(), loadAudit()]);
      setMessage(
        action === "submit"
          ? "Current revision submitted for independent review."
          : action === "approve"
            ? "Current revision approved for publication."
            : "Changes requested from the author.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreAudit() {
    if (!auditCursor || auditLoadingMore) return;
    setAuditLoadingMore(true);
    setError("");
    try {
      const page = await apiRequest<{
        events: AdminAuditRecord[];
        nextCursor: string | null;
      }>(`/api/admin/audit?limit=100&cursor=${encodeURIComponent(auditCursor)}`);
      setAuditEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !known.has(event.id))];
      });
      setAuditCursor(page.nextCursor);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setAuditLoadingMore(false);
    }
  }

  async function loadMoreLegalHolds() {
    if (!legalHoldCursor || legalHoldLoadingMore) return;
    setLegalHoldLoadingMore(true);
    setError("");
    try {
      const page = await apiRequest<{
        holds: LegalHoldRecord[];
        nextCursor: string | null;
      }>(
        `/api/admin/legal-holds?limit=100&cursor=${encodeURIComponent(legalHoldCursor)}`,
      );
      setLegalHolds((current) => {
        const known = new Set(current.map((hold) => hold.id));
        return [...current, ...page.holds.filter((hold) => !known.has(hold.id))];
      });
      setLegalHoldCursor(page.nextCursor);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLegalHoldLoadingMore(false);
    }
  }

  async function deleteEntry() {
    if (!editor.id || !editor.revision) return;
    if (!window.confirm(`Delete “${editor.title}”? The audit history will remain.`)) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/admin/content/${encodeURIComponent(editor.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: editor.revision }),
      });
      setEditor(emptyEditor("vocabulary"));
      setContentRevisions([]);
      await Promise.all([loadEntries(), loadAudit()]);
      setMessage("Content deleted.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function restoreRevision(sourceRevision: number) {
    if (!editor.id || !editor.revision || editor.status !== "draft") return;
    if (
      !window.confirm(
        `Restore revision ${sourceRevision} as a new draft revision? The current revision remains in history.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { entry } = await apiRequest<{ entry: CmsContentRecord }>(
        `/api/admin/content/${encodeURIComponent(editor.id)}/revisions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision: editor.revision,
            sourceRevision,
          }),
        },
      );
      setEditor({
        id: entry.id,
        kind: entry.kind,
        slug: entry.slug,
        stableKey: entry.stableKey,
        publicId: entry.publicId,
        title: entry.title,
        revision: entry.revision,
        status: entry.status,
        reviewStatus: entry.reviewStatus,
        reviewedByEmail: entry.reviewedByEmail,
        approvedRevision: entry.approvedRevision,
        authorEmail: entry.updatedByEmail,
        packagedAudioReady: entry.packagedAudioReady,
        contentText: JSON.stringify(entry.content, null, 2),
      });
      const [, , revisions] = await Promise.all([
        loadEntries(),
        loadAudit(),
        fetchAllContentRevisions(entry.id),
      ]);
      setContentRevisions(revisions);
      setMessage(`Revision ${sourceRevision} restored as draft revision ${entry.revision}.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeSupportStatus(
    request: SupportRequestRecord,
    status: SupportStatus,
  ) {
    if (status === request.status) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ request: SupportRequestRecord }>(
        `/api/admin/support/${encodeURIComponent(request.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: request.revision, status }),
        },
      );
      setSupportRequests((current) =>
        current.map((item) => (item.id === request.id ? result.request : item)),
      );
      setMessage("Support status updated.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runRetention() {
    if (!window.confirm("Permanently delete records beyond the published retention periods?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<{ deleted: { productEvents: number; supportRequests: number; auditEvents: number } }>(
        "/api/admin/operations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: "delete-expired-records" }),
        },
      );
      await Promise.all([loadOperations(), loadAudit()]);
      const total = result.deleted.productEvents + result.deleted.supportRequests + result.deleted.auditEvents;
      setMessage(`Retention maintenance completed. ${total} expired record${total === 1 ? "" : "s"} deleted.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createLegalHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdRecordKey.trim() && !window.confirm("Create a class-wide hold that pauses deletion for every record in this data class?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest<{ hold: LegalHoldRecord }>("/api/admin/legal-holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataClass: holdDataClass,
          recordKey: holdRecordKey.trim() || null,
          reason: holdReason,
        }),
      });
      setHoldRecordKey("");
      setHoldReason("");
      await Promise.all([loadOperations(), loadAudit()]);
      setMessage("Legal hold created and recorded in the audit log.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function releaseLegalHold(id: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/admin/legal-holds/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: "release-legal-hold",
          releaseReason,
        }),
      });
      setReleaseTargetId(null);
      setReleaseReason("");
      await Promise.all([loadOperations(), loadAudit()]);
      setMessage("Legal hold released and recorded in the audit log.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Loquivo</p>
          <h1>Curriculum studio</h1>
          <p className={styles.subtitle}>
            Review French curriculum, publish safely, and respond to learner needs.
          </p>
        </div>
        <div className={styles.identity}>
          <span>Signed in as</span>
          <strong>{adminEmail}</strong>
          <Link href="/">Open learner app</Link>
          <button
            className={styles.signOutButton}
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.metrics} aria-label="Studio overview">
        <article><strong>{counts.drafts}</strong><span>Drafts</span></article>
        <article><strong>{counts.published}</strong><span>Published</span></article>
        <article><strong>{counts.openSupport}</strong><span>Support in queue</span></article>
      </section>

      <nav className={styles.tabs} aria-label="Administration sections">
        {(["content", "support", "analytics", "operations", "audit"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? styles.activeTab : undefined}
            aria-current={tab === item ? "page" : undefined}
            onClick={() => selectTab(item)}
          >
            {item === "content" ? "Curriculum" : item === "support" ? "Support" : item === "analytics" ? "Analytics" : item === "operations" ? "Operations" : "Audit log"}
          </button>
        ))}
      </nav>

      {(message || error) && (
        <div
          className={error ? styles.errorBanner : styles.successBanner}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </div>
      )}

      {loading ? (
        <div className={styles.loading} role="status">Loading studio data…</div>
      ) : tab === "content" ? (
        <section className={styles.workspace}>
          <aside className={styles.library}>
            <div className={styles.libraryHeader}>
              <div><p className={styles.kicker}>Library</p><h2>Curriculum</h2></div>
              <div className={styles.newButtons}>
                {CONTENT_KINDS.map((kind) => (
                  <button key={kind} type="button" onClick={() => startNew(kind)}>
                    + {kind === "vocabulary" ? "Word" : "Lesson"}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.entryList}>
              {entries.length === 0 ? (
                <p className={styles.empty}>No CMS content yet. Create the first draft.</p>
              ) : (
                entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={editor.id === entry.id ? styles.selectedEntry : styles.entry}
                    onClick={() => void selectEntry(entry.id)}
                  >
                    <span>
                      <b>{entry.title}</b>
                      <small>
                        {entry.kind} · rev {entry.revision} · {entry.reviewStatus.replace("_", " ")}
                      </small>
                    </span>
                    <em data-status={entry.status}>{entry.status}</em>
                  </button>
                ))
              )}
            </div>
            <div className={styles.catalog}>
              <div>
                <p className={styles.kicker}>Compiled foundation</p>
                <h3>{WORDS.length} live cards</h3>
              </div>
              <label>
                <span className={styles.visuallyHidden}>Search compiled curriculum</span>
                <input
                  type="search"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search ID, French, or English"
                />
              </label>
              <div className={styles.catalogList}>
                {catalogWords.map((word) => (
                  <button type="button" key={word.id} onClick={() => startOverride(word)}>
                    <span><b lang="fr">{word.french}</b><small>{word.id}</small></span>
                    <em>{word.cefr} · L{word.lesson}</em>
                  </button>
                ))}
              </div>
              {catalogWords.length === 60 && <small>Showing the first 60 matches. Refine your search for a specific card.</small>}
            </div>
          </aside>

          <form className={styles.editor} onSubmit={saveEntry}>
            <div className={styles.editorHeader}>
              <div>
                <p className={styles.kicker}>{editor.id ? `Revision ${editor.revision}` : "New draft"}</p>
                <h2>{editor.id ? editor.title || "Untitled" : `New ${editor.kind}`}</h2>
              </div>
              <span className={styles.status} data-status={editor.status}>{editor.status}</span>
            </div>

            {editor.id && (
              <section className={styles.workflowCard} aria-label="Editorial workflow">
                <div>
                  <p className={styles.kicker}>Immutable learner identity</p>
                  <strong>{editor.publicId}</strong>
                  <small>
                    Stable key {editor.stableKey}. Slug changes do not change learner progress.
                  </small>
                </div>
                <div>
                  <p className={styles.kicker}>Independent review</p>
                  <strong>{editor.reviewStatus.replace("_", " ")}</strong>
                  <small>
                    {editor.reviewedByEmail
                      ? `Reviewed by ${editor.reviewedByEmail}${editor.approvedRevision ? ` for revision ${editor.approvedRevision}` : ""}.`
                      : `Current author: ${editor.authorEmail ?? "unknown"}. A different administrator must approve.`}
                  </small>
                </div>
                {editor.kind === "vocabulary" && (
                  <div>
                    <p className={styles.kicker}>Production audio</p>
                    <strong>{editor.packagedAudioReady ? "Packaged and matched" : "Not ready"}</strong>
                    <small>
                      Approval requires a manifest asset whose transcript matches the French text.
                    </small>
                  </div>
                )}
              </section>
            )}

            <div className={styles.fieldGrid}>
              <label>
                Type
                <select
                  value={editor.kind}
                  disabled={Boolean(editor.id)}
                  onChange={(event) => setEditor(emptyEditor(event.target.value as ContentKind))}
                >
                  {CONTENT_KINDS.map((kind) => <option key={kind}>{kind}</option>)}
                </select>
              </label>
              <label>
                Slug
                <input
                  required
                  disabled={editor.status === "published"}
                  minLength={3}
                  maxLength={80}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={editor.slug}
                  onChange={(event) => setEditor((current) => ({ ...current, slug: event.target.value }))}
                  placeholder="paris-cafe-basics"
                />
              </label>
            </div>
            <label>
              Title
              <input
                required
                disabled={editor.status === "published"}
                minLength={2}
                maxLength={120}
                value={editor.title}
                onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))}
                placeholder="At the neighbourhood café"
              />
            </label>
            <label className={styles.contentField}>
              Validated content JSON
              <textarea
                required
                disabled={editor.status === "published"}
                spellCheck={false}
                value={editor.contentText}
                onChange={(event) => setEditor((current) => ({ ...current, contentText: event.target.value }))}
              />
              <small>
                {editor.status === "published"
                  ? "Unpublish this item before editing it."
                  : "Required metadata includes CEFR, lesson number, topic, sensitivity, and for vocabulary a compact emoji. Lessons must reference exactly five unique, metadata-aligned cards. Approval also verifies packaged audio. For vocabulary, use an existing compiled word ID as the initial slug to override it."}
              </small>
            </label>

            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={busy || editor.status === "published"}
              >
                {busy
                  ? "Working…"
                  : editor.status === "published"
                    ? "Unpublish to edit"
                    : editor.id
                      ? "Save revision"
                      : "Create draft"}
              </button>
              {editor.id &&
                editor.status === "draft" &&
                (editor.reviewStatus === "draft" ||
                  editor.reviewStatus === "changes_requested") && (
                <button type="button" disabled={busy} onClick={() => void changeReview("submit")}>
                  Submit for review
                </button>
              )}
              {editor.id &&
                editor.status === "draft" &&
                editor.reviewStatus === "pending" &&
                editor.authorEmail?.toLowerCase() !== adminEmail.toLowerCase() && (
                <>
                  <button type="button" disabled={busy} onClick={() => void changeReview("approve")}>
                    Approve revision
                  </button>
                  <button type="button" disabled={busy} onClick={() => void changeReview("request_changes")}>
                    Request changes
                  </button>
                </>
              )}
              {editor.id && editor.status === "draft" && editor.reviewStatus === "approved" && (
                <button type="button" disabled={busy} onClick={() => void changePublication("publish")}>
                  Publish approved revision
                </button>
              )}
              {editor.id && editor.status === "published" && (
                <button type="button" disabled={busy} onClick={() => void changePublication("unpublish")}>
                  Unpublish
                </button>
              )}
              {editor.id && editor.status === "draft" && (
                <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void deleteEntry()}>
                  Delete
                </button>
              )}
            </div>

            {editor.id &&
              editor.status === "draft" &&
              editor.reviewStatus === "pending" &&
              editor.authorEmail?.toLowerCase() === adminEmail.toLowerCase() && (
                <small className={styles.workflowHint}>
                  Waiting for another administrator. Authors cannot approve their own revision.
                </small>
              )}

            {editor.id && contentRevisions.length > 0 && (
              <section className={styles.revisionHistory} aria-labelledby="revision-history-title">
                <div>
                  <p className={styles.kicker}>Recoverable history</p>
                  <h3 id="revision-history-title">Revision snapshots</h3>
                </div>
                <p>
                  Every saved and publication state is immutable. Restoring creates a new
                  draft; it never erases later history.
                </p>
                <div className={styles.revisionList}>
                  {contentRevisions.map((revision) => (
                    <article key={revision.revision}>
                      <span>
                        <strong>Revision {revision.revision}</strong>
                        <small>{revision.action.toLowerCase()} · {formatDate(revision.createdAt)}</small>
                      </span>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          editor.status === "published" ||
                          revision.revision === editor.revision
                        }
                        onClick={() => void restoreRevision(revision.revision)}
                      >
                        {revision.revision === editor.revision ? "Current" : "Restore"}
                      </button>
                    </article>
                  ))}
                </div>
                {editor.status === "published" && (
                  <small>Unpublish this item before restoring an earlier revision.</small>
                )}
              </section>
            )}
          </form>
        </section>
      ) : tab === "support" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p className={styles.kicker}>Learner care</p><h2>Support queue</h2></div></div>
          {supportRequests.length === 0 ? (
            <p className={styles.empty}>There are no support requests in the queue.</p>
          ) : (
            <div className={styles.supportList}>
              {supportRequests.map((request) => (
                <article className={styles.supportCard} key={request.id}>
                  <div className={styles.supportMeta}>
                    <span>{request.category}</span>
                    <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time>
                  </div>
                  <h3>{request.subject}</h3>
                  <p className={styles.supportBody}>{request.body}</p>
                  {request.replyEmail && <p><b>Reply email:</b> <a href={`mailto:${request.replyEmail}`}>{request.replyEmail}</a></p>}
                  <label className={styles.statusControl}>
                    Status
                    <select
                      value={request.status}
                      disabled={busy}
                      onChange={(event) => void changeSupportStatus(request, event.target.value as SupportStatus)}
                    >
                      {SUPPORT_STATUSES.map((status) => (
                        <option key={status} value={status}>{status.replace("_", " ")}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : tab === "analytics" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.kicker}>Last 30 days</p><h2>Product health</h2></div>
            <span className={styles.privacyBadge}>Aggregate only</span>
          </div>
          {!analytics ? (
            <p className={styles.empty}>Analytics reporting is unavailable.</p>
          ) : (
            <div className={styles.analyticsPanel}>
              <div className={styles.analyticsMetrics} aria-label="Analytics overview">
                <article><strong>{analytics.totals.activeLearners}</strong><span>Opted-in learners</span></article>
                <article><strong>{analytics.totals.sessions}</strong><span>Sessions</span></article>
                <article><strong>{analytics.totals.events}</strong><span>Allowlisted events</span></article>
              </div>
              <p className={styles.privacyNote}>{analytics.privacy}</p>
              <div className={styles.analyticsGrid}>
                <section aria-labelledby="event-volume-title">
                  <h3 id="event-volume-title">Event volume</h3>
                  {analytics.byEvent.length === 0 ? <p className={styles.empty}>No opted-in events in this window.</p> : (
                    <div className={styles.eventList}>
                      {analytics.byEvent.map((event) => <div key={event.name}><span>{event.name.replaceAll("_", " ")}</span><strong>{event.events}</strong></div>)}
                    </div>
                  )}
                </section>
                <section aria-labelledby="daily-activity-title">
                  <h3 id="daily-activity-title">Daily activity</h3>
                  {analytics.daily.length === 0 ? <p className={styles.empty}>No daily activity yet.</p> : (
                    <div className={styles.eventList}>
                      {analytics.daily.slice(-14).map((day) => <div key={day.date}><span>{formatDate(day.date)}</span><strong>{day.activeLearners} learner{day.activeLearners === 1 ? "" : "s"} · {day.events} events</strong></div>)}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </section>
      ) : tab === "operations" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.kicker}>Release control</p><h2>Operations</h2></div>
            <a className={styles.healthLink} href="/api/health" target="_blank" rel="noreferrer">Open live health</a>
          </div>
          {!operations ? (
            <p className={styles.empty}>Operations status is unavailable.</p>
          ) : (
            <div className={styles.operationsPanel}>
              <div className={styles.readinessGrid}>
                {Object.entries(operations.configuration).map(([name, ready]) => (
                  <article key={name} data-ready={ready}>
                    <span aria-hidden="true">{ready ? "✓" : "!"}</span>
                    <div><strong>{name.replace(/([A-Z])/g, " $1")}</strong><small>{ready ? "Configured" : "Required before production"}</small></div>
                  </article>
                ))}
              </div>
              <div className={styles.operationsGrid}>
                <section><p className={styles.kicker}>Publishing</p><strong>{operations.content.published}</strong><span>published · {operations.content.drafts} drafts</span></section>
                <section><p className={styles.kicker}>Learner care</p><strong>{operations.support.open}</strong><span>open or in progress</span></section>
                <section><p className={styles.kicker}>Retention due</p><strong>{operations.retentionDue.productEvents + operations.retentionDue.supportRequests + operations.retentionDue.auditEvents}</strong><span>expired records</span></section>
                <section><p className={styles.kicker}>Legal holds</p><strong>{operations.activeLegalHolds}</strong><span>active deletion exclusions</span></section>
              </div>
              <section className={styles.retentionCard}>
                <div><h3>Retention maintenance</h3><p>Events older than 400 days and resolved support or audit records older than 730 days are eligible for permanent deletion. Each class is limited to {operations.retentionBatchLimit} records per run; active legal holds are always excluded.</p></div>
                <button type="button" disabled={busy} onClick={() => void runRetention()}>{busy ? "Working…" : "Delete expired records"}</button>
              </section>
              <section className={styles.legalHoldPanel} aria-labelledby="legal-holds-title">
                <div>
                  <p className={styles.kicker}>Controlled exception</p>
                  <h3 id="legal-holds-title">Legal holds</h3>
                  <p>Use a record, user, or entity key to narrow the hold. Leave the key blank only when counsel requires a class-wide hold.</p>
                </div>
                <form className={styles.legalHoldForm} onSubmit={(event) => void createLegalHold(event)}>
                  <label>
                    <span>Data class</span>
                    <select value={holdDataClass} onChange={(event) => setHoldDataClass(event.target.value as LegalHoldRecord["dataClass"])}>
                      <option value="product_events">Product events</option>
                      <option value="support_requests">Support requests</option>
                      <option value="admin_audit_log">Admin audit log</option>
                    </select>
                  </label>
                  <label>
                    <span>Record, user, or entity key <small>optional</small></span>
                    <input value={holdRecordKey} maxLength={128} onChange={(event) => setHoldRecordKey(event.target.value)} placeholder="Blank means the entire data class" />
                  </label>
                  <label className={styles.legalHoldReason}>
                    <span>Reason</span>
                    <textarea value={holdReason} minLength={10} maxLength={500} required onChange={(event) => setHoldReason(event.target.value)} />
                  </label>
                  <button type="submit" disabled={busy || holdReason.trim().length < 10}>Create audited hold</button>
                </form>
                <div className={styles.legalHoldList}>
                  {legalHolds.filter((hold) => hold.status === "active").length === 0 ? (
                    <p className={styles.empty}>No active legal holds.</p>
                  ) : legalHolds.filter((hold) => hold.status === "active").map((hold) => (
                    <article key={hold.id}>
                      <div><strong>{hold.dataClass.replaceAll("_", " ")}</strong><code>{hold.recordKey ?? "Entire data class"}</code></div>
                      <p>{hold.reason}</p>
                      <small>Created by {hold.createdByEmail} · {formatDate(hold.createdAt)}</small>
                      {releaseTargetId === hold.id ? (
                        <form onSubmit={(event) => { event.preventDefault(); void releaseLegalHold(hold.id); }}>
                          <label><span>Release reason</span><input value={releaseReason} minLength={10} maxLength={500} required onChange={(event) => setReleaseReason(event.target.value)} autoFocus /></label>
                          <div><button type="button" onClick={() => { setReleaseTargetId(null); setReleaseReason(""); }}>Cancel</button><button type="submit" disabled={busy || releaseReason.trim().length < 10}>Confirm release</button></div>
                        </form>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => setReleaseTargetId(hold.id)}>Release hold</button>
                      )}
                    </article>
                  ))}
                </div>
                {legalHoldCursor && (
                  <div className={styles.loadMoreRow}>
                    <button
                      type="button"
                      disabled={legalHoldLoadingMore}
                      onClick={() => void loadMoreLegalHolds()}
                    >
                      {legalHoldLoadingMore ? "Loading…" : "Load more legal holds"}
                    </button>
                  </div>
                )}
              </section>
              <p className={styles.checkedAt}>Last checked {formatDate(operations.checkedAt)}</p>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p className={styles.kicker}>Accountability</p><h2>Audit log</h2></div></div>
          {auditEvents.length === 0 ? (
            <p className={styles.empty}>No administrative changes have been recorded.</p>
          ) : (
            <div className={styles.auditList}>
              {auditEvents.map((event) => (
                <article key={event.id}>
                  <div><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.entityType.replace("_", " ")}</span></div>
                  <p>{event.actorEmail}</p>
                  <code>{event.entityId}</code>
                  <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                  <small>rev {event.fromRevision ?? "—"} → {event.toRevision ?? "—"}</small>
                </article>
              ))}
            </div>
          )}
          {auditCursor && (
            <div className={styles.loadMoreRow}>
              <button
                type="button"
                disabled={auditLoadingMore}
                onClick={() => void loadMoreAudit()}
              >
                {auditLoadingMore ? "Loading…" : "Load more audit events"}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function emptyEditor(kind: ContentKind): Editor {
  return {
    id: null,
    kind,
    slug: "",
    stableKey: null,
    publicId: null,
    title: "",
    revision: null,
    status: "draft",
    reviewStatus: "draft",
    reviewedByEmail: null,
    approvedRevision: null,
    authorEmail: null,
    packagedAudioReady: kind === "vocabulary" ? false : null,
    contentText: JSON.stringify(CONTENT_TEMPLATES[kind], null, 2),
  };
}

async function apiRequest<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The generic fallback below handles non-JSON infrastructure errors.
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

async function fetchAllContentEntries(): Promise<CmsContentSummary[]> {
  return fetchAllAdminPages<CmsContentSummary>(
    "/api/admin/content?limit=100",
    "entries",
  );
}

async function fetchAllSupportRequests(): Promise<SupportRequestRecord[]> {
  return fetchAllAdminPages<SupportRequestRecord>(
    "/api/admin/support?limit=100",
    "requests",
  );
}

async function fetchAllContentRevisions(
  contentId: string,
): Promise<CmsContentRevision[]> {
  const revisions: CmsContentRevision[] = [];
  const seenCursors = new Set<number>();
  let beforeRevision: number | null = null;

  do {
    const base = `/api/admin/content/${encodeURIComponent(contentId)}/revisions?limit=100`;
    const url: string = beforeRevision === null
      ? base
      : `${base}&beforeRevision=${beforeRevision}`;
    const page: {
      revisions: CmsContentRevision[];
      nextBeforeRevision: number | null;
    } = await apiRequest(url);
    revisions.push(...page.revisions);
    beforeRevision = page.nextBeforeRevision;
    if (beforeRevision !== null) {
      if (seenCursors.has(beforeRevision)) {
        throw new Error("Revision pagination did not advance.");
      }
      seenCursors.add(beforeRevision);
    }
  } while (beforeRevision !== null);

  return revisions;
}

async function fetchAllAdminPages<T>(
  firstUrl: string,
  collectionKey: "entries" | "requests",
): Promise<T[]> {
  const records: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const url: string = cursor
      ? `${firstUrl}&cursor=${encodeURIComponent(cursor)}`
      : firstUrl;
    const page: {
      entries?: T[];
      requests?: T[];
      nextCursor: string | null;
    } = await apiRequest(url);
    records.push(...(page[collectionKey] ?? []));
    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error("Administration pagination did not advance.");
      }
      seenCursors.add(cursor);
    }
  } while (cursor);

  return records;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Something went wrong. Please retry.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
