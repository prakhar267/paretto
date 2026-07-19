import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const learningState = sqliteTable("learning_state", {
  userKey: text("user_key").primaryKey(),
  revision: integer("revision").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
