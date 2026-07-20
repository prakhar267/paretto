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
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "pas-a-pas-migration-replay-"),
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
    database.exec(migration);
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

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
