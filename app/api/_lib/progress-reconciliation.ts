import { vocabularyPublicId } from "@/app/curriculum-identity";
import type {
  LearningState,
  MasteryStage,
  WordProgress,
} from "@/app/learning-engine";

type VocabularyAliasRow = {
  alias: string;
  stable_key: string;
};

export async function reconcileProgressAliases(
  database: D1Database,
  state: LearningState,
): Promise<LearningState> {
  const candidates = [
    ...new Set(
      Object.keys(state.wordProgress).flatMap((id) => [
        id,
        id.startsWith("cms-") ? id.slice(4) : id,
      ]),
    ),
  ];
  if (candidates.length === 0) return state;

  const aliases: VocabularyAliasRow[] = [];
  for (let offset = 0; offset < candidates.length; offset += 90) {
    const page = candidates.slice(offset, offset + 90);
    const placeholders = page.map(() => "?").join(", ");
    const result = await database
      .prepare(
        `SELECT alias, stable_key FROM cms_vocabulary_aliases
         WHERE course_id = ? AND alias IN (${placeholders})`,
      )
      .bind(state.activeCourseId, ...page)
      .all<VocabularyAliasRow>();
    aliases.push(...result.results);
  }
  return reconcileWordProgressAliases(state, aliases);
}

export function reconcileWordProgressAliases(
  state: LearningState,
  aliases: readonly VocabularyAliasRow[],
): LearningState {
  const progress = { ...state.wordProgress };
  let changed = false;

  for (const { alias, stable_key: stableKey } of aliases) {
    const canonicalId = vocabularyPublicId(stableKey, state.activeCourseId);
    for (const historicalId of [alias, `cms-${alias}`]) {
      if (historicalId === canonicalId || !progress[historicalId]) continue;
      progress[canonicalId] = mergeProgress(
        progress[canonicalId],
        progress[historicalId],
      );
      delete progress[historicalId];
      changed = true;
    }
  }

  return changed ? { ...state, wordProgress: progress } : state;
}

function mergeProgress(
  current: WordProgress | undefined,
  historical: WordProgress,
): WordProgress {
  if (!current) return { ...historical };
  const latest =
    Date.parse(current.lastReviewedAt) >= Date.parse(historical.lastReviewedAt)
      ? current
      : historical;
  const correct = Math.max(current.correct, historical.correct);
  const incorrect = Math.max(current.incorrect, historical.incorrect);
  return {
    ...latest,
    stage: Math.max(current.stage, historical.stage) as MasteryStage,
    seen: Math.max(current.seen, historical.seen, correct + incorrect),
    correct,
    incorrect,
  };
}
