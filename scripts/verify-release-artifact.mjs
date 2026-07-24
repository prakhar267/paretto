#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const sourceHostingPath = resolve(root, ".openai/hosting.json");
const builtHostingPath = resolve(dist, ".openai/hosting.json");
const sourceDrizzle = resolve(root, "drizzle");
const builtDrizzle = resolve(dist, ".openai/drizzle");
const siteCreatorPlaceholderDatabaseId =
  "00000000-0000-4000-8000-000000000000";

await Promise.all([
  requireFile(resolve(dist, "server/index.js")),
  requireFile(resolve(dist, "server/ssr/index.js")),
  requireFile(resolve(dist, "server/wrangler.json")),
  requireFile(resolve(dist, "client/manifest.webmanifest")),
  requireFile(resolve(dist, "client/service-worker.js")),
  requireFile(resolve(dist, "client/offline.html")),
  requireFile(resolve(dist, "client/apple-touch-icon.png")),
  requireFile(resolve(dist, "client/audio/fr/manifest.json")),
  requireFile(builtHostingPath),
]);

const [
  sourceHostingText,
  builtHostingText,
  wranglerText,
  workerBundleText,
  webManifestText,
  staticHeadersText,
] =
  await Promise.all([
    readFile(sourceHostingPath, "utf8"),
    readFile(builtHostingPath, "utf8"),
    readFile(resolve(dist, "server/wrangler.json"), "utf8"),
    readFile(resolve(dist, "server/index.js"), "utf8"),
    readFile(resolve(dist, "client/manifest.webmanifest"), "utf8"),
    readFile(resolve(dist, "client/_headers"), "utf8"),
  ]);

invariant(
  sourceHostingText === builtHostingText,
  "The packaged Sites hosting manifest differs from the validated source manifest.",
);

const hosting = JSON.parse(sourceHostingText);
const allowedHostingKeys = new Set(["project_id", "d1", "r2"]);
const unexpectedHostingKeys = Object.keys(hosting).filter(
  (key) => !allowedHostingKeys.has(key),
);
invariant(
  unexpectedHostingKeys.length === 0,
  `Unexpected Sites hosting keys: ${unexpectedHostingKeys.join(", ")}.`,
);
invariant(
  hosting.project_id === undefined ||
    (typeof hosting.project_id === "string" && hosting.project_id.length > 0),
  "Sites project_id must be a non-empty string when present.",
);
invariant(
  hosting.d1 === null || hosting.d1 === undefined || typeof hosting.d1 === "string",
  "Sites d1 must be a binding name or null.",
);
invariant(
  hosting.r2 === null || hosting.r2 === undefined || typeof hosting.r2 === "string",
  "Sites r2 must be a binding name or null.",
);

const wrangler = JSON.parse(wranglerText);
for (const artifact of [wranglerText, workerBundleText]) {
  invariant(
    !artifact.includes("local-only-loquivo-user-key-secret-never-deploy"),
    "The local-only learner identity key must never enter a release artifact.",
  );
}
invariant(wrangler.main === "index.js", "The Worker entry point must be index.js.");
invariant(
  wrangler.observability?.enabled === true,
  "Worker observability must remain enabled.",
);
invariant(
  Array.isArray(wrangler.triggers?.crons) &&
    wrangler.triggers.crons.includes("17 3 * * *"),
  "The daily 03:17 UTC retention trigger is missing from the Worker artifact.",
);
invariant(
  wrangler.assets?.directory === "../client" &&
    wrangler.assets?.binding === "ASSETS",
  "The Worker artifact must expose built static files through the ASSETS binding.",
);
invariant(
  wrangler.images === undefined,
  "The unused Cloudflare Images binding must not be present.",
);
let d1Binding;
if (hosting.d1) {
  d1Binding = wrangler.d1_databases?.find(
    (binding) => binding.binding === hosting.d1,
  );
  invariant(
    d1Binding &&
      typeof d1Binding.database_id === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        d1Binding.database_id,
      ),
    `The Worker artifact is missing the ${hosting.d1} D1 binding.`,
  );
  invariant(
    d1Binding.migrations_dir === "../../drizzle",
    "The Worker artifact must point D1 migration tooling at checked-in drizzle/.",
  );
}
if (hosting.r2) {
  invariant(
    Array.isArray(wrangler.r2_buckets) &&
      wrangler.r2_buckets.some((binding) => binding.binding === hosting.r2),
    `The Worker artifact is missing the ${hosting.r2} R2 binding.`,
  );
}

