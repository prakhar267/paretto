import { describe, expect, it } from "vitest";

import { compiledCurriculumDrafts } from "../app/compiled-curriculum-seed";
import { validateContentCreate } from "../app/api/_lib/content-validation";
import { vocabularyPublicId } from "../app/curriculum-identity";
import { REGIONS, WORDS } from "../app/learning-data";
import {
  activeCurriculumLesson,
  curriculumStatusLabel,
} from "../app/ParettoApp";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE,
  DEFAULT_COURSE_ID,
  PUBLISHED_COURSE_IDS,
} from "../app/course-catalog";

describe("CMS curriculum hardening", () => {
  it("publishes one stable French course while exposing language and taxonomy metadata", () => {
    expect(PUBLISHED_COURSE_IDS).toEqual([DEFAULT_COURSE_ID]);
    expect(DEFAULT_COURSE).toMatchObject({
      id: "french-from-english",
      sourceLocale: "en",
      targetLocale: "fr-FR",
      initialContextId: "ile-de-france",
      audio: { locale: "fr-FR", assetPrefix: "/audio/fr" },
      taxonomy: {
        contextKey: "region",
        contextIdField: "regionId",
      },
    });
    expect(Object.keys(COURSE_CATALOG)).toEqual([DEFAULT_COURSE_ID]);
  });

  it("defaults legacy CMS create requests to French and rejects unknown courses", () => {
    const base = compiledCurriculumDrafts("ile-de-france")[0];
    const { courseId, ...legacyBody } = base;
    expect(courseId).toBe(DEFAULT_COURSE_ID);
    expect(validateContentCreate(legacyBody)).toMatchObject({
      ok: true,
      value: { courseId: DEFAULT_COURSE_ID },
    });
    expect(
      validateContentCreate({ ...base, courseId: "unpublished-course" }),
    ).toMatchObject({ ok: false });
  });

  it("builds a complete, valid and draft-only seed plan through the normal create contract", () => {
    const allDrafts = REGIONS.flatMap((region) =>
      compiledCurriculumDrafts(region.id),
    );

    expect(allDrafts).toHaveLength(324);
    expect(
      new Set(allDrafts.map((draft) => `${draft.kind}:${draft.slug}`)).size,
    ).toBe(allDrafts.length);

    for (const draft of allDrafts) {
      const result = validateContentCreate(draft);
      expect(result, `${draft.kind}:${draft.slug}`).toMatchObject({ ok: true });
      expect(draft).not.toHaveProperty("status");
      expect(draft).not.toHaveProperty("reviewStatus");
    }
  });

  it("accepts every CEFR band and open-ended lesson numbers", () => {
    const base = compiledCurriculumDrafts("ile-de-france").find(
      (draft) => draft.kind === "vocabulary",
    );
    expect(base).toBeDefined();

    for (const cefr of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
      const result = validateContentCreate({
        ...base,
        slug: `level-${cefr.toLowerCase()}-card`,
        content: { ...base!.content, cefr, lesson: 24 },
      });
      expect(result, cefr).toMatchObject({
        ok: true,
        value: { content: { cefr, lesson: 24 } },
      });
    }
  });

  it("rejects unknown CEFR values and unsafe lesson numbers", () => {
    const base = compiledCurriculumDrafts("ile-de-france")[0];
    expect(
      validateContentCreate({
        ...base,
        content: { ...base.content, cefr: "D1" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateContentCreate({
        ...base,
        content: { ...base.content, lesson: 0 },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateContentCreate({
        ...base,
        content: { ...base.content, lesson: 1.5 },
      }),
    ).toMatchObject({ ok: false });
  });

  it("selects later CMS lesson positions without a three-lesson assumption", () => {
    const futureWord = {
      ...WORDS[0],
      id: "cms-future-fluency",
      cefr: "C2" as const,
      lesson: 24,
      topic: "advanced fluency",
    };
    expect(
      activeCurriculumLesson(
        { wordProgress: {} },
        futureWord.regionId,
        [futureWord],
      ),
    ).toBe(24);
  });

  it("keeps a CMS learner identity independent from later editorial slugs", () => {
    expect(vocabularyPublicId("bonjour-equipe")).toBe("cms-bonjour-equipe");
    expect(vocabularyPublicId("bonjour-equipe")).not.toBe(
      vocabularyPublicId("bonjour-equipe-revu"),
    );
  });

  it("reports the exact curriculum source without claiming an empty CMS is synced", () => {
    expect(curriculumStatusLabel("compiled", 0)).toBe(
      "Built-in curriculum · no published CMS updates",
    );
    expect(curriculumStatusLabel("compiled-fallback", 0)).toBe(
      "Built-in curriculum · CMS temporarily unavailable",
    );
    expect(curriculumStatusLabel("cms", 2)).toBe(
      "Built-in curriculum + 2 published CMS updates",
    );
  });
});
