# Curriculum editorial standard

## Learning design

- Teach five items per session and introduce at most one unfamiliar grammar pattern at once.
- Sequence high-frequency, transferable French before regional enrichment vocabulary.
- Keep articles with countable nouns and identify grammatical gender.
- Use a consistent Metropolitan French IPA reference while acknowledging natural accents.
- Examples should be short, natural, self-contained, culturally respectful, and translatable
  without adding meaning absent from the French.
- Regional context must describe France's 18 administrative regions accurately without
  treating overseas regions as secondary or exotic curiosities.

## Required fields

Every published vocabulary item needs a stable ID, region, lesson position, CEFR band,
topic, French form, search form, English gloss, IPA, part of speech, gender where relevant,
emoji or supported visual marker, French example, English translation, editorial status,
and revision timestamp.

The content contract accepts every official CEFR band from A1 through C2 and
positive lesson positions up to 999. This is schema capacity, not a claim that
the current built-in A1–A2 course contains later-stage content. A qualified
editor must design and approve each added stage before publication.

## Editorial checks

1. French spelling, diacritics, punctuation, elision, article, and agreement.
2. IPA phonemes, liaison assumptions, and consistency with the displayed form.
3. English gloss precision and avoidance of misleading one-to-one claims.
4. Naturalness and level suitability of both example sentences.
5. Cultural claim accuracy, tone, and regional relevance.
6. Duplicate meaning, near-duplicate ID, or sequencing collision.
7. Pronunciation asset matches the exact displayed French form.
8. Two-person review for sensitive cultural, historical, political, or identity content.

AI-generated drafts must never bypass human editorial review before a public curriculum
publication. The CMS draft/publish boundary exists to enforce this requirement.

## Moving built-in content into the CMS

Admin → Curriculum can create one built-in region at a time as CMS drafts. The
workflow calls the normal content-create endpoint for every card and lesson, so
each record receives an immutable stable key, author, first revision and audit
event. Existing stable keys are skipped on a retry. Seeding never submits,
approves or publishes; a different administrator must still review the current
revision.

New CMS-only vocabulary also needs a release asset before approval. Use the
staged audio workflow documented in `app/audio/README.md`; it requires a
pronunciation reviewer separate from the content author, distribution-rights
evidence, technical WAV checks and per-clip provenance. Packaging audio does not
approve the curriculum record.
