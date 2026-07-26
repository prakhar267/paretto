import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/verify-d1-export-restore.mjs");
const temporaryDirectories: string[] = [];

describe("portable D1 export restore verification", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("imports and verifies an intact contiguous migration export", async () => {
    const exportPath = await writeExport(false);
    const result = runVerifier(exportPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      export: "export.sql",
      integrity: "ok",
      foreignKeys: "ok",
      appliedMigrations: 1,
      newestMigration: "0000_confused_stephen_strange",
      applicationTables: 1,
    });
  });

  it("rejects a non-contiguous or unknown migration history", async () => {
    const exportPath = await writeExport(true);
    const result = runVerifier(exportPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "migration history is not a contiguous release prefix",
    );
  });

  it("emits pure JSON through the silent npm invocation used by deployment", async () => {
    const exportPath = await writeExport(false);
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();
    if (!npmCli) throw new Error("npm_execpath is unavailable.");

    const result = spawnSync(
      process.execPath,
      [
        npmCli,
        "run",
        "--silent",
        "d1:export:verify",
        "--",
        exportPath,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      integrity: "ok",
      foreignKeys: "ok",
      newestMigration: "0000_confused_stephen_strange",
    });
  });
});

async function writeExport(unknownMigration: boolean): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "paretto-export-test-"));
  temporaryDirectories.push(directory);
  const exportPath = join(directory, "export.sql");
  const migrationName = unknownMigration
    ? "0001_not_the_checked_in_migration"
    : "0000_confused_stephen_strange";
  await writeFile(
    exportPath,
    [
      "PRAGMA foreign_keys=OFF;",
      "BEGIN TRANSACTION;",
      "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
      `INSERT INTO d1_migrations VALUES (1, '${migrationName}', '2026-07-25 00:00:00');`,
      "CREATE TABLE learning_state (user_key TEXT PRIMARY KEY NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);",
      "INSERT INTO learning_state VALUES ('opaque-test', 1, '{\"version\":1}', 1);",
      "COMMIT;",
      "",
    ].join("\n"),
    "utf8",
  );
  return exportPath;
}

function runVerifier(exportPath: string) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", SCRIPT, exportPath],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}
