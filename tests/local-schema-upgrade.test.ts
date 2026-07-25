import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_COURSE_ID } from "../app/course-catalog";
import { initializeLocalSchema } from "../db";

type SqliteBinding = string | number | bigint | null | Uint8Array;

class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    return {
      results: this.sqlite
        .prepare(this.sql)
        .all(...this.bindings()) as T[],
      success: true,
      meta: {},
    };
  }

  async run() {
    const result = this.sqlite
      .prepare(this.sql)
      .run(...this.bindings());
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  private bindings() {
    return this.values as SqliteBinding[];
  }
}

describe("persistent local D1 upgrades", () => {
  let database: SqliteD1 | null = null;

  afterEach(() => {
    database?.sqlite.close();
    database = null;
  });

  it("course-scopes populated pre-0011 CMS tables without losing data", async () => {
    database = new SqliteD1();
    database.sqlite.exec(`
      CREATE TABLE cms_content (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER,
        review_status TEXT NOT NULL DEFAULT 'draft',
        reviewed_by_email TEXT,
        reviewed_at INTEGER,
        approved_revision INTEGER,
        created_by_email TEXT NOT NULL,
        updated_by_email TEXT NOT NULL
      );
      CREATE UNIQUE INDEX cms_content_kind_slug_unique
        ON cms_content (kind, slug);
      CREATE UNIQUE INDEX cms_content_kind_stable_key_unique
        ON cms_content (kind, stable_key);
      CREATE INDEX cms_content_status_updated_idx
        ON cms_content (status, updated_at);

      CREATE TABLE cms_content_revisions (
        content_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        published_at INTEGER,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (content_id, revision)
      );
      CREATE INDEX cms_content_revisions_created_idx
        ON cms_content_revisions (content_id, created_at);

      CREATE TABLE cms_slug_tombstones (
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        content_id TEXT NOT NULL,
        retired_at INTEGER NOT NULL,
        retired_by_email TEXT NOT NULL,
        PRIMARY KEY (kind, slug)
      );
      CREATE INDEX cms_slug_tombstones_content_idx
        ON cms_slug_tombstones (content_id);

      CREATE TABLE cms_vocabulary_aliases (
        alias TEXT PRIMARY KEY NOT NULL,
        content_id TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX cms_vocabulary_aliases_content_idx
        ON cms_vocabulary_aliases (content_id);
      CREATE INDEX cms_vocabulary_aliases_stable_idx
        ON cms_vocabulary_aliases (stable_key);

      CREATE TABLE native_learning_state (
        account_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO cms_content VALUES (
        'word-1', 'vocabulary', 'bonjour', 'word-1', 'Bonjour',
        '{"id":"word-1"}', 'published', 3, 100, 200, 200, 'approved',
        'reviewer@paretto.test', 190, 3, 'author@paretto.test',
        'author@paretto.test'
      );
      INSERT INTO cms_content_revisions VALUES (
        'word-1', 3, 'vocabulary', 'bonjour', 'word-1', 'Bonjour',
        '{"id":"word-1"}', 'published', 200, 'author@paretto.test',
        'PUBLISH', 200
      );
      INSERT INTO cms_slug_tombstones VALUES (
        'vocabulary', 'salut-old', 'word-1', 'word-1', 180,
        'author@paretto.test'
      );
      INSERT INTO cms_vocabulary_aliases VALUES (
        'salut', 'word-1', 'word-1', 100
      );
      INSERT INTO native_learning_state VALUES (
        'native-1', 4, '{"version":1}', 220
      );
    `);

    await initializeLocalSchema(
      database as unknown as D1Database,
    );

    for (const table of [
      "cms_content",
      "cms_content_revisions",
      "cms_slug_tombstones",
      "cms_vocabulary_aliases",
    ]) {
      const columns = database.sqlite
        .prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<{ name: string }>;
      expect(columns.map(({ name }) => name)).toContain("course_id");
    }

    const content = database.sqlite
      .prepare(
        "SELECT course_id, stable_key, revision FROM cms_content WHERE id = ?",
      )
      .get("word-1") as Record<string, unknown>;
    const revision = database.sqlite
      .prepare(
        `SELECT course_id, action FROM cms_content_revisions
         WHERE content_id = ? AND revision = ?`,
      )
      .get("word-1", 3) as Record<string, unknown>;
    const tombstone = database.sqlite
      .prepare(
        `SELECT course_id, stable_key FROM cms_slug_tombstones
         WHERE slug = ?`,
      )
      .get("salut-old") as Record<string, unknown>;
    const alias = database.sqlite
      .prepare(
        `SELECT course_id, stable_key FROM cms_vocabulary_aliases
         WHERE alias = ?`,
      )
      .get("salut") as Record<string, unknown>;

    expect(content).toMatchObject({
      course_id: DEFAULT_COURSE_ID,
      stable_key: "word-1",
      revision: 3,
    });
    expect(revision).toMatchObject({
      course_id: DEFAULT_COURSE_ID,
      action: "PUBLISH",
    });
    expect(tombstone).toMatchObject({
      course_id: DEFAULT_COURSE_ID,
      stable_key: "word-1",
    });
    expect(alias).toMatchObject({
      course_id: DEFAULT_COURSE_ID,
      stable_key: "word-1",
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT revision, reset_generation, payload
           FROM native_learning_state WHERE account_id = ?`,
        )
        .get("native-1"),
    ).toEqual({
      revision: 4,
      reset_generation: 0,
      payload: '{"version":1}',
    });

    await expect(
      initializeLocalSchema(database as unknown as D1Database),
    ).resolves.toBeUndefined();
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM cms_content")
        .get(),
    ).toEqual({ count: 1 });
  });
});
