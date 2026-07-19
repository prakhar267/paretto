const createLearningStateSql = `
  CREATE TABLE IF NOT EXISTS learning_state (
    user_key TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

let localSchemaReady: Promise<void> | null = null;

export async function getD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the d1 field in .openai/hosting.json to DB.",
    );
  }
  return bindings.DB;
}

export async function getDatabase(): Promise<D1Database> {
  const database = await getD1();
  if (process.env.NODE_ENV === "development") {
    localSchemaReady ??= database
      .prepare(createLearningStateSql)
      .run()
      .then(() => undefined)
      .catch((error) => {
        localSchemaReady = null;
        throw error;
      });
    await localSchemaReady;
  }
  return database;
}