const webManifest = JSON.parse(webManifestText);
invariant(webManifest.start_url === "/", "The web manifest start URL must remain root-relative.");
invariant(Array.isArray(webManifest.icons) && webManifest.icons.length >= 2, "The web manifest needs install icons.");
await Promise.all(
  webManifest.icons.map((icon) => {
    invariant(typeof icon.src === "string" && icon.src.startsWith("/"), "Manifest icon paths must be root-relative.");
    return requireFile(resolve(dist, "client", icon.src.slice(1)));
  }),
);
invariant(
  /\/service-worker\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/.test(
    staticHeadersText,
  ) && /Service-Worker-Allowed: \//.test(staticHeadersText),
  "The built service worker is missing no-cache or root-scope headers.",
);

const sourceMigrationFiles = await relativeFiles(sourceDrizzle);
const builtMigrationFiles = await relativeFiles(builtDrizzle);
invariant(
  JSON.stringify(builtMigrationFiles) === JSON.stringify(sourceMigrationFiles),
  "The packaged migration file set differs from drizzle/.",
);
await Promise.all(
  sourceMigrationFiles.map(async (path) => {
    const [source, built] = await Promise.all([
      readFile(join(sourceDrizzle, path)),
      readFile(join(builtDrizzle, path)),
    ]);
    invariant(
      sha256(source) === sha256(built),
      `Packaged migration content differs for ${path}.`,
    );
  }),
);

const journal = JSON.parse(
  await readFile(resolve(sourceDrizzle, "meta/_journal.json"), "utf8"),
);
invariant(journal.dialect === "sqlite", "The migration journal must target SQLite/D1.");
invariant(Array.isArray(journal.entries) && journal.entries.length > 0, "The migration journal is empty.");
for (const [position, entry] of journal.entries.entries()) {
  invariant(entry.idx === position, `Migration journal index ${entry.idx} is not contiguous.`);
  invariant(
    sourceMigrationFiles.includes(`${entry.tag}.sql`),
    `Migration ${entry.tag}.sql is missing from the source tree.`,
  );
  invariant(
    sourceMigrationFiles.includes(
      `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`,
    ),
    `Schema snapshot ${String(entry.idx).padStart(4, "0")}_snapshot.json is missing.`,
  );
}
const journalTags = new Set(journal.entries.map((entry) => `${entry.tag}.sql`));
const unjournaledSql = sourceMigrationFiles.filter(
  (path) => path.endsWith(".sql") && !journalTags.has(path),
);
invariant(
  unjournaledSql.length === 0,
  `Unjournaled migration files: ${unjournaledSql.join(", ")}.`,
);

const [sourceAudioManifest, builtAudioManifest] = await Promise.all([
  readFile(resolve(root, "public/audio/fr/manifest.json")),
  readFile(resolve(dist, "client/audio/fr/manifest.json")),
]);
invariant(
  sha256(sourceAudioManifest) === sha256(builtAudioManifest),
  "The packaged audio manifest differs from the verified source manifest.",
);

const newestMigration = journal.entries.at(-1).tag;
const d1Summary = hosting.d1
  ? `${hosting.d1}${
      d1Binding.database_id === siteCreatorPlaceholderDatabaseId
        ? " (local placeholder ID)"
        : ""
    }`
  : "not configured";
console.log(
  `Release artifact verified: Worker entry, web app assets, Sites metadata, ` +
    `${journal.entries.length} migrations through ${newestMigration}, ` +
    `D1 ${d1Summary}, and the 03:17 UTC Cron trigger.`,
);
if (d1Binding?.database_id === siteCreatorPlaceholderDatabaseId) {
  console.log(
    "The packaged D1 database ID is the expected local Sites placeholder; verify the provisioned database ID and binding on the deployed version before launch.",
  );
}
if (!hosting.project_id) {
  console.log(
    "Sites project_id is not assigned; use the separately verified direct-Cloudflare staging/production configuration while the Sites connector is unavailable.",
  );
}

async function relativeFiles(directory) {
  const files = [];
  await walk(directory, directory, files);
  return files.sort();
}

async function walk(base, directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(base, path, files);
    } else if (entry.isFile()) {
      files.push(relative(base, path).split("\\").join("/"));
    }
  }
}

async function requireFile(path) {
  await access(path);
  const metadata = await stat(path);
  invariant(metadata.isFile() && metadata.size > 0, `Required artifact file is empty: ${relative(root, path)}.`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
