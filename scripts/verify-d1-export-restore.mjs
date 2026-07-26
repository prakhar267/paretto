#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const exportArgument = process.argv[2];
invariant(
  exportArgument && process.argv.length === 3,
  "Usage: verify-d1-export-restore.mjs <D1 export.sql>",
);
const exportPath = resolve(root, exportArgument);
const metadata = await stat(exportPath);
invariant(
  metadata.isFile() && metadata.size > 0,
  "The D1 export must be a non-empty regular file.",
);

const journal = JSON.parse(
  await readFile(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
);
invariant(
  journal.dialect === "sqlite" &&
    Array.isArray(journal.entries) &&
    journal.entries.length > 0,
  "The checked-in D1 migration journal is invalid.",
);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "paretto-d1-export-restore-"),
);
const restoredPath = join(temporaryDirectory, "restored.sqlite");
const expectedPath = join(temporaryDirectory, "expected.sqlite");
let restored;
let expected;

try {
  await importSqlExport(exportPath, restoredPath);
  restored = new DatabaseSync(restoredPath);
  restored.exec("PRAGMA foreign_keys = ON;");
  verifyIntegrity(restored, "Restored D1 export");

  const migrationTable = restored
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name = 'd1_migrations'`,
    )
    .get();
  invariant(
    migrationTable,
    "The D1 export is missing its d1_migrations history.",
  );
  const applied = restored
    .prepare("SELECT id, name FROM d1_migrations ORDER BY id ASC")
    .all()
    .map((row) => ({
      id: Number(row.id),
      tag: normalizeMigrationName(row.name),
    }));
  invariant(applied.length > 0, "The D1 export has no applied migrations.");
  invariant(
    applied.length <= journal.entries.length,
    "The D1 export contains migrations newer than this release.",
  );
  for (let index = 0; index < applied.length; index += 1) {
    const expectedEntry = journal.entries[index];
    invariant(
      Number.isSafeInteger(applied[index].id) &&
        applied[index].id >= 1 &&
        (index === 0 || applied[index].id > applied[index - 1].id),
      "The D1 export migration IDs are invalid or reordered.",
    );
    invariant(
      applied[index].tag === expectedEntry.tag,
      `The D1 export migration history is not a contiguous release prefix at ${expectedEntry.tag}.`,
    );
  }

  expected = new DatabaseSync(expectedPath);
  expected.exec("PRAGMA foreign_keys = ON;");
  for (const entry of journal.entries.slice(0, applied.length)) {
    expected.exec(
      await readFile(
        resolve(root, "drizzle", `${entry.tag}.sql`),
        "utf8",
      ),
    );
  }
  verifyIntegrity(expected, "Expected migration prefix");

  const expectedTables = applicationSchemaNames(expected, "table");
  const actualTables = applicationSchemaNames(restored, "table");
  const expectedIndexes = applicationSchemaNames(expected, "index");
  const actualIndexes = applicationSchemaNames(restored, "index");
  compareRequiredSchema("table", expectedTables, actualTables);
  compareRequiredSchema("index", expectedIndexes, actualIndexes);

  console.log(
    JSON.stringify({
      export: basename(exportPath),
      bytes: metadata.size,
      integrity: "ok",
      foreignKeys: "ok",
      appliedMigrations: applied.length,
      newestMigration: applied.at(-1).tag,
      applicationTables: expectedTables.length,
      applicationIndexes: expectedIndexes.length,
    }),
  );
} finally {
  restored?.close();
  expected?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function importSqlExport(sourcePath, databasePath) {
  await new Promise((resolveImport, rejectImport) => {
    const process = spawn("sqlite3", [databasePath], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const source = createReadStream(sourcePath);
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      finish(
        new Error("Timed out while restoring the D1 export into SQLite."),
      );
    }, 10 * 60 * 1000);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      source.destroy();
      if (error) rejectImport(error);
      else resolveImport();
    };
    process.on("error", (error) => {
      finish(
        error.code === "ENOENT"
          ? new Error(
              "sqlite3 is required to perform the D1 export restore rehearsal.",
            )
          : error,
      );
    });
    source.on("error", finish);
    process.stderr.on("data", (chunk) => {
      if (stderr.length < 8_192) stderr += String(chunk).slice(0, 8_192);
    });
    process.on("close", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `D1 export restore failed (${signal ?? `exit ${code}`}): ` +
              `${stderr.trim().slice(0, 8_192) || "sqlite3 returned no diagnostic."}`,
          ),
        );
      }
    });
    source.pipe(process.stdin);
  });
}

function verifyIntegrity(database, label) {
  const integrityRows = database.prepare("PRAGMA integrity_check;").all();
  invariant(
    integrityRows.length === 1 &&
      Object.values(integrityRows[0])[0] === "ok",
    `${label} failed SQLite integrity_check.`,
  );
  invariant(
    database.prepare("PRAGMA foreign_key_check;").all().length === 0,
    `${label} contains a foreign-key violation.`,
  );
}

function normalizeMigrationName(value) {
  invariant(
    typeof value === "string",
    "The D1 export contains an invalid migration name.",
  );
  return value.endsWith(".sql") ? value.slice(0, -4) : value;
}

function applicationSchemaNames(database, type) {
  return database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = ?
         AND name NOT LIKE 'sqlite_%'
         AND name != 'd1_migrations'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    )
    .all(type)
    .map((row) => String(row.name));
}

function compareRequiredSchema(kind, required, actual) {
  const requiredNames = new Set(required);
  const actualNames = new Set(actual);
  const missing = required.filter((name) => !actualNames.has(name));
  const unexpected = actual.filter((name) => !requiredNames.has(name));
  invariant(
    missing.length === 0 && unexpected.length === 0,
    `Restored D1 export ${kind} drift: missing [${missing.join(", ")}], ` +
      `unexpected [${unexpected.join(", ")}].`,
  );
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
