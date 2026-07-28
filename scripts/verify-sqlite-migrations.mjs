#!/usr/bin/env node

import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const drizzleDirectory = resolve(root, "drizzle");
const journalPath = resolve(drizzleDirectory, "meta/_journal.json");
const schemaPath = resolve(root, "db/schema.ts");
const healthPath = resolve(root, "app/api/health/route.ts");
const COURSE_SCOPE_MIGRATION_TAG = "0011_sour_post";
const RESET_AND_AUTH_LIMIT_MIGRATION_TAG =
  "0012_private_auth_reset_generation";
const LATEST_SCHEMA_MIGRATION_TAG = "0013_paretto_id_recovery";
const DEFAULT_COURSE_ID = "french-from-english";
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "paretto-migration-replay-"),
);
const databasePath = join(temporaryDirectory, "replay.sqlite");
let database;

try {
  const [journalSource, schemaSource, healthSource] = await Promise.all([
    readFile(journalPath, "utf8"),
    readFile(schemaPath, "utf8"),
    readFile(healthPath, "utf8"),
  ]);
  const journal = JSON.parse(journalSource);
  invariant(journal.dialect === "sqlite", "Migration journal must target SQLite/D1.");
  invariant(
    Array.isArray(journal.entries) && journal.entries.length > 0,
    "Migration journal is empty.",
  );

  const tags = new Set();
  for (const [position, entry] of journal.entries.entries()) {
    invariant(entry.idx === position, `Migration index ${entry.idx} is not contiguous.`);
    invariant(
      typeof entry.tag === "string" && /^\d{4}_[a-z0-9_]+$/.test(entry.tag),
      `Migration tag at index ${position} is unsafe.`,
    );
    invariant(!tags.has(entry.tag), `Duplicate migration tag: ${entry.tag}.`);
    tags.add(entry.tag);
  }

  const newestMigration = journal.entries.at(-1).tag;
  invariant(
    newestMigration === LATEST_SCHEMA_MIGRATION_TAG,
    `Latest migration is ${newestMigration}; expected ${LATEST_SCHEMA_MIGRATION_TAG}.`,
  );
  const schemaRevision = newestMigration.slice(0, 4);
  const healthRevision = healthSource.match(
    /const SCHEMA_REVISION = "(\d{4})";/,
  )?.[1];
  invariant(
    healthRevision === schemaRevision,
    `Health schema revision ${healthRevision ?? "missing"} does not match ${schemaRevision}.`,
  );

  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  for (const entry of journal.entries) {
    const migrationPath = resolve(drizzleDirectory, `${entry.tag}.sql`);
    const migration = await readFile(migrationPath, "utf8");
    invariant(migration.trim().length > 0, `Migration ${entry.tag} is empty.`);
    if (entry.tag === COURSE_SCOPE_MIGRATION_TAG) {
      seedCourseScopeMigrationFixtures(database);
    }
    if (entry.tag === RESET_AND_AUTH_LIMIT_MIGRATION_TAG) {
      seedResetAndAuthLimitMigrationFixtures(database);
    }
    database.exec(migration);
    if (entry.tag === COURSE_SCOPE_MIGRATION_TAG) {
      verifyCourseScopeMigrationFixtures(database);
    }
    if (entry.tag === RESET_AND_AUTH_LIMIT_MIGRATION_TAG) {
      verifyResetAndAuthLimitMigrationFixtures(database);
    }
    verifySingleValuePragma(
      database,
      "quick_check",
      `Migration ${entry.tag} failed SQLite quick_check.`,
    );
  }

  verifySingleValuePragma(
    database,
    "integrity_check",
    "Fresh migration replay failed SQLite integrity_check.",
  );
  invariant(
    database.prepare("PRAGMA foreign_key_check;").all().length === 0,
    "Fresh migration replay contains a foreign-key violation.",
  );
  invariant(
    readPragmaNumber(database, "foreign_keys") === 1,
    "The final migration leaves SQLite foreign-key enforcement disabled.",
  );

  const expectedTables = extractNames(schemaSource, /\bsqliteTable\(\s*["']([^"']+)["']/g);
  const expectedIndexes = extractNames(
    schemaSource,
    /\b(?:index|uniqueIndex)\(\s*["']([^"']+)["']\s*\)/g,
  );
  invariant(expectedTables.length > 0, "No tables were discovered in db/schema.ts.");
  invariant(expectedIndexes.length > 0, "No indexes were discovered in db/schema.ts.");

  const actualTables = schemaObjectNames(database, "table");
  const actualIndexes = schemaObjectNames(database, "index");
  compareNames("table", expectedTables, actualTables);
  compareNames("index", expectedIndexes, actualIndexes);

  console.log(
    `SQLite migration replay valid: ${journal.entries.length} migrations through ` +
      `${newestMigration}, ${actualTables.length} tables, ${actualIndexes.length} ` +
      "named indexes, integrity_check ok, and foreign keys enabled.",
  );
} finally {
  database?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function verifySingleValuePragma(database, pragma, message) {
  const rows = database.prepare(`PRAGMA ${pragma};`).all();
  invariant(
    rows.length === 1 && Object.values(rows[0])[0] === "ok",
    `${message} Result: ${JSON.stringify(rows)}.`,
  );
}

function readPragmaNumber(database, pragma) {
  const row = database.prepare(`PRAGMA ${pragma};`).get();
  return Number(Object.values(row ?? {})[0]);
}

function extractNames(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

function schemaObjectNames(database, type) {
  return database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = ? AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all(type)
    .map((row) => row.name);
}

function compareNames(kind, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));
  invariant(
    missing.length === 0 && unexpected.length === 0,
    `Migrated ${kind} drift: missing [${missing.join(", ")}], ` +
      `unexpected [${unexpected.join(", ")}].`,
  );
}

function seedCourseScopeMigrationFixtures(database) {
  database
    .prepare(
      `INSERT INTO cms_content (
         id, kind, slug, stable_key, title, content, status, revision,
         created_at, updated_at, published_at, review_status,
         reviewed_by_email, reviewed_at, approved_revision,
         created_by_email, updated_by_email
       ) VALUES (?, 'vocabulary', ?, ?, ?, '{}', 'draft', 2, 1, 2, NULL,
                 'approved', ?, 2, 2, ?, ?)`,
    )
    .run(
      "migration-fixture-content",
      "migration-fixture-current",
      "migration-fixture-stable",
      "Migration fixture",
      "reviewer@migration.test",
      "author@migration.test",
      "reviewer@migration.test",
    );
  database
    .prepare(
      `INSERT INTO cms_content_revisions (
         content_id, revision, kind, slug, stable_key, title, content, status,
         published_at, actor_email, action, created_at
       ) VALUES (?, 2, 'vocabulary', ?, ?, ?, '{}', 'draft', NULL, ?, 'UPDATE', 2)`,
    )
    .run(
      "migration-fixture-content",
      "migration-fixture-current",
      "migration-fixture-stable",
      "Migration fixture",
      "reviewer@migration.test",
    );
  database
    .prepare(
      `INSERT INTO cms_slug_tombstones (
         kind, slug, stable_key, content_id, retired_at, retired_by_email
       ) VALUES ('vocabulary', ?, ?, ?, 2, ?)`,
    )
    .run(
      "migration-fixture-retired",
      "migration-fixture-stable",
      "migration-fixture-content",
      "reviewer@migration.test",
    );
  database
    .prepare(
      `INSERT INTO cms_vocabulary_aliases (
         alias, content_id, stable_key, created_at
       ) VALUES (?, ?, ?, 2)`,
    )
    .run(
      "migration-fixture-retired",
      "migration-fixture-content",
      "migration-fixture-stable",
    );
}

function verifyCourseScopeMigrationFixtures(database) {
  const expectations = [
    ["cms_content", "id", "migration-fixture-content"],
    ["cms_content_revisions", "content_id", "migration-fixture-content"],
    ["cms_slug_tombstones", "slug", "migration-fixture-retired"],
    ["cms_vocabulary_aliases", "alias", "migration-fixture-retired"],
  ];
  for (const [table, key, value] of expectations) {
    const row = database
      .prepare(
        `SELECT course_id, stable_key FROM "${table}" WHERE "${key}" = ?`,
      )
      .get(value);
    invariant(
      row?.course_id === DEFAULT_COURSE_ID &&
        row?.stable_key === "migration-fixture-stable",
      `${COURSE_SCOPE_MIGRATION_TAG} did not preserve ${table} in the default course.`,
    );
  }
}

function seedResetAndAuthLimitMigrationFixtures(database) {
  database
    .prepare(
      `INSERT INTO learner_rate_limit (
         id, key, count, last_request
       ) VALUES (?, ?, 3, 100)`,
    )
    .run(
      "legacy-rate-fixture",
      "203.0.113.42|/api/auth/sign-in/email",
    );
  database
    .prepare(
      `INSERT INTO native_learning_state (
         account_id, revision, payload, updated_at
       ) VALUES (?, 4, ?, 200)`,
    )
    .run("native-reset-fixture", '{"version":1}');
}

function verifyResetAndAuthLimitMigrationFixtures(database) {
  const legacyTable = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name = 'learner_rate_limit'`,
    )
    .get();
  invariant(
    legacyTable === undefined,
    `${RESET_AND_AUTH_LIMIT_MIGRATION_TAG} retained the raw-key limiter table.`,
  );

  const native = database
    .prepare(
      `SELECT revision, reset_generation, payload
       FROM native_learning_state WHERE account_id = ?`,
    )
    .get("native-reset-fixture");
  invariant(
    native?.revision === 4 &&
      native?.reset_generation === 0 &&
      native?.payload === '{"version":1}',
    `${RESET_AND_AUTH_LIMIT_MIGRATION_TAG} did not preserve native progress.`,
  );

  const authLimiterColumns = database
    .prepare("PRAGMA table_info(learner_auth_rate_limits)")
    .all()
    .map((column) => column.name)
    .sort();
  invariant(
    JSON.stringify(authLimiterColumns) ===
      JSON.stringify([
        "bucket_hash",
        "last_request_at",
        "request_count",
        "updated_at",
      ]),
    `${RESET_AND_AUTH_LIMIT_MIGRATION_TAG} created an unsafe auth limiter schema.`,
  );

  let rejectedZeroGeneration = false;
  try {
    database
      .prepare(
        `INSERT INTO learner_progress_generations (
           user_key, generation, updated_at
         ) VALUES ('generation-fixture', 0, 300)`,
      )
      .run();
  } catch {
    rejectedZeroGeneration = true;
  }
  invariant(
    rejectedZeroGeneration,
    `${RESET_AND_AUTH_LIMIT_MIGRATION_TAG} accepts an invalid reset generation.`,
  );
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
