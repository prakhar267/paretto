import { describe, expect, it } from "vitest";

import {
  CURRICULUM_PLAN,
  REGIONS,
  WORDS,
  type RegionId,
} from "../app/learning-data";

const LEGACY_WORD_IDS = [
  "idf-metro", "idf-musee", "idf-banlieue", "idf-se-depecher", "idf-anime",
  "hdf-braderie", "hdf-beffroi", "hdf-gaufre", "hdf-chaleureux", "hdf-accueillir",
  "nor-falaise", "nor-cidre", "nor-maree", "nor-brumeux", "nor-ferme",
  "bre-phare", "bre-crepe", "bre-sentier-cotier", "bre-naviguer", "bre-sale",
  "pdl-estuaire", "pdl-marais", "pdl-voile", "pdl-pecher", "pdl-paisible",
  "cvl-chateau", "cvl-jardin", "cvl-vallee", "cvl-royal", "cvl-admirer",
  "ges-marche-noel", "ges-cathedrale", "ges-cigogne", "ges-petillant", "ges-celebrer",
  "bfc-vignoble", "bfc-fromage", "bfc-tonneau", "bfc-deguster", "bfc-boise",
  "naq-dune", "naq-surf", "naq-huitre", "naq-vaste", "naq-recolter",
  "ara-volcan", "ara-sommet", "ara-neige", "ara-randonner", "ara-escarpe",
  "occ-place", "occ-canal", "occ-brique", "occ-ensoleille", "occ-flaner",
  "paca-calanque", "paca-lavande", "paca-petanque", "paca-provencal", "paca-se-baigner",
  "cor-ile", "cor-maquis", "cor-village-perche", "cor-sauvage", "cor-traverser",
  "gua-archipel", "gua-mangrove", "gua-colibri", "gua-creole", "gua-epice",
  "mar-yole", "mar-canne-sucre", "mar-jardin-tropical", "mar-ramer", "mar-fleuri",
  "guy-foret-tropicale", "guy-fleuve", "guy-centre-spatial", "guy-decoller", "guy-immense",
  "reu-cirque", "reu-piton", "reu-cascade", "reu-gravir", "reu-volcanique",
  "may-lagon", "may-tortue-marine", "may-barriere-corail", "may-pagayer", "may-preserve",
] as const;

function canonicalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("regional French curriculum", () => {
  it("contains three five-card lessons for every French region", () => {
    expect(REGIONS).toHaveLength(18);
    expect(WORDS).toHaveLength(270);

    for (const region of REGIONS) {
      const regionalWords = WORDS.filter((word) => word.regionId === region.id);
      expect(regionalWords, region.id).toHaveLength(15);

      for (const lesson of [1, 2, 3] as const) {
        expect(
          regionalWords.filter((word) => word.lesson === lesson),
          `${region.id} lesson ${lesson}`,
        ).toHaveLength(5);
      }
    }
  });

  it("keeps every original word ID stable", () => {
    const currentIds = new Set(WORDS.map((word) => word.id));
    for (const id of LEGACY_WORD_IDS) expect(currentIds.has(id), id).toBe(true);
  });

  it("uses the correct English spelling for the Hauts-de-France belfries", () => {
    const hautsDeFrance = REGIONS.find(
      (region) => region.id === "hauts-de-france",
    );

    expect(hautsDeFrance?.cultureNote).toContain("belfries");
    expect(hautsDeFrance?.cultureNote).not.toContain("beffries");
  });

  it("uses unique IDs and complete learner-facing fields", () => {
    const ids = WORDS.map((word) => word.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const word of WORDS) {
      expect(word.french.trim(), `${word.id} French`).not.toBe("");
      expect(word.english.trim(), `${word.id} English`).not.toBe("");
      expect(word.ipa, `${word.id} IPA`).toMatch(/^\/.+\/$/u);
      expect(word.exampleFr, `${word.id} French example`).toMatch(/^[A-ZÀ-ÖØ-Þ].*[.!?]$/u);
      expect(word.exampleEn, `${word.id} English example`).toMatch(/^[A-Z].*[.!?]$/u);
      expect(word.exampleFr.length, `${word.id} French example length`).toBeLessThanOrEqual(160);
      expect(word.exampleEn.length, `${word.id} English example length`).toBeLessThanOrEqual(160);
      expect(canonicalize(word.french), `${word.id} search form`).toContain(
        canonicalize(word.search),
      );

      if (word.partOfSpeech === "noun") {
        expect(word.gender, `${word.id} noun gender`).not.toBeNull();
      } else {
        expect(word.gender, `${word.id} non-noun gender`).toBeNull();
      }
    }
  });

  it("aligns every word's CEFR and topic metadata with its lesson plan", () => {
    expect(Object.keys(CURRICULUM_PLAN)).toHaveLength(REGIONS.length);

    for (const region of REGIONS) {
      const plan = CURRICULUM_PLAN[region.id as RegionId];
      expect(plan).toHaveLength(3);
      expect(plan.map((lesson) => lesson.lesson)).toEqual([1, 2, 3]);

      for (const word of WORDS.filter((entry) => entry.regionId === region.id)) {
        const lesson = plan[word.lesson - 1];
        expect(word.cefr, `${word.id} CEFR`).toBe(lesson.cefr);
        expect(word.topic, `${word.id} topic`).toBe(lesson.topic);
      }
    }
  });
});
