"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Cloud,
  Coins,
  Compass,
  Dices,
  Download,
  Flame,
  Headphones,
  Home,
  Info,
  Library,
  Loader2,
  LockKeyhole,
  Map,
  MapPin,
  Medal,
  MessageCircle,
  RefreshCw,
  Route,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Upload,
  Volume2,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  MASTERY_STAGE_LABELS,
  CEFR_LEVELS,
  CURRICULUM_PLAN,
  REGIONS,
  SEED_COLLECTIBLES,
  type Region,
  type CurriculumLessonPlan,
  type RegionId,
  type Word,
} from "./learning-data";
import {
  activeWordProgress,
  applyRewardClaim,
  MASTERY_INTERVALS_MS,
  completeSession,
  isDue,
  learnedCount,
  levelFromXp,
  localDateKey,
  markWordKnown,
  masteredCount,
  rateWord,
  STATE_VERSION,
  stateFromUnknown,
  type LearningState,
  type Rating,
  type WordProgress,
} from "./learning-engine";
import { getOrCreateRewardReplicaId } from "./reward-replica";
import {
  useProgress,
  type OfflineCacheStatus,
  type SyncStatus,
} from "./use-progress";
import {
  transitionClaimedProgressCache,
  type LegacyCachePolicy,
} from "./progress-cache";
import { authClient } from "./auth-client";
import {
  authDestination,
  PROFILE_AUTH_RETURN,
} from "./auth-return";
import { trackProductEvent } from "./product-analytics";
import { FrenchAudioButton } from "./audio/FrenchAudioButton";
import TurnstileWidget from "./TurnstileWidget";
import {
  buildRuntimeCurriculum,
  lessonVocabulary,
  type PublishedLesson,
  type PublishedRecordInput,
} from "./runtime-curriculum";
import {
  DEFAULT_COURSE_ID,
  type CourseId,
} from "./course-catalog";

type Screen = "today" | "journey" | "review" | "wordbook" | "profile";
type LearnerAccountSession = typeof authClient.$Infer.Session;
type AccountDeletionFailure = {
  code?: string;
};
type AccountPrivacyTransition = {
  kind: "sign-out" | "account-deletion";
  status: "rotating" | "error";
};

type LessonState = {
  mode: "learn" | "review";
  words: Word[];
  regionId: string;
  origin: Screen;
  editorialTitle?: string;
  editorialIntro?: string;
};

export type CurriculumContentSummary = {
  contextCount: number;
  lessonCount: number;
  wordCount: number;
  cefrLevels: readonly Word["cefr"][];
};

const REGION_UNLOCK_WORDS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCREEN_LABELS: Record<Screen, string> = {
  today: "Today",
  journey: "Journey",
  review: "Review",
  wordbook: "Wordbook",
  profile: "Profile",
};

export function curriculumContentSummary(
  words: readonly Word[],
): CurriculumContentSummary {
  return {
    contextCount: new Set(words.map((word) => word.regionId)).size,
    lessonCount: new Set(
      words.map((word) => `${word.regionId}:${word.lesson}`),
    ).size,
    wordCount: words.length,
    cefrLevels: [...new Set(words.map((word) => word.cefr))].sort(
      (first, second) => CEFR_LEVELS.indexOf(first) - CEFR_LEVELS.indexOf(second),
    ),
  };
}

function accountDeletionError(error: AccountDeletionFailure): string {
  if (error.code === "SESSION_EXPIRED") {
    return "For security, sign out and sign in again before deleting this account.";
  }
  if (error.code === "INVALID_PASSWORD") {
    return "The current password is incorrect.";
  }
  if (error.code === "PASSWORD_REQUIRED") {
    return "Enter your current password before deleting this account.";
  }
  if (error.code === "CREDENTIAL_ACCOUNT_NOT_FOUND") {
    return "This linked-provider account must be signed in again before deletion.";
  }
  return "The account could not be deleted. Please retry.";
}

function compareFairPracticeWords(
  state: Pick<LearningState, "wordProgress">,
  first: Word,
  second: Word,
): number {
  const firstProgress = state.wordProgress[first.id];
  const secondProgress = state.wordProgress[second.id];
  return (
    (firstProgress?.seen ?? 0) - (secondProgress?.seen ?? 0) ||
    Date.parse(firstProgress?.lastReviewedAt ?? "") -
      Date.parse(secondProgress?.lastReviewedAt ?? "") ||
    first.id.localeCompare(second.id)
  );
}

function selectFairPracticeWords(
  state: Pick<LearningState, "wordProgress">,
  words: readonly Word[],
  limit = 5,
): Word[] {
  return words
    .filter((word) => state.wordProgress[word.id])
    .sort((first, second) =>
      compareFairPracticeWords(state, first, second),
    )
    .slice(0, limit);
}

export function selectReviewWords(
  state: Pick<LearningState, "wordProgress">,
  words: readonly Word[],
  now = new Date(),
  limit = 5,
): Word[] {
  const learned = words.filter((word) => state.wordProgress[word.id]);
  const due = learned
    .filter((word) => isDue(state.wordProgress[word.id], now))
    .sort((first, second) => {
      const firstProgress = state.wordProgress[first.id];
      const secondProgress = state.wordProgress[second.id];
      return (
        Date.parse(firstProgress.nextReviewAt) -
          Date.parse(secondProgress.nextReviewAt) ||
        compareFairPracticeWords(state, first, second)
      );
    });

  return due.length
    ? due.slice(0, limit)
    : selectFairPracticeWords(state, learned, limit);
}

export function selectChallengeWords(
  state: Pick<LearningState, "wordProgress">,
  words: readonly Word[],
  todayKey = localDateKey(),
  limit = 5,
): Word[] {
  const learned = words.filter((word) => state.wordProgress[word.id]);
  if (!learned.length) return [];

  const [year, month, day] = todayKey.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  const offset = ((dayNumber % learned.length) + learned.length) % learned.length;
  const rotated = [...learned.slice(offset), ...learned.slice(0, offset)];
  return rotated.slice(0, limit);
}

export function applyInitialPlacement(
  state: LearningState,
  level: LearningState["level"],
  words: readonly Word[],
  now = new Date(),
): LearningState {
  if (level === "new") return state;

  const parisWords = words
    .filter((word) => word.regionId === "ile-de-france")
    .sort((first, second) => first.lesson - second.lesson);
  const placedWords = parisWords.slice(0, level === "some" ? 5 : 10);
  const timestamp = now.toISOString();
  const stage: WordProgress["stage"] = level === "some" ? 1 : 0;
  const nextReviewAt =
    level === "some"
      ? new Date(now.getTime() + DAY_MS).toISOString()
      : timestamp;
  const wordProgress = { ...state.wordProgress };

  for (const word of placedWords) {
    if (wordProgress[word.id]) continue;
    wordProgress[word.id] = {
      stage,
      seen: 1,
      correct: 1,
      incorrect: 0,
      nextReviewAt,
      lastReviewedAt: timestamp,
    };
  }

  return applyUnlocksAndCollectibles(
    {
      ...state,
      level,
      currentRegionId: "ile-de-france",
      wordProgress,
      updatedAt: timestamp,
    },
    "ile-de-france",
    words,
  );
}

export function hardRatingTiming(progress?: WordProgress): string {
  const stage = progress?.stage ?? 0;
  const interval = Math.max(
    4 * 60 * 60 * 1000,
    Math.round(MASTERY_INTERVALS_MS[stage] * 0.5),
  );
  const hours = interval / (60 * 60 * 1000);
  if (hours < 24) return `In ${formatCount(Math.round(hours), "hour")}`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? "In" : "In about"} ${formatCount(Math.round(days), "day")}`;
}

export function activeCurriculumLesson(
  state: Pick<LearningState, "wordProgress">,
  regionId: string,
  words: readonly Word[],
): Word["lesson"] {
  const regionWords = words.filter((word) => word.regionId === regionId);
  const lessonNumbers = [
    ...new Set(regionWords.map((word) => word.lesson)),
  ].sort((first, second) => first - second);
  for (const lessonNumber of lessonNumbers) {
    if (
      regionWords.some(
        (word) =>
          word.lesson === lessonNumber && !state.wordProgress[word.id],
      )
    ) {
      return lessonNumber;
    }
  }

  return lessonNumbers.at(-1) ?? 1;
}

function curriculumLessonPlan(
  regionId: string,
  lessonNumber: number,
  words: readonly Word[],
  publishedLessons: readonly PublishedLesson[] = [],
): CurriculumLessonPlan {
  const compiled = CURRICULUM_PLAN[regionId as RegionId]?.find(
    (candidate) => candidate.lesson === lessonNumber,
  );
  if (compiled) return compiled;

  const editorial = publishedLessons.find(
    (candidate) =>
      candidate.regionId === regionId && candidate.lesson === lessonNumber,
  );
  if (editorial) {
    return {
      lesson: editorial.lesson,
      title: editorial.title,
      topic: editorial.topic,
      cefr: editorial.cefr,
    };
  }

  const word = words.find(
    (candidate) =>
      candidate.regionId === regionId && candidate.lesson === lessonNumber,
  );
  return {
    lesson: lessonNumber,
    title: word ? titleCase(word.topic) : `Lesson ${lessonNumber}`,
    topic: word?.topic ?? "curriculum",
    cefr: word?.cefr ?? "A1",
  };
}

export function selectLearningLesson(
  state: Pick<LearningState, "wordProgress">,
  regionId: string,
  words: readonly Word[],
  publishedLessons: readonly PublishedLesson[] = [],
): {
  words: Word[];
  editorialLesson?: PublishedLesson;
} {
  const regionWords = words.filter((word) => word.regionId === regionId);
  if (
    regionWords.length > 0 &&
    regionWords.every((word) => state.wordProgress[word.id])
  ) {
    return {
      words: selectFairPracticeWords(state, regionWords),
    };
  }
  const lessonNumber = activeCurriculumLesson(state, regionId, words);
  const activeWords = regionWords.filter(
    (word) => word.lesson === lessonNumber,
  );
  const editorialCandidates = publishedLessons
    .filter((lesson) => lesson.regionId === regionId)
    .map((lesson) => ({
      lesson,
      words: lessonVocabulary(lesson, words).filter(
        (word) =>
          word.regionId === regionId && word.lesson === lessonNumber,
      ),
    }))
    .filter((candidate) => candidate.words.length > 0);
  const editorial =
    editorialCandidates.find((candidate) =>
      candidate.words.some((word) => !state.wordProgress[word.id]),
    ) ?? editorialCandidates[0];
  const orderedWords = editorial
    ? [
        ...editorial.words,
        ...activeWords.filter(
          (word) => !editorial.words.some((item) => item.id === word.id),
        ),
      ]
    : activeWords;
  const sessionPool = orderedWords.length ? orderedWords : regionWords;
  const unseen = sessionPool.filter((word) => !state.wordProgress[word.id]);
  const familiar = sessionPool.filter((word) => state.wordProgress[word.id]);

  return {
    words: [...unseen, ...familiar].slice(0, 5),
    editorialLesson: editorial?.lesson,
  };
}

const NAV_ITEMS: Array<{
  id: Exclude<Screen, "profile">;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "today", label: "Today", icon: Home },
  { id: "journey", label: "Journey", icon: Route },
  { id: "review", label: "Review", icon: RefreshCw },
  { id: "wordbook", label: "Wordbook", icon: Library },
];

const EMPTY_PUBLISHED_RECORDS: readonly PublishedRecordInput[] = [];

export default function ParettoApp({
  storageKey,
  legacyCachePolicy = "ignore",
  serverAccountId,
  publishedRecords = EMPTY_PUBLISHED_RECORDS,
  courseId = DEFAULT_COURSE_ID,
  curriculumRevision = "compiled-v1",
  curriculumSource = "compiled",
  turnstileSiteKey = null,
  initialScreen = "today",
}: {
  storageKey?: string;
  legacyCachePolicy?: LegacyCachePolicy;
  serverAccountId?: string | null;
  publishedRecords?: readonly PublishedRecordInput[];
  courseId?: CourseId;
  curriculumRevision?: string;
  curriculumSource?: "cms" | "compiled" | "compiled-fallback";
  turnstileSiteKey?: string | null;
  initialScreen?: Screen;
} = {}) {
  const {
    state,
    setState,
    status,
    offlineCacheStatus,
    ready,
    savedAt,
    retry,
    deleteProgress,
    clearLocalProgress,
  } = useProgress(storageKey, { legacyCachePolicy });
  const account = authClient.useSession();
  const rewardReplicaId = getOrCreateRewardReplicaId(
    storageKey ?? "guest",
  );
  const clientAccountId = account.data?.user.id ?? null;
  const accountIdentityMismatch =
    serverAccountId !== undefined &&
    !account.isPending &&
    clientAccountId !== serverAccountId;
  const runtimeCurriculum = useMemo(
    () => buildRuntimeCurriculum(publishedRecords, courseId),
    [courseId, publishedRecords],
  );
  const words = runtimeCurriculum.words;
  const curriculumSummary = useMemo(
    () => curriculumContentSummary(words),
    [words],
  );
  const activeWordIds = useMemo(
    () => new Set(words.map((word) => word.id)),
    [words],
  );
  const publishedLessons = runtimeCurriculum.lessons;
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [showDice, setShowDice] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [accountPrivacyTransition, setAccountPrivacyTransition] =
    useState<AccountPrivacyTransition | null>(null);
  const appOpenTracked = useRef(false);
  const accountTransitionRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousScreenRef = useRef(screen);

  useEffect(() => {
    if (!accountIdentityMismatch || accountTransitionRef.current) return;
    window.location.reload();
  }, [accountIdentityMismatch]);

  useEffect(() => {
    if (accountPrivacyTransition?.status !== "rotating") return;
    let active = true;

    async function rotateBrowserProfile() {
      try {
        const response = await fetch("/api/account/browser-profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Browser profile rotation failed.");
        window.location.assign("/");
      } catch {
        if (active) {
          setAccountPrivacyTransition((current) =>
            current
              ? {
                  ...current,
                  status: "error",
                }
              : null,
          );
        }
      }
    }

    void rotateBrowserProfile();
    return () => {
      active = false;
    };
  }, [accountPrivacyTransition?.status]);

  useEffect(() => {
    if (!ready || state.activeCourseId !== courseId) return;
    const metadata = state.courseProgress[courseId];
    if (metadata?.curriculumRevision === curriculumRevision) return;
    const updatedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      courseProgress: {
        ...current.courseProgress,
        [courseId]: {
          currentContextId:
            current.courseProgress[courseId]?.currentContextId ??
            current.currentRegionId,
          curriculumRevision,
          updatedAt,
        },
      },
      updatedAt,
    }));
  }, [
    courseId,
    curriculumRevision,
    ready,
    setState,
    state.activeCourseId,
    state.courseProgress,
  ]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = state.settings.reducedMotion
      ? "true"
      : "false";
    return () => {
      delete document.documentElement.dataset.reduceMotion;
    };
  }, [state.settings.reducedMotion]);

  const currentRegion =
    REGIONS.find((region) => region.id === state.currentRegionId) ?? REGIONS[0];
  const reviewsDue = words.filter((word) => {
    const progress = state.wordProgress[word.id];
    return progress && isDue(progress);
  }).length;
  const availableLearnedWords = words.filter(
    (word) => state.wordProgress[word.id],
  ).length;
  const level = levelFromXp(state.xp);
  const profileAccountStatus = account.isPending
    ? "Checking account"
    : account.data
      ? "Progress synced"
      : "Saved on this browser";
  const profileAccessibleName = account.data
    ? `${state.displayName} Level ${level} traveler, signed in and synced`
    : `${state.displayName} Level ${level} traveler, learning on this browser`;
  const profileSignInDestination = authDestination(
    "/sign-in",
    PROFILE_AUTH_RETURN,
  );

  useEffect(() => {
    if (!ready || !state.onboarded || !state.settings.analytics || appOpenTracked.current) {
      return;
    }
    appOpenTracked.current = true;
    trackProductEvent(true, "app_opened", {
      currentRegionId: state.currentRegionId,
      learnedWords: learnedCount(state, activeWordIds),
    });
  }, [activeWordIds, ready, state]);

  useEffect(() => {
    if (!ready || !state.onboarded) return;
    trackProductEvent(state.settings.analytics, "navigation_changed", { screen });
  }, [ready, screen, state.onboarded, state.settings.analytics]);

  useEffect(() => {
    if (previousScreenRef.current === screen) return;
    previousScreenRef.current = screen;
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);

  function navigateTo(nextScreen: Screen) {
    setScreen(nextScreen);
  }

  function protectCompletedAccountTransition(
    kind: AccountPrivacyTransition["kind"],
  ) {
    accountTransitionRef.current = true;
    setAccountPrivacyTransition({ kind, status: "rotating" });
    // Server sign-out/deletion has already succeeded. Retire the account cache
    // and replace the rendered state before any fallible browser-profile
    // rotation so a shared browser can never keep showing the prior learner.
    clearLocalProgress();
  }

  function startLesson(mode: "learn" | "review", regionId = state.currentRegionId) {
    const regionWords = words.filter((word) => word.regionId === regionId);
    const learningLesson = selectLearningLesson(
      state,
      regionId,
      words,
      publishedLessons,
    );
    let lessonWords: Word[];

    if (mode === "review") {
      lessonWords = selectReviewWords(state, words);
      if (!lessonWords.length) return;
    } else {
      lessonWords = learningLesson.words;
      if (!lessonWords.length) lessonWords = regionWords.slice(0, 5);
    }
    trackProductEvent(state.settings.analytics, "lesson_started", {
      mode,
      regionId,
      wordCount: lessonWords.length,
    });
    setLesson({
      mode,
      words: lessonWords,
      regionId,
      origin: screen,
      ...(mode === "learn" && learningLesson.editorialLesson
        ? {
            editorialTitle: learningLesson.editorialLesson.title,
            editorialIntro: learningLesson.editorialLesson.introduction,
          }
        : {}),
    });
  }

  function finishLesson(
    mode: "learn" | "review",
    regionId: string,
    correct: number,
    wordCount: number,
  ) {
    trackProductEvent(state.settings.analytics, "lesson_completed", {
      mode,
      regionId,
      correct,
      wordCount,
    });
    setState((current) => {
      const completed = completeSession(
        current,
        {
          id: createId("session"),
          mode,
          words: wordCount,
          correct,
          xpEarned: 18,
        },
        new Date(),
        localDateKey(),
        rewardReplicaId,
      );
      return applyUnlocksAndCollectibles(completed, regionId, words);
    });
  }

  if (accountPrivacyTransition) {
    return (
      <AccountPrivacyRecoveryScreen
        transition={accountPrivacyTransition}
        onRetry={() =>
          setAccountPrivacyTransition((current) =>
            current ? { ...current, status: "rotating" } : null,
          )
        }
      />
    );
  }
  if (accountIdentityMismatch) return <LoadingScreen />;
  if (status === "loading" && !ready) return <LoadingScreen />;
  if (!ready) return <RecoveryScreen status={status} onRetry={retry} />;

  if (!state.onboarded) {
    return (
      <Onboarding
        curriculumSummary={curriculumSummary}
        onComplete={(details) => {
          const { analyticsEnabled, ...profile } = details;
          setState((current) =>
            applyInitialPlacement(
              {
                ...current,
                ...profile,
                settings: {
                  ...current.settings,
                  analytics: analyticsEnabled,
                },
                onboarded: true,
                updatedAt: new Date().toISOString(),
              },
              profile.level,
              words,
            ),
          );
          trackProductEvent(analyticsEnabled, "onboarding_completed", {
            level: profile.level,
            dailyGoal: profile.dailyGoal,
          });
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="side-rail" aria-label="Main navigation">
        <Brand />
        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              active={screen === item.id}
              icon={item.icon}
              label={item.label}
              onClick={() => navigateTo(item.id)}
            />
          ))}
        </nav>

        <div className="rail-spacer" />
        {!account.isPending && !account.data && (
          <Link className="rail-sign-in" href={profileSignInDestination}>
            Sign in
          </Link>
        )}
        <button
          className={`profile-button ${screen === "profile" ? "is-active" : ""}`}
          onClick={() => navigateTo("profile")}
          type="button"
          aria-label={profileAccessibleName}
        >
          <span className="avatar avatar-small" aria-hidden="true">
            {initials(state.displayName)}
          </span>
          <span>
            <strong>{state.displayName}</strong>
            <small>
              Level {level} · {profileAccountStatus}
            </small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </aside>

      <div className="app-stage">
        <header className="mobile-header">
          <Brand compact />
          <div className="mobile-account-actions">
            {!account.isPending && !account.data && (
              <Link href={profileSignInDestination}>Sign in</Link>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label={
                account.data
                  ? "Open profile, signed in and synced"
                  : "Open profile, learning on this browser"
              }
              onClick={() => navigateTo("profile")}
            >
              <CircleUserRound aria-hidden="true" />
            </button>
          </div>
        </header>

        <header className="stats-bar" aria-label="Learning status">
          <div className="stats-cluster">
            <StatPill icon={Flame} value={state.streak} label={wordForCount(state.streak, "consecutive day")} tone="coral" />
            <StatPill icon={Zap} value={state.xp} label="total XP" tone="blue" />
            <StatPill icon={Coins} value={state.coins} label={wordForCount(state.coins, "travel coin")} tone="gold" />
          </div>
          <SyncPill status={status} savedAt={savedAt} onRetry={retry} />
        </header>

        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {SCREEN_LABELS[screen]} view
        </p>
        <main
          ref={mainRef}
          id="main-content"
          className="main-canvas"
          tabIndex={-1}
        >
          {screen === "today" && (
            <TodayScreen
              state={state}
              words={words}
              currentRegion={currentRegion}
              publishedLessons={publishedLessons}
              reviewsDue={reviewsDue}
              status={status}
              offlineCacheStatus={offlineCacheStatus}
              onStart={() => startLesson("learn")}
              onReview={() => startLesson("review")}
              onJourney={() => navigateTo("journey")}
              onOpenWord={(word) => setSelectedWord(word)}
            />
          )}
          {screen === "journey" && (
            <JourneyScreen
              state={state}
              words={words}
              curriculumRevision={curriculumRevision}
              curriculumSource={curriculumSource}
              publishedRecordCount={publishedRecords.length}
              onOpenRegion={(region) => setSelectedRegion(region)}
              onSelectRegion={(region) => {
                setState((current) => ({
                  ...current,
                  currentRegionId: region.id,
                  updatedAt: new Date().toISOString(),
                }));
                setSelectedRegion(region);
              }}
            />
          )}
          {screen === "review" && (
            <ReviewScreen
              state={state}
              words={words}
              reviewsDue={reviewsDue}
              learned={availableLearnedWords}
              onReview={() => startLesson("review")}
              onStart={() => startLesson("learn")}
              onChallenge={() => {
                const challengeWords = selectChallengeWords(state, words);
                if (challengeWords.length < 3) return;
                trackProductEvent(state.settings.analytics, "challenge_started", {
                  wordCount: challengeWords.length,
                });
                setShowChallenge(true);
              }}
              onDice={() => setShowDice(true)}
              onProfile={() => navigateTo("profile")}
            />
          )}
          {screen === "wordbook" && (
            <WordbookScreen
              state={state}
              words={words}
              onOpenWord={(word) => setSelectedWord(word)}
              onStart={() => startLesson("learn")}
            />
          )}
          {screen === "profile" && (
            <ProfileScreen
              state={state}
              words={words}
              setState={setState}
              status={status}
              offlineCacheStatus={offlineCacheStatus}
              savedAt={savedAt}
              onRetry={retry}
              onDelete={deleteProgress}
              accountSession={account.data ?? null}
              accountPending={account.isPending}
              turnstileSiteKey={turnstileSiteKey}
              onAccountPrivacyTransition={protectCompletedAccountTransition}
              onAccountTransitionChange={(transitioning) => {
                accountTransitionRef.current = transitioning;
              }}
            />
          )}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={screen === item.id ? "is-active" : ""}
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
              >
                <Icon size={21} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === "review" && reviewsDue > 0 && (
                  <span className="nav-badge" aria-label={`${reviewsDue} due`}>
                    {Math.min(reviewsDue, 9)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {lesson && (
        <LessonOverlay
          lesson={lesson}
          state={state}
          syncStatus={status}
          offlineCacheStatus={offlineCacheStatus}
          returnLabel={`Back to ${SCREEN_LABELS[lesson.origin].toLowerCase()}`}
          onClose={() => {
            const origin = lesson.origin;
            setLesson(null);
            if (origin !== screen) navigateTo(origin);
          }}
          onRate={(wordId, rating) =>
            setState((current) =>
              applyCollectibles(
                rateWord(
                  current,
                  wordId,
                  rating,
                  new Date(),
                  rewardReplicaId,
                ),
              ),
            )
          }
          onMarkKnown={(wordId) =>
            setState((current) =>
              applyCollectibles(
                markWordKnown(
                  current,
                  wordId,
                  new Date(),
                  rewardReplicaId,
                ),
              ),
            )
          }
          onComplete={(correct, count) =>
            finishLesson(lesson.mode, lesson.regionId, correct, count)
          }
        />
      )}
      {selectedWord && (
        <WordModal
          word={selectedWord}
          state={state}
          onClose={() => setSelectedWord(null)}
        />
      )}
      {selectedRegion && (
        <RegionModal
          region={selectedRegion}
          state={state}
          words={words}
          publishedLessons={publishedLessons.filter((item) => item.regionId === selectedRegion.id)}
          onClose={() => setSelectedRegion(null)}
          onStart={() => {
            setSelectedRegion(null);
            startLesson("learn", selectedRegion.id);
          }}
          onOpenWord={(word) => {
            setSelectedRegion(null);
            setSelectedWord(word);
          }}
        />
      )}
      {showDice && (
        <DiceModal
          state={state}
          setState={setState}
          rewardReplicaId={rewardReplicaId}
          onClose={() => setShowDice(false)}
        />
      )}
      {showChallenge && (
        <ChallengeModal
          state={state}
          words={words}
          setState={setState}
          rewardReplicaId={rewardReplicaId}
          onClose={() => setShowChallenge(false)}
        />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-mark" aria-hidden="true">
        <span>P</span>
      </div>
      <div>
        <strong>Paretto</strong>
        <p>Opening your travel journal…</p>
      </div>
      <Loader2 className="spin" aria-hidden="true" />
    </div>
  );
}

function RecoveryScreen({
  status,
  onRetry,
}: {
  status: SyncStatus;
  onRetry: () => void;
}) {
  return (
    <main className="recovery-screen">
      <div className="recovery-card" role="alert">
        <Brand />
        <span className="recovery-icon" aria-hidden="true">
          <WifiOff />
        </span>
        <p className="eyebrow">Your journal is protected</p>
        <h1>We couldn’t open your saved progress.</h1>
        <p>
          No blank account has been created and nothing has been overwritten.
          Check your connection. If you use a Paretto account, you can also
          sign in again before retrying.
        </p>
        <button className="primary-button large" type="button" onClick={onRetry}>
          <RefreshCw size={18} aria-hidden="true" /> Try again
        </button>
        <small>{status === "offline" ? "You appear to be offline." : "Your existing data remains untouched."}</small>
      </div>
    </main>
  );
}

function AccountPrivacyRecoveryScreen({
  transition,
  onRetry,
}: {
  transition: AccountPrivacyTransition;
  onRetry: () => void;
}) {
  const deleted = transition.kind === "account-deletion";
  const rotating = transition.status === "rotating";
  return (
    <main className="recovery-screen">
      <div
        className="recovery-card"
        role={rotating ? "status" : "alert"}
        aria-live="polite"
      >
        <Brand />
        <span className="recovery-icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="eyebrow">Previous learning data is hidden</p>
        <h1>
          {deleted ? "Your account was deleted." : "You are signed out."}
        </h1>
        <p>
          {rotating
            ? "Paretto is preparing a fresh private browser profile. The previous learner’s name, progress, and local copy will not be shown."
            : "Paretto could not finish creating a fresh browser profile. The previous learner’s data remains hidden; retry before another learner uses this browser."}
        </p>
        {rotating ? (
          <small>
            <Loader2 className="spin" aria-hidden="true" /> Securing this browser…
          </small>
        ) : (
          <button
            className="primary-button large"
            type="button"
            onClick={onRetry}
          >
            <RefreshCw size={18} aria-hidden="true" /> Retry secure profile
          </button>
        )}
      </div>
    </main>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        P
      </span>
      <span className="brand-name">Paretto</span>
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? "is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function StatPill({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  tone: "coral" | "blue" | "gold";
}) {
  return (
    <div className={`stat-pill stat-${tone}`} title={`${value} ${label}`}>
      <Icon size={17} aria-hidden="true" />
      <strong>{formatNumber(value)}</strong>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function SyncPill({
  status,
  savedAt,
  onRetry,
}: {
  status: SyncStatus;
  savedAt: string | null;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <button className="sync-pill sync-error" type="button" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" />
        Retry sync
      </button>
    );
  }
  if (status === "offline") {
    return (
      <div className="sync-pill sync-offline">
        <WifiOff size={15} aria-hidden="true" /> Offline
      </div>
    );
  }
  if (status === "saving") {
    return (
      <div className="sync-pill">
        <Loader2 className="spin" size={15} aria-hidden="true" /> Saving
      </div>
    );
  }
  return (
    <div
      className="sync-pill"
      title={savedAt ? `Last saved ${new Date(savedAt).toLocaleString()}` : undefined}
    >
      <Cloud size={15} aria-hidden="true" /> Saved
    </div>
  );
}

function Onboarding({
  curriculumSummary,
  onComplete,
}: {
  curriculumSummary: CurriculumContentSummary;
  onComplete: (
    details: Pick<LearningState, "displayName" | "level" | "dailyGoal"> & {
      analyticsEnabled: boolean;
    },
  ) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LearningState["level"]>("new");
  const [dailyGoal, setDailyGoal] = useState<LearningState["dailyGoal"]>(5);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const previousStepRef = useRef(step);
  const beginButtonRef = useRef<HTMLButtonElement>(null);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    if (step === 0) beginButtonRef.current?.focus({ preventScroll: true });
    else setupHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="welcome-title">
        <div className="onboarding-copy">
          <Brand />
          {step === 0 ? (
            <>
              <p className="eyebrow">A five-minute French ritual</p>
              <h1 id="welcome-title">
                Learn French,
                <br /> one region at a time.
              </h1>
              <p className="onboarding-lede">
                Build a {curriculumSummary.wordCount}-word French foundation,
                hear French pronunciation, and fill a travel journal across{" "}
                {formatCount(curriculumSummary.contextCount, "region")} of France.
              </p>
              <div className="onboarding-points">
                <OnboardingPoint icon={Headphones} text="French audio on every card" />
                <OnboardingPoint icon={RefreshCw} text="Reviews that adapt to your memory" />
                <OnboardingPoint icon={MapPin} text="Vocabulary organized around French regions" />
              </div>
              <button
                ref={beginButtonRef}
                className="primary-button large"
                type="button"
                onClick={() => setStep(1)}
              >
                Begin the journey <ChevronRight aria-hidden="true" />
              </button>
              <p className="privacy-note">
                <ShieldCheck size={15} aria-hidden="true" /> Private progress, saved to
                this browser&apos;s anonymous learning journal until you choose
                to connect an account.
              </p>
              <OnboardingInformationLinks />
            </>
          ) : (
            <form
              className="setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                onComplete({
                  displayName: name.trim().slice(0, 40) || "Traveler",
                  level,
                  dailyGoal,
                  analyticsEnabled,
                });
              }}
            >
              <p className="eyebrow">Make it yours</p>
              <h1 ref={setupHeadingRef} id="welcome-title" tabIndex={-1}>
                Your first stop
              </h1>
              <label className="field-label" htmlFor="learner-name">
                What should we call you?
              </label>
              <input
                id="learner-name"
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your first name"
                autoComplete="given-name"
              />

              <fieldset>
                <legend>Your French today</legend>
                <div className="choice-grid three">
                  {(
                    [
                      ["new", "Fresh start", "Begin with the Paris basics"],
                      ["some", "Some French", "Place me after five basics"],
                      ["returning", "Returning", "Refresh ten familiar words"],
                    ] as const
                  ).map(([value, title, copy]) => (
                    <ChoiceCard
                      key={value}
                      active={level === value}
                      title={title}
                      copy={copy}
                      onClick={() => setLevel(value)}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>Daily rhythm</legend>
                <div className="choice-grid three compact-choices">
                  {([5, 10, 15] as const).map((value) => (
                    <ChoiceCard
                      key={value}
                      active={dailyGoal === value}
                      title={`${value} words`}
                      copy={value === 5 ? "≈ 4 min" : value === 10 ? "≈ 8 min" : "≈ 12 min"}
                      onClick={() => setDailyGoal(value)}
                    />
                  ))}
                </div>
              </fieldset>

              <label className="analytics-consent">
                <input
                  type="checkbox"
                  checked={analyticsEnabled}
                  onChange={(event) => setAnalyticsEnabled(event.target.checked)}
                />
                <span>
                  <strong>Help improve Paretto</strong>
                  <small>
                    Share privacy-safe product events. No lesson answers, email,
                    advertising ID, or cross-site tracking. Optional and changeable
                    in Profile. <a href="/privacy">Learn more</a>.
                  </small>
                </span>
              </label>

              <button className="primary-button large" type="submit">
                {level === "new"
                  ? "Start with Paris basics"
                  : level === "some"
                    ? "Start after the basics"
                    : "Start with a recall check"}{" "}
                <MapPin aria-hidden="true" />
              </button>
              <button className="text-button" type="button" onClick={() => setStep(0)}>
                Back
              </button>
              <OnboardingInformationLinks />
            </form>
          )}
        </div>

        <div className="onboarding-art" aria-hidden="true">
          <div className="sun-disc" />
          <div className="postcard postcard-back">
            <span>{curriculumSummary.contextCount} régions</span>
            <strong>France</strong>
          </div>
          <div className="postcard postcard-front">
            <span className="postcard-stamp">PAR</span>
            <div className="postcard-scene">
              <span>☕</span>
              <span>🏛️</span>
              <span>🥐</span>
            </div>
            <p>prochaine étape</p>
            <strong>Paris</strong>
          </div>
          <div className="route-line route-one" />
          <div className="route-line route-two" />
        </div>
      </section>
    </main>
  );
}

function OnboardingInformationLinks() {
  return (
    <nav className="onboarding-legal-links" aria-label="Product information">
      <Link href="/sign-in">Sign in</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/cookies">Cookies &amp; storage</Link>
      <Link href="/accessibility">Accessibility</Link>
      <Link href="/attributions">Attributions</Link>
      <Link href="/support">Support</Link>
    </nav>
  );
}

function OnboardingPoint({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div>
      <span>
        <Icon size={19} aria-hidden="true" />
      </span>
      {text}
    </div>
  );
}

function ChoiceCard({
  active,
  title,
  copy,
  onClick,
}: {
  active: boolean;
  title: string;
  copy: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`choice-card ${active ? "is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="choice-check">{active && <Check size={16} aria-hidden="true" />}</span>
      <strong>{title}</strong>
      <small>{copy}</small>
    </button>
  );
}

function TodayScreen({
  state,
  words,
  currentRegion,
  publishedLessons,
  reviewsDue,
  status,
  offlineCacheStatus,
  onStart,
  onReview,
  onJourney,
  onOpenWord,
}: {
  state: LearningState;
  words: readonly Word[];
  currentRegion: Region;
  publishedLessons: readonly PublishedLesson[];
  reviewsDue: number;
  status: SyncStatus;
  offlineCacheStatus: OfflineCacheStatus;
  onStart: () => void;
  onReview: () => void;
  onJourney: () => void;
  onOpenWord: (word: Word) => void;
}) {
  const regionWords = words.filter((word) => word.regionId === currentRegion.id);
  const learnedHere = regionWords.filter((word) => state.wordProgress[word.id]).length;
  const nextLessonNumber = activeCurriculumLesson(
    state,
    currentRegion.id,
    words,
  );
  const nextLesson = curriculumLessonPlan(
    currentRegion.id,
    nextLessonNumber,
    words,
    publishedLessons,
  );
  const lessonCount = new Set(regionWords.map((word) => word.lesson)).size;
  const remainingInNextLesson = regionWords.filter(
    (word) => word.lesson === nextLessonNumber && !state.wordProgress[word.id],
  ).length;
  const todayWords = state.sessions
    .filter((session) => localDateKey(new Date(session.completedAt)) === localDateKey())
    .reduce((total, session) => total + session.words, 0);
  const goalProgress = Math.min(100, Math.round((todayWords / state.dailyGoal) * 100));
  const activeWordIds = words.map((word) => word.id);
  const learned = learnedCount(state, activeWordIds);
  const recentWord = words.find((word) => state.wordProgress[word.id]);

  return (
    <div className="screen-page page-enter">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{dayGreeting()}, {state.displayName}</p>
          <h1>Your French is going places.</h1>
          <p>A small session today keeps tomorrow’s words within reach.</p>
        </div>
        <div className="day-chip">
          <span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date())}</span>
          <strong>{new Date().getDate()}</strong>
        </div>
      </header>

      {(status === "error" || status === "offline") && (
        <div className="inline-alert" role="alert">
          <WifiOff size={18} aria-hidden="true" />
          <div>
            <strong>
              {offlineCacheStatus === "available"
                ? "Your lesson is saved on this device."
                : offlineCacheStatus === "unavailable"
                  ? "This browser blocked offline storage."
                  : "Checking this device’s offline storage…"}
            </strong>
            <span>
              {offlineCacheStatus === "available"
                ? status === "offline"
                  ? "It is queued in this browser and will sync when you reconnect."
                  : "It is queued in this browser, but cloud sync failed. Use Retry sync before closing Paretto."
                : offlineCacheStatus === "unavailable"
                  ? "Keep this page open and reconnect before continuing so progress can reach the server."
                  : "Reconnect before closing the page while this check completes."}
            </span>
          </div>
        </div>
      )}

      <div className="today-layout">
        <div className="today-main">
          <section className="hero-card" aria-labelledby="today-session-title">
            <div className="hero-card-copy">
              <div className="location-kicker">
                <MapPin size={16} aria-hidden="true" /> Stop {currentRegion.number} of {REGIONS.length}
              </div>
              <h2 id="today-session-title">{currentRegion.name}</h2>
              <p>{currentRegion.theme}</p>
              <div className="lesson-kicker">
                <span>{nextLesson.cefr}</span>
                Lesson {nextLesson.lesson} of {lessonCount} · {nextLesson.title}
              </div>
              <div className="hero-progress-label">
                <span>{learnedHere} of {regionWords.length} words collected</span>
                <strong>{Math.round((learnedHere / regionWords.length) * 100)}%</strong>
              </div>
              <ProgressBar value={(learnedHere / regionWords.length) * 100} label={`${currentRegion.name} vocabulary progress`} light />
              <button className="cream-button" type="button" onClick={onStart}>
                <BookOpen size={19} aria-hidden="true" />
                {learnedHere
                  ? learnedHere === regionWords.length
                    ? "Practice this completed chapter"
                    : `Continue lesson ${nextLesson.lesson} · ${formatCount(remainingInNextLesson, "card")} left`
                  : `Start lesson ${nextLesson.lesson} · ${nextLesson.title}`}
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="hero-card-art" aria-hidden="true">
              <div className="passport-stamp">{currentRegion.shortLabel.slice(0, 3).toUpperCase()}</div>
              <span className="region-emoji">{currentRegion.emoji}</span>
              <div className="hero-postmark">PARETTO · {String(currentRegion.number).padStart(2, "0")}</div>
            </div>
          </section>

          <section aria-labelledby="today-plan-title">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Today’s route</p>
                <h2 id="today-plan-title">Three useful stops</h2>
              </div>
              <span>{todayWords}/{state.dailyGoal} goal</span>
            </div>
            <div className="mission-grid">
              <MissionCard
                icon={BookOpen}
                tone="blue"
                kicker="New words"
                title="A five-card discovery"
                copy={`Learn the language of ${currentRegion.shortLabel}.`}
                action="Start lesson"
                onClick={onStart}
              />
              <MissionCard
                icon={RefreshCw}
                tone="coral"
                kicker="Memory"
                title={reviewsDue ? `${formatCount(reviewsDue, "review")} ${reviewsDue === 1 ? "is" : "are"} ready` : learned ? "Your memory is clear" : "Build your first memory set"}
                copy={reviewsDue ? "A short recovery set, never an endless backlog." : learned ? "Practice any learned words whenever you like." : "Complete your first discovery lesson before starting a review."}
                action={reviewsDue ? "Review now" : learned ? "Practice anyway" : "Start first lesson"}
                onClick={learned ? onReview : onStart}
              />
              <MissionCard
                icon={Compass}
                tone="gold"
                kicker="Journey"
                title={`${state.unlockedRegionIds.length} of ${REGIONS.length} regions open`}
                copy="See your route and choose the next cultural chapter."
                action="Open journey"
                onClick={onJourney}
              />
            </div>
          </section>

          <section className="culture-card" aria-labelledby="culture-title">
            <div className="culture-card-art" style={{ background: currentRegion.accentColor }}>
              <span aria-hidden="true">{currentRegion.emoji}</span>
              <small>Carnet № {String(currentRegion.number).padStart(2, "0")}</small>
            </div>
            <div>
              <p className="eyebrow">A note from {currentRegion.shortLabel}</p>
              <h2 id="culture-title">Language lives in a place.</h2>
              <p>{currentRegion.cultureNote}</p>
              <button className="text-link" type="button" onClick={onJourney}>
                Explore the region <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>

        <aside className="today-aside" aria-label="Today’s progress">
          <section className="goal-card">
            <div
              className="goal-ring"
              style={{ "--goal-progress": `${goalProgress * 3.6}deg` } as CSSProperties}
              aria-label={`${goalProgress}% of daily goal`}
            >
              <div>
                <strong>{goalProgress}%</strong>
                <span>today</span>
              </div>
            </div>
            <div>
              <p className="eyebrow">Daily rhythm</p>
              <h2>{todayWords ? "Nicely done." : "One small step."}</h2>
              <p>{formatRemainingWords(Math.max(0, state.dailyGoal - todayWords))} in today’s goal.</p>
            </div>
          </section>

          <section className="mini-stats-card">
            <MiniStat icon={Library} value={learned} label={`${wordLabel(learned)} seen`} />
            <MiniStat icon={Star} value={masteredCount(state, activeWordIds)} label="mastered" />
            <MiniStat icon={Trophy} value={state.longestStreak} label="best streak" />
          </section>

          {recentWord ? (
            <button className="word-of-day" type="button" onClick={() => onOpenWord(recentWord)}>
              <span className="eyebrow">From your wordbook</span>
              <strong lang="fr">{recentWord.french}</strong>
              <span>{recentWord.english}</span>
              <div>
                Open card <ChevronRight size={15} aria-hidden="true" />
              </div>
            </button>
          ) : (
            <div className="word-of-day empty-word-card">
              <span className="eyebrow">Your wordbook</span>
              <strong>Waiting for page one</strong>
              <span>Your first lesson will place five words here.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function MissionCard({
  icon: Icon,
  tone,
  kicker,
  title,
  copy,
  action,
  onClick,
}: {
  icon: LucideIcon;
  tone: "blue" | "coral" | "gold";
  kicker: string;
  title: string;
  copy: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className={`mission-card mission-${tone}`}>
      <span className="mission-icon"><Icon aria-hidden="true" /></span>
      <div>
        <p className="eyebrow">{kicker}</p>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
      <button type="button" onClick={onClick}>
        {action} <ChevronRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

function MiniStat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <div>
      <Icon size={18} aria-hidden="true" />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function curriculumStatusLabel(
  source: "cms" | "compiled" | "compiled-fallback",
  publishedRecordCount: number,
): string {
  if (source === "cms") {
    return `Built-in curriculum + ${formatCount(
      publishedRecordCount,
      "published CMS update",
    )}`;
  }
  return source === "compiled-fallback"
    ? "Built-in curriculum · CMS temporarily unavailable"
    : "Built-in curriculum · no published CMS updates";
}

function JourneyScreen({
  state,
  words,
  curriculumRevision,
  curriculumSource,
  publishedRecordCount,
  onOpenRegion,
  onSelectRegion,
}: {
  state: LearningState;
  words: readonly Word[];
  curriculumRevision: string;
  curriculumSource: "cms" | "compiled" | "compiled-fallback";
  publishedRecordCount: number;
  onOpenRegion: (region: Region) => void;
  onSelectRegion: (region: Region) => void;
}) {
  const curriculumStatus = curriculumStatusLabel(
    curriculumSource,
    publishedRecordCount,
  );

  return (
    <div className="screen-page page-enter">
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">Your carnet de voyage</p>
          <h1>France, word by word.</h1>
          <p>
            Eighteen regions. Each chapter pairs useful French with a real cultural
            thread—from Parisian transport to Réunion’s volcanic landscapes.
          </p>
        </div>
        <div className="journey-summary">
          <Compass aria-hidden="true" />
          <div><strong>{state.unlockedRegionIds.length}/{REGIONS.length}</strong><span>regions open</span></div>
        </div>
      </header>

      <div className="journey-legend" aria-label="Journey status legend">
        <span><i className="legend-dot completed" /> Completed</span>
        <span><i className="legend-dot current" /> Current</span>
        <span><i className="legend-dot locked" /> Locked</span>
        <p><Info size={15} aria-hidden="true" /> Complete the first five-card lesson to open the next stop. <span className="curriculum-revision" title={`Curriculum revision ${curriculumRevision}`}>{curriculumStatus}</span></p>
      </div>

      <ol className="region-route" aria-label="French regional learning journey">
        {REGIONS.map((region, index) => {
          const regionWords = words.filter((word) => word.regionId === region.id);
          const progress = regionWords.filter((word) => state.wordProgress[word.id]).length;
          const unlocked = state.unlockedRegionIds.includes(region.id);
          const current = state.currentRegionId === region.id;
          const completed = progress === regionWords.length;
          const activeLesson = activeCurriculumLesson(
            state,
            region.id,
            words,
          );
          const regionLessonCount = new Set(
            regionWords.map((word) => word.lesson),
          ).size;
          return (
            <li key={region.id} className={index % 2 ? "route-right" : "route-left"}>
              <span className="route-number" aria-hidden="true">{String(region.number).padStart(2, "0")}</span>
              <button
                type="button"
                className={`region-card ${current ? "is-current" : ""} ${completed ? "is-complete" : ""}`}
                disabled={!unlocked}
                onClick={() => onSelectRegion(region)}
                aria-label={
                  unlocked
                    ? `${region.name}, ${progress} of ${regionWords.length} words${current ? ", current region" : ""}`
                    : `${region.name}, locked`
                }
              >
                <span className="region-card-color" style={{ background: region.accentColor }} />
                <span className="region-card-emoji" aria-hidden="true">{unlocked ? region.emoji : <LockKeyhole />}</span>
                <span className="region-card-copy">
                  <small>{completed ? "Chapter complete" : unlocked ? `Lesson ${activeLesson} of ${regionLessonCount}` : "Keep traveling"}</small>
                  <strong>{region.name}</strong>
                  <span>{region.theme}</span>
                </span>
                <span className="region-card-progress">
                  <i style={{ width: `${(progress / regionWords.length) * 100}%` }} />
                  <small>{progress}/{regionWords.length}</small>
                </span>
                {unlocked && <ChevronRight size={19} aria-hidden="true" />}
              </button>
              {unlocked && (
                <button className="region-info-button" type="button" onClick={() => onOpenRegion(region)}>
                  <Info size={16} aria-hidden="true" /> About this stop
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ReviewScreen({
  state,
  words,
  reviewsDue,
  learned,
  onReview,
  onStart,
  onChallenge,
  onDice,
  onProfile,
}: {
  state: LearningState;
  words: readonly Word[];
  reviewsDue: number;
  learned: number;
  onReview: () => void;
  onStart: () => void;
  onChallenge: () => void;
  onDice: () => void;
  onProfile: () => void;
}) {
  const activeWordIds = words.map((word) => word.id);
  const progressValues = Object.values(
    activeWordProgress(state, activeWordIds),
  );
  const totalCorrect = progressValues.reduce((sum, word) => sum + word.correct, 0);
  const totalSeen = progressValues.reduce((sum, word) => sum + word.correct + word.incorrect, 0);
  const accuracy = totalSeen ? Math.round((totalCorrect / totalSeen) * 100) : 0;
  const challengeDone = state.challenge.lastPlayedDate === localDateKey();
  const diceDone = state.dice.lastPlayedDate === localDateKey();
  const reviewRoundSize = Math.min(5, reviewsDue || learned);

  return (
    <div className="screen-page page-enter">
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">Memory studio</p>
          <h1>Make the words yours.</h1>
          <p>Short recovery sets keep missed days humane. Your streak never resets what you have learned.</p>
        </div>
        <div className="accuracy-chip"><Target aria-hidden="true" /><strong>{accuracy}%</strong><span>recall</span></div>
      </header>

      <section className="review-hero" aria-labelledby="review-title">
        <div className="review-hero-icon"><RefreshCw aria-hidden="true" /></div>
        <div>
          <p className="eyebrow">Adaptive review</p>
          <h2 id="review-title">{reviewsDue ? `${formatCount(reviewsDue, "word")} ${reviewsDue === 1 ? "is" : "are"} ready` : learned ? "Choose a practice round" : "Your first words will appear here"}</h2>
          <p>{reviewsDue ? "We’ll serve at most five now and keep the remaining queue visible." : learned ? "Nothing is overdue. A mixed practice round is still available." : "Complete one regional lesson to build your first review set."}</p>
        </div>
        <button className="primary-button" type="button" onClick={learned ? onReview : onStart}>
          {learned ? <RefreshCw size={18} aria-hidden="true" /> : <BookOpen size={18} aria-hidden="true" />} {reviewsDue ? `Review ${formatCount(reviewRoundSize, "word")}` : learned ? `Practice ${formatCount(reviewRoundSize, "word")}` : "Start first lesson"}
        </button>
      </section>

      <div className="practice-grid">
        <PracticeCard
          icon={MessageCircle}
          tone="night"
          eyebrow="Dialogue mission"
          title="The Château Challenge"
          copy="Answer up to five prompts from words you have learned to open the château gate. No timer, and every question can be read aloud."
          meta={challengeDone ? "Completed today · practice is reward-free" : learned >= 3 ? `Ready · ${formatCount(Math.min(5, learned), "learned word")}` : "Learn 3 words to unlock"}
          action={challengeDone ? "Play again for practice" : "Begin challenge"}
          disabled={learned < 3}
          onClick={onChallenge}
        />
        <PracticeCard
          icon={Dices}
          tone="gold"
          eyebrow="Travel dice"
          title="Roll for a route boost"
          copy="Use included starter coins or coins earned in lessons for a transparent one-in-six XP boost. No purchases, no hidden odds."
          meta={diceDone ? "Today’s reward collected" : `${formatCount(state.coins, "coin")} available`}
          action={diceDone ? "See today’s result" : "Open the dice"}
          disabled={!learned}
          onClick={onDice}
        />
      </div>

      <section className="mastery-section" aria-labelledby="mastery-title">
        <div className="section-heading-row">
          <div><p className="eyebrow">Seven-stage memory</p><h2 id="mastery-title">A schedule you can understand</h2></div>
          <span>{formatCount(masteredCount(state, activeWordIds), "word")} solid</span>
        </div>
        <div className="mastery-ladder">
          {MASTERY_STAGE_LABELS.map((label, index) => {
            const count = progressValues.filter((word) => word.stage === index).length;
            return <div key={label}><span>{index + 1}</span><strong>{label}</strong><small>{formatCount(count, "word")}</small></div>;
          })}
        </div>
      </section>

      <section className="collection-preview" aria-labelledby="collection-title">
        <div><p className="eyebrow">Carnet collection</p><h2 id="collection-title">Postcards earned by showing up</h2><p>{state.collectibles.length} of {SEED_COLLECTIBLES.length} keepsakes collected.</p></div>
        <div className="collection-mini-grid">
          {SEED_COLLECTIBLES.map((item) => (
            <span key={item.id} className={state.collectibles.includes(item.id) ? "is-collected" : ""} title={item.name}>{state.collectibles.includes(item.id) ? item.emoji : "?"}</span>
          ))}
        </div>
        <button className="secondary-button" type="button" onClick={onProfile}>View collection</button>
      </section>
    </div>
  );
}

function PracticeCard({
  icon: Icon,
  tone,
  eyebrow,
  title,
  copy,
  meta,
  action,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  tone: "night" | "gold";
  eyebrow: string;
  title: string;
  copy: string;
  meta: string;
  action: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className={`practice-card practice-${tone}`}>
      <span className="practice-icon"><Icon aria-hidden="true" /></span>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{copy}</p>
      <small>{meta}</small>
      <button type="button" onClick={onClick} disabled={disabled}>{action} <ChevronRight size={17} aria-hidden="true" /></button>
    </article>
  );
}

function WordbookScreen({
  state,
  words,
  onOpenWord,
  onStart,
}: {
  state: LearningState;
  words: readonly Word[];
  onOpenWord: (word: Word) => void;
  onStart: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Word["partOfSpeech"]>("all");
  const [showAll, setShowAll] = useState(false);
  const normalizedQuery = normalizeText(query);

  const visibleWords = useMemo(
    () =>
      words.filter((word) => showAll || state.wordProgress[word.id])
        .filter((word) => filter === "all" || word.partOfSpeech === filter)
        .filter((word) => {
          if (!normalizedQuery) return true;
          return normalizeText(`${word.french} ${word.search} ${word.english}`).includes(normalizedQuery);
        }),
    [filter, normalizedQuery, showAll, state.wordProgress, words],
  );

  return (
    <div className="screen-page page-enter">
      <header className="page-heading split-heading">
        <div><p className="eyebrow">Personal wordbook</p><h1>Every word has a story.</h1><p>Search French or English, accents optional. Every learned card keeps its gender, sound, example and next review.</p></div>
        <div className="wordbook-count"><Library aria-hidden="true" /><strong>{learnedCount(state, words.map((word) => word.id))}</strong><span>collected</span></div>
      </header>

      <div className="wordbook-toolbar">
        <label className="search-field">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">Search the wordbook</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search French or English…" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button>}
        </label>
        <button className={`syllabus-toggle ${showAll ? "is-active" : ""}`} type="button" onClick={() => setShowAll((value) => !value)} aria-pressed={showAll}>
          <Map size={17} aria-hidden="true" /> {showAll ? "Full syllabus" : "My words"}
        </button>
      </div>

      <div className="filter-row" role="group" aria-label="Filter by part of speech">
        {(["all", "noun", "verb", "pronominal verb", "adjective", "adverb", "phrase"] as const).map((value) => (
          <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>
            {value === "all" ? "All" : titleCase(value)}
          </button>
        ))}
      </div>

      {visibleWords.length ? (
        <div className="word-list" aria-live="polite">
          {visibleWords.map((word) => {
            const progress = state.wordProgress[word.id];
            const region = REGIONS.find((item) => item.id === word.regionId);
            return (
              <button className="word-row" type="button" key={word.id} onClick={() => onOpenWord(word)}>
                <span className="word-emoji" aria-hidden="true">{word.emoji}</span>
                <span className="word-main"><strong lang="fr">{word.french}</strong>{state.settings.phonetics && <small>{word.ipa}</small>}<small className="curriculum-meta">{word.cefr} · Lesson {word.lesson} · {titleCase(word.topic)}</small></span>
                <span className="word-meaning">{word.english}</span>
                <span className="word-meta"><small>{region?.shortLabel}</small><MasteryDots stage={progress?.stage ?? 0} learned={Boolean(progress)} /></span>
                <ChevronRight size={19} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={
            query
              ? "No matching words"
              : filter !== "all"
                ? `No ${titleCase(filter)} cards in this view`
                : "Your wordbook is ready"
          }
          copy={
            query
              ? "Try a shorter French or English search."
              : filter !== "all"
                ? "Choose all word types to return to your collected cards."
                : "Complete a lesson and your first five cards will live here."
          }
          action={
            query
              ? undefined
              : filter !== "all"
                ? "Show all word types"
                : "Start a lesson"
          }
          onAction={
            query
              ? undefined
              : filter !== "all"
                ? () => setFilter("all")
                : onStart
          }
        />
      )}
    </div>
  );
}

function MasteryDots({ stage, learned }: { stage: number; learned: boolean }) {
  return (
    <span className="mastery-dots" aria-label={learned ? `Mastery: ${MASTERY_STAGE_LABELS[stage]}` : "Not learned yet"}>
      {Array.from({ length: 7 }, (_, index) => <i key={index} className={learned && index <= stage ? "is-filled" : ""} />)}
    </span>
  );
}

function RecoveryCodeManager({
  username,
  turnstileSiteKey,
}: {
  username: string;
  turnstileSiteKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [challengeReset, setChallengeReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!codes) return;
    receiptHeadingRef.current?.focus({ preventScroll: true });
    const clearCodes = () => {
      setCodes(null);
      setSaved(false);
      setStatus("");
      setOpen(false);
    };
    window.addEventListener("pagehide", clearCodes);
    return () => window.removeEventListener("pagehide", clearCodes);
  }, [codes]);

  async function replaceCodes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/recovery-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          password,
          turnstileToken: token,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; recoveryCodes?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error ??
            "Recovery codes could not be replaced. Please retry.",
        );
      }
      const nextCodes = parseProfileRecoveryCodes(payload?.recoveryCodes);
      if (!nextCodes) {
        throw new Error(
          "Recovery codes were replaced, but the receipt was incomplete. Retry from this signed-in browser.",
        );
      }
      setCodes(nextCodes);
      setPassword("");
      setToken("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Recovery codes could not be replaced. Please retry.",
      );
      setToken("");
      setChallengeReset((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(
        profileRecoveryReceipt(username, codes),
      );
      setStatus("Recovery codes copied.");
    } catch {
      setStatus(
        "Copy was blocked. Select the visible codes or download them instead.",
      );
    }
  }

  function downloadCodes() {
    if (!codes) return;
    const blob = new Blob([profileRecoveryReceipt(username, codes)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paretto-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Recovery-code file downloaded.");
  }

  function close() {
    setOpen(false);
    setCodes(null);
    setPassword("");
    setToken("");
    setError("");
    setSaved(false);
    setStatus("");
    setChallengeReset((current) => current + 1);
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        className="account-recovery-trigger"
        type="button"
        disabled={!turnstileSiteKey}
        aria-expanded={false}
        aria-controls="account-recovery-panel"
        onClick={() => {
          setOpen(true);
          window.requestAnimationFrame(() =>
            passwordRef.current?.focus({ preventScroll: true }),
          );
        }}
      >
        Replace recovery codes
      </button>
    );
  }

  if (codes) {
    return (
      <section
        id="account-recovery-panel"
        className="account-recovery-panel"
        aria-labelledby="profile-recovery-receipt-title"
      >
        <h3
          id="profile-recovery-receipt-title"
          ref={receiptHeadingRef}
          tabIndex={-1}
        >
          Save the new codes now
        </h3>
        <p>
          The old set is invalid. These codes are shown once, and Support
          cannot retrieve them.
        </p>
        <ol className="account-recovery-codes">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <div className="account-recovery-actions">
          <button type="button" onClick={() => void copyCodes()}>
            Copy all
          </button>
          <button type="button" onClick={downloadCodes}>
            Download codes
          </button>
        </div>
        {status && <p role="status">{status}</p>}
        <label className="account-recovery-saved">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          <span>I saved these codes somewhere private.</span>
        </label>
        <button type="button" disabled={!saved} onClick={close}>
          Done
        </button>
      </section>
    );
  }

  return (
    <form
      id="account-recovery-panel"
      className="account-recovery-panel"
      onSubmit={(event) => void replaceCodes(event)}
    >
      <h3>Replace every recovery code?</h3>
      <p>
        Your current codes will stop working. Enter your password and save the
        replacement set.
      </p>
      <label>
        <span>Current password</span>
        <input
          ref={passwordRef}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action="recovery_codes_rotate"
        resetKey={challengeReset}
        onTokenChange={setToken}
      />
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="account-recovery-actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !token}>
          {busy ? "Replacing…" : "Replace codes"}
        </button>
      </div>
    </form>
  );
}

function parseProfileRecoveryCodes(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 8 ||
    !value.every(
      (code) =>
        typeof code === "string" &&
        /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}$/.test(code),
    )
  ) {
    return null;
  }
  return [...value];
}

function profileRecoveryReceipt(
  username: string,
  codes: readonly string[],
): string {
  return [
    "Paretto recovery codes",
    `Paretto ID: ${username}`,
    "",
    ...codes,
    "",
    "Each code can be used once. Using one replaces this entire set.",
    "Keep these codes private. Paretto Support cannot retrieve them.",
  ].join("\n");
}

function ProfileScreen({
  state,
  words,
  setState,
  status,
  offlineCacheStatus,
  savedAt,
  onRetry,
  onDelete,
  accountSession,
  accountPending,
  turnstileSiteKey,
  onAccountPrivacyTransition,
  onAccountTransitionChange,
}: {
  state: LearningState;
  words: readonly Word[];
  setState: React.Dispatch<React.SetStateAction<LearningState>>;
  status: SyncStatus;
  offlineCacheStatus: OfflineCacheStatus;
  savedAt: string | null;
  onRetry: () => void;
  onDelete: () => Promise<boolean>;
  accountSession: LearnerAccountSession | null;
  accountPending: boolean;
  turnstileSiteKey: string | null;
  onAccountPrivacyTransition: (
    kind: AccountPrivacyTransition["kind"],
  ) => void;
  onAccountTransitionChange: (transitioning: boolean) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [accountAction, setAccountAction] = useState<
    "syncing" | "signing-out" | "deleting" | null
  >(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmAccountDelete, setConfirmAccountDelete] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const accountDeleteTriggerRef = useRef<HTMLButtonElement>(null);
  const accountDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const signOutTriggerRef = useRef<HTMLButtonElement>(null);
  const signOutCancelRef = useRef<HTMLButtonElement>(null);
  const accountErrorRef = useRef<HTMLSpanElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const restoreDeleteFocusRef = useRef(false);
  const restoreAccountDeleteFocusRef = useRef(false);
  const restoreSignOutFocusRef = useRef(false);
  const level = levelFromXp(state.xp);
  const activeWordIds = words.map((word) => word.id);
  const learned = learnedCount(state, activeWordIds);
  const mastered = masteredCount(state, activeWordIds);
  const curriculumSummary = curriculumContentSummary(words);

  useEffect(() => {
    if (confirmReset) {
      deleteCancelRef.current?.focus({ preventScroll: true });
      return;
    }
    if (restoreDeleteFocusRef.current) {
      restoreDeleteFocusRef.current = false;
      deleteTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [confirmReset]);

  useEffect(() => {
    if (confirmAccountDelete) {
      accountDeleteCancelRef.current?.focus({ preventScroll: true });
      return;
    }
    if (restoreAccountDeleteFocusRef.current) {
      restoreAccountDeleteFocusRef.current = false;
      accountDeleteTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [confirmAccountDelete]);

  useEffect(() => {
    if (confirmSignOut) {
      signOutCancelRef.current?.focus({ preventScroll: true });
      return;
    }
    if (restoreSignOutFocusRef.current) {
      restoreSignOutFocusRef.current = false;
      signOutTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [confirmSignOut]);

  useEffect(() => {
    if (!accountError) return;
    accountErrorRef.current?.focus({ preventScroll: true });
  }, [accountError]);

  function openDeleteConfirmation() {
    restoreDeleteFocusRef.current = true;
    setConfirmReset(true);
  }

  function cancelDeleteConfirmation() {
    setConfirmReset(false);
  }

  function updateSetting(key: keyof LearningState["settings"], value: boolean) {
    setState((current) => ({ ...current, settings: { ...current.settings, [key]: value }, updatedAt: new Date().toISOString() }));
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `paretto-progress-${localDateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProgress(file: File | undefined) {
    if (!file) return;
    setImportMessage("");
    try {
      if (file.size > 300_000) {
        throw new Error("That progress file is too large.");
      }
      const parsed: unknown = JSON.parse(await file.text());
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        ((parsed as { version?: unknown }).version !== 1 &&
          (parsed as { version?: unknown }).version !== STATE_VERSION)
      ) {
        throw new Error("Choose a compatible Paretto progress export.");
      }
      const imported = stateFromUnknown(parsed);
      setState(imported);
      setImportMessage(
        offlineCacheStatus === "available"
          ? "Progress imported and saved on this device. Keep Paretto open until cloud sync is confirmed."
          : offlineCacheStatus === "unavailable"
            ? "Progress imported into this open session. This browser blocked the offline copy, so keep Paretto open until cloud sync is confirmed."
            : "Progress imported. Keep Paretto open while device storage and cloud sync are checked.",
      );
    } catch (reason) {
      setImportMessage(
        reason instanceof Error
          ? reason.message
          : "Progress could not be imported.",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function signOut() {
    setAccountError("");
    setAccountAction("signing-out");
    onAccountTransitionChange(true);
    let result: Awaited<ReturnType<typeof authClient.signOut>>;
    try {
      result = await authClient.signOut();
    } catch {
      onAccountTransitionChange(false);
      setAccountError("Sign-out could not be completed.");
      setAccountAction(null);
      return;
    }
    if (result.error) {
      onAccountTransitionChange(false);
      setAccountError(result.error.message ?? "Sign-out could not be completed.");
      setAccountAction(null);
      return;
    }
    onAccountPrivacyTransition("sign-out");
  }

  async function reconnectAccountProgress() {
    setAccountError("");
    setAccountAction("syncing");
    try {
      const response = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) {
        setAccountError("Progress could not be connected. Please retry.");
        setAccountAction(null);
        return;
      }
      const cacheTransitioned = await transitionClaimedProgressCache(
        await response.json(),
      );
      if (cacheTransitioned) {
        window.location.reload();
        return;
      }
      setAccountError(
        "Cloud progress connected, but this browser could not safely hand off its pending local copy. Allow site storage changes, then retry.",
      );
    } catch {
      setAccountError(
        "Progress could not be connected. Check your connection and retry.",
      );
    }
    setAccountAction(null);
  }

  async function deleteAccount() {
    setAccountAction("deleting");
    setAccountError("");
    onAccountTransitionChange(true);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: accountPassword }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;
      if (!response.ok) {
        onAccountTransitionChange(false);
        setAccountError(
          accountDeletionError({
            code: payload?.code,
          }),
        );
        setAccountAction(null);
        return;
      }
    } catch {
      onAccountTransitionChange(false);
      setAccountError("The account could not be deleted.");
      setAccountAction(null);
      return;
    }
    onAccountPrivacyTransition("account-deletion");
  }

  return (
    <div className="screen-page page-enter">
      <header className="profile-hero">
        <div className="avatar avatar-large">{initials(state.displayName)}</div>
        <div><p className="eyebrow">Travel profile</p><h1>{state.displayName}</h1><p>Level {level} · {formatCount(learned, "word")} · {formatCount(state.unlockedRegionIds.length, "region")}</p></div>
        <SyncPill status={status} savedAt={savedAt} onRetry={onRetry} />
      </header>

      <div className="profile-grid">
        <div className="profile-main-column">
          <section className="profile-stats" aria-label="Progress statistics">
            <ProfileStat icon={Zap} value={state.xp} label="Total XP" />
            <ProfileStat icon={Flame} value={state.streak} label={wordForCount(state.streak, "consecutive day")} />
            <ProfileStat icon={Library} value={learned} label={wordForCount(learned, "word")} />
            <ProfileStat icon={Medal} value={mastered} label={wordForCount(mastered, "word mastered", "words mastered")} />
          </section>

          <section className="collection-card" aria-labelledby="profile-collection-title">
            <div className="section-heading-row"><div><p className="eyebrow">Carnet collection</p><h2 id="profile-collection-title">Postcards & keepsakes</h2></div><span>{state.collectibles.length}/{SEED_COLLECTIBLES.length}</span></div>
            <div className="collection-grid">
              {SEED_COLLECTIBLES.map((item) => {
                const collected = state.collectibles.includes(item.id);
                return <article key={item.id} className={collected ? "is-collected" : ""}><span aria-hidden="true">{collected ? item.emoji : "?"}</span><div><small>{item.rarity}</small><strong>{item.name}</strong><p>{collected ? collectibleDescription(item) : `Unlocks at ${item.unlockAtXp} XP`}</p></div></article>;
              })}
            </div>
          </section>
        </div>

        <aside className="settings-card" aria-labelledby="settings-title">
          <div><p className="eyebrow">Preferences</p><h2 id="settings-title"><Settings size={20} aria-hidden="true" /> Your studio</h2></div>
          <label className="profile-name-field"><span>Display name</span><input value={state.displayName} maxLength={40} onChange={(event) => setState((current) => ({ ...current, displayName: event.target.value, updatedAt: new Date().toISOString() }))} onBlur={() => setState((current) => ({ ...current, displayName: current.displayName.trim() || "Traveler", updatedAt: new Date().toISOString() }))} /></label>
          <fieldset>
            <legend>Daily word goal</legend>
            <div className="choice-grid three compact-choices">
              {([5, 10, 15] as const).map((value) => (
                <ChoiceCard
                  key={value}
                  active={state.dailyGoal === value}
                  title={`${value} words`}
                  copy="Daily target"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      dailyGoal: value,
                      updatedAt: new Date().toISOString(),
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>
          <SettingToggle label="French audio" copy="Enable pronunciation buttons" checked={state.settings.sound} onChange={(value) => updateSetting("sound", value)} />
          <SettingToggle label="Show IPA" copy="Keep pronunciation guides visible" checked={state.settings.phonetics} onChange={(value) => updateSetting("phonetics", value)} />
          <SettingToggle label="Reduced motion" copy="Remove movement and celebration effects" checked={state.settings.reducedMotion} onChange={(value) => updateSetting("reducedMotion", value)} />
          <SettingToggle
            label="Optional product analytics"
            copy="Share coarse usage events without answers or personal text"
            checked={state.settings.analytics}
            onChange={(value) => {
              updateSetting("analytics", value);
              trackProductEvent(value, "analytics_consent_updated", { enabled: value });
            }}
          />
          <section className="account-summary" aria-labelledby="account-summary-title">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong id="account-summary-title">
                {accountPending
                  ? "Checking your account…"
                  : accountSession
                    ? "Progress follows you"
                    : "Use Paretto on another device"}
              </strong>
              <span>
                {accountPending
                  ? "Confirming this browser’s secure session."
                  : accountSession
                    ? accountSession.user.username
                      ? `Paretto ID: ${accountSession.user.username}.`
                      : "Signed in with a linked identity provider."
                    : "Create a free Paretto ID or sign in, and this browser’s progress will connect automatically."}
              </span>
              {accountError && (
                <span
                  ref={accountErrorRef}
                  className="account-error"
                  role="alert"
                  tabIndex={-1}
                >
                  {accountError}
                </span>
              )}
              {!accountPending && !accountSession && (
                <Link
                  href={authDestination("/sign-in", PROFILE_AUTH_RETURN)}
                >
                  Sign in or create an account
                </Link>
              )}
              {accountSession &&
                !confirmAccountDelete &&
                !confirmSignOut && (
                <>
                  <div
                    className="account-actions"
                    aria-busy={accountAction !== null}
                  >
                    <button
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => void reconnectAccountProgress()}
                    >
                      {accountAction === "syncing"
                        ? "Syncing…"
                        : "Sync progress now"}
                    </button>
                    <button
                      ref={signOutTriggerRef}
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => {
                        setAccountError("");
                        restoreSignOutFocusRef.current = true;
                        setConfirmSignOut(true);
                      }}
                    >
                      Sign out
                    </button>
                    <button
                      ref={accountDeleteTriggerRef}
                      className="danger"
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => {
                        setAccountError("");
                        restoreAccountDeleteFocusRef.current = true;
                        setConfirmAccountDelete(true);
                      }}
                    >
                      Delete account
                    </button>
                  </div>
                  {accountSession.user.username && (
                    <RecoveryCodeManager
                      username={accountSession.user.username}
                      turnstileSiteKey={turnstileSiteKey}
                    />
                  )}
                </>
              )}
              {accountSession && confirmSignOut && (
                <div
                  className="account-delete-confirm"
                  role="group"
                  aria-labelledby="account-sign-out-title"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || accountAction) return;
                    setConfirmSignOut(false);
                  }}
                >
                  <strong id="account-sign-out-title">
                    Sign out and clear this browser?
                  </strong>
                  <p>
                    Wait until progress says Saved if you made recent changes.
                    Paretto will then hide this account and create a fresh,
                    private browser profile.
                  </p>
                  <div>
                    <button
                      ref={signOutCancelRef}
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => setConfirmSignOut(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => void signOut()}
                    >
                      {accountAction === "signing-out"
                        ? "Signing out…"
                        : "Sign out and clear"}
                    </button>
                  </div>
                </div>
              )}
              {accountSession && confirmAccountDelete && (
                <div
                  className="account-delete-confirm"
                  role="group"
                  aria-labelledby="account-delete-title"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || accountAction) return;
                    setConfirmAccountDelete(false);
                    setAccountPassword("");
                  }}
                >
                  <strong id="account-delete-title">
                    Delete your account and synced learning data?
                  </strong>
                  <p>
                    This cannot be undone. Enter the current password for a
                    Paretto ID account. Linked-provider accounts can leave it
                    blank after signing in again.
                  </p>
                  <label>
                    <span>Current password</span>
                    <input
                      type="password"
                      value={accountPassword}
                      onChange={(event) => setAccountPassword(event.target.value)}
                      autoComplete="current-password"
                      maxLength={128}
                    />
                  </label>
                  <div>
                    <button
                      ref={accountDeleteCancelRef}
                      type="button"
                      disabled={accountAction !== null}
                      onClick={() => {
                        setConfirmAccountDelete(false);
                        setAccountPassword("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={
                        accountAction !== null ||
                        Boolean(
                          accountSession.user.username &&
                            !accountPassword,
                        )
                      }
                      onClick={() => void deleteAccount()}
                    >
                      {accountAction === "deleting"
                        ? "Deleting…"
                        : "Delete account permanently"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
          <div className="beta-pass"><Sparkles aria-hidden="true" /><div><strong>Current French curriculum included</strong><span>All {formatCount(curriculumSummary.lessonCount, "current lesson")} and current practice modes are included. Each new region opens after you complete the previous region’s first lesson.</span></div></div>
          <div className="privacy-summary"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Your learning data stays private</strong><span>{accountSession ? "Your signed-in account synchronizes progress across supported web browsers." : "Without an account, progress is tied to this browser profile."} {offlineCacheStatus === "available" ? "This browser profile also has a working offline progress queue." : offlineCacheStatus === "unavailable" ? "This browser is currently blocking the offline progress queue." : "Offline storage availability is still being checked."} Paretto never uses learning data for ads.</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a><a href="/attributions">Attributions</a><a href="/support">Support</a></div></div>
          <button className="secondary-button full" type="button" onClick={exportProgress}><Download size={17} aria-hidden="true" /> Export my progress</button>
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Choose a Paretto progress export"
            onChange={(event) => void importProgress(event.target.files?.[0])}
          />
          <button
            className="secondary-button full"
            type="button"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={17} aria-hidden="true" /> Import a progress export
          </button>
          {importMessage && (
            <p className="profile-action-message" role="status">
              {importMessage}
            </p>
          )}
          {!confirmReset ? (
            <button ref={deleteTriggerRef} className="danger-text-button" type="button" onClick={() => { setDeleteError(""); openDeleteConfirmation(); }}>Delete my learning data</button>
          ) : (
            <div className="reset-confirm" role="alert"><strong>Delete all learning data?</strong><p>This permanently removes the server record and this device’s offline copy.</p>{deleteError && <p className="profile-action-error">{deleteError}</p>}<div><button ref={deleteCancelRef} type="button" onClick={cancelDeleteConfirmation} disabled={deleting}>Cancel</button><button type="button" disabled={deleting} onClick={async () => { setDeleting(true); const deleted = await onDelete(); if (!deleted) { setDeleteError("Deletion could not be fully confirmed. Keep this page open and retry."); setDeleting(false); } }}>{deleting ? "Deleting…" : "Delete permanently"}</button></div></div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProfileStat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return <div><span><Icon size={19} aria-hidden="true" /></span><strong>{formatNumber(value)}</strong><small>{label}</small></div>;
}

function SettingToggle({ label, copy, checked, onChange, disabled = false }: { label: string; copy: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={`setting-toggle ${disabled ? "is-disabled" : ""}`}><span><strong>{label}</strong><small>{copy}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let openDialogCount = 0;
let bodyOverflowBeforeDialog = "";
let rootOverflowBeforeDialog = "";

function getDialogFocusableElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0,
  );
}

function useDialogLifecycle(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog = dialog;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const backgroundStates = Array.from(dialog.parentElement?.children ?? [])
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== dialog,
      )
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    if (openDialogCount === 0) {
      bodyOverflowBeforeDialog = document.body.style.overflow;
      rootOverflowBeforeDialog = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }
    openDialogCount += 1;

    const focusFirstElement = () => {
      const initialFocus =
        activeDialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        getDialogFocusableElements(activeDialog)[0] ??
        activeDialog;
      initialFocus.focus({ preventScroll: true });
    };

    focusFirstElement();
    backgroundStates.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusableElements = getDialogFocusableElements(activeDialog);
      if (!focusableElements.length) {
        event.preventDefault();
        activeDialog.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === firstElement || !activeDialog.contains(activeElement))
      ) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || !activeDialog.contains(activeElement))
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !activeDialog.contains(event.target)) {
        focusFirstElement();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);

      backgroundStates.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });

      openDialogCount = Math.max(0, openDialogCount - 1);
      if (openDialogCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeDialog;
        document.documentElement.style.overflow = rootOverflowBeforeDialog;
      }

      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return dialogRef;
}

function LessonOverlay({
  lesson,
  state,
  syncStatus,
  offlineCacheStatus,
  returnLabel,
  onClose,
  onRate,
  onMarkKnown,
  onComplete,
}: {
  lesson: LessonState;
  state: LearningState;
  syncStatus: SyncStatus;
  offlineCacheStatus: OfflineCacheStatus;
  returnLabel: string;
  onClose: () => void;
  onRate: (wordId: string, rating: Rating) => void;
  onMarkKnown: (wordId: string) => void;
  onComplete: (correct: number, count: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [complete, setComplete] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const [sessionCoins, setSessionCoins] = useState(0);
  const word = lesson.words[index];
  const region = REGIONS.find((item) => item.id === lesson.regionId) ?? REGIONS[0];
  const completionCoins = sessionCoins + Math.max(1, Math.floor(correct / 2));
  const preloadWords = useMemo(
    () =>
      lesson.words
        .slice(index + 1)
        .map((item) => ({ wordId: item.id, text: item.french })),
    [index, lesson.words],
  );
  const dialogRef = useDialogLifecycle(onClose);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const answerFocusRef = useRef<HTMLElement>(null);
  const completionHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (complete) {
      completionHeadingRef.current?.focus({ preventScroll: true });
    } else if (revealed) {
      answerFocusRef.current?.focus({ preventScroll: true });
    } else {
      cardHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [complete, index, revealed]);

  function advance(rating: Rating) {
    onRate(word.id, rating);
    if (rating !== "again") setCorrect((value) => value + 1);
    setSessionXp((value) => value + (rating === "good" ? 10 : rating === "hard" ? 6 : 2));
    if (rating === "good") setSessionCoins((value) => value + 1);
    moveNext(rating !== "again" ? 1 : 0);
  }

  function markKnownAndAdvance() {
    onMarkKnown(word.id);
    setCorrect((value) => value + 1);
    setSessionXp((value) => value + 5);
    moveNext(1);
  }

  function moveNext(correctIncrement: number) {
    if (index === lesson.words.length - 1) {
      const finalCorrect = correct + correctIncrement;
      onComplete(finalCorrect, lesson.words.length);
      setComplete(true);
      return;
    }
    setIndex((value) => value + 1);
    setRevealed(false);
  }

  return (
    <div ref={dialogRef} className="modal-backdrop lesson-backdrop" role="dialog" aria-modal="true" aria-labelledby="lesson-title" tabIndex={-1}>
      <div className="lesson-shell">
        {!complete ? (
          <>
            <header className="lesson-header">
              <button className="icon-button" type="button" aria-label="Close session" onClick={onClose} data-dialog-initial-focus><X /></button>
              <div className="lesson-progress"><span><i style={{ width: `${((index + 1) / lesson.words.length) * 100}%` }} /></span><small>{index + 1} / {lesson.words.length}</small></div>
              <span className="lesson-xp"><Zap size={15} aria-hidden="true" /> +{sessionXp}</span>
            </header>
            <section className="lesson-content" aria-labelledby="lesson-title">
              <div className="lesson-meta"><span>{lesson.mode === "learn" ? `Lesson ${word.lesson} · ${word.cefr}` : "Mixed recall"}</span><span>{lesson.mode === "learn" ? lesson.editorialTitle ?? curriculumLessonPlan(word.regionId, word.lesson, lesson.words).title : region.shortLabel}</span></div>
              {index === 0 && lesson.editorialIntro && <p className="lesson-editorial-intro">{lesson.editorialIntro}</p>}
              <article className={`flash-card ${revealed ? "is-revealed" : ""}`}>
                <span className="flash-emoji" aria-hidden="true">{word.emoji}</span>
                <span className="pos-chip">{word.partOfSpeech}</span>
                <h1 ref={cardHeadingRef} id="lesson-title" lang="fr" tabIndex={-1}>{word.french}</h1>
                {state.settings.phonetics && <p className="ipa">{word.ipa}</p>}
                <FrenchAudioButton
                  courseId={state.activeCourseId}
                  wordId={word.id}
                  text={word.french}
                  enabled={state.settings.sound}
                  onPlay={() => trackProductEvent(state.settings.analytics, "audio_played", { wordId: word.id })}
                  preloadWords={preloadWords}
                  className="audio-button"
                >
                  {({ isPlaying, status: audioStatus }) => (
                    <>
                      {audioStatus === "error" ? (
                        <X size={19} aria-hidden="true" />
                      ) : (
                        <Volume2 size={19} aria-hidden="true" />
                      )}{" "}
                      {audioStatus === "error"
                        ? "Audio unavailable — try again"
                        : isPlaying
                          ? "Pause French audio"
                          : "Hear it in French"}
                    </>
                  )}
                </FrenchAudioButton>
                {!revealed ? (
                  <div className="recall-prompt"><p>{lesson.mode === "review" ? "Say the meaning—and the article for nouns—before revealing it." : "Notice the sound and article. What do you think it means?"}</p><button className="primary-button large" type="button" onClick={() => setRevealed(true)}>Reveal the card</button>{lesson.mode === "learn" && !state.wordProgress[word.id] && <button className="text-button" type="button" onClick={markKnownAndAdvance}><Check size={16} aria-hidden="true" /> I already know this</button>}</div>
                ) : (
                  <div className="answer-panel" aria-live="polite"><strong ref={answerFocusRef} tabIndex={-1}>{word.english}</strong>{word.gender && <span className="gender-chip">{word.gender}</span>}<blockquote><p lang="fr">{word.exampleFr}</p><footer>{word.exampleEn}</footer></blockquote><p className="rating-prompt">How did that feel?</p><div className="rating-grid"><button className="rate-again" type="button" onClick={() => advance("again")}><strong>Again</strong><small>10 min</small></button><button className="rate-hard" type="button" onClick={() => advance("hard")}><strong>Almost</strong><small>{hardRatingTiming(state.wordProgress[word.id])}</small></button><button className="rate-good" type="button" onClick={() => advance("good")}><strong>Got it</strong><small>Build the interval</small></button></div></div>
                )}
              </article>
            </section>
          </>
        ) : (
          <div className="lesson-complete" role="status">
            <div className="completion-seal"><Check aria-hidden="true" /></div>
            <p className="eyebrow">Session complete</p>
            <h1 ref={completionHeadingRef} id="lesson-title" tabIndex={-1}>Très bien, {state.displayName}.</h1>
            <p>{lesson.mode === "learn" ? `You showed up, recalled ${correct} of ${lesson.words.length}, and moved your regional route forward.` : `You recalled ${correct} of ${lesson.words.length} and strengthened your memory schedule.`}</p>
            <div className="completion-stats"><div><Zap aria-hidden="true" /><strong>+{sessionXp + 18}</strong><span>XP</span></div><div><Coins aria-hidden="true" /><strong>+{completionCoins}</strong><span>{wordForCount(completionCoins, "coin")}</span></div><div><Flame aria-hidden="true" /><strong>{Math.max(1, state.streak)}</strong><span>{wordForCount(Math.max(1, state.streak), "consecutive day")}</span></div></div>
            <div className="completion-note"><Sparkles aria-hidden="true" /><span>{completionPersistenceMessage(syncStatus, offlineCacheStatus)}</span></div>
            <button className="primary-button large" type="button" onClick={onClose}>{returnLabel} <ChevronRight aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export function completionPersistenceMessage(
  syncStatus: SyncStatus,
  offlineCacheStatus: OfflineCacheStatus,
): string {
  if (syncStatus === "saved") {
    return offlineCacheStatus === "available"
      ? "Saved on this device and in the cloud."
      : "Cloud sync is confirmed. This browser is not keeping an offline copy.";
  }
  if (offlineCacheStatus === "available") {
    if (syncStatus === "offline") {
      return "Queued in this browser. Cloud sync will retry when you reconnect.";
    }
    if (syncStatus === "error") {
      return "Queued in this browser, but cloud sync failed. Keep Paretto open and use Retry sync.";
    }
    return "Queued in this browser. Keep Paretto open while cloud sync finishes.";
  }
  if (offlineCacheStatus === "unavailable") {
    return "Saving is not confirmed and this browser blocked the offline copy. Keep Paretto open, reconnect if needed, and use Retry sync.";
  }
  return "Keep Paretto open while device storage and cloud sync are checked.";
}

function WordModal({ word, state, onClose }: { word: Word; state: LearningState; onClose: () => void }) {
  const progress = state.wordProgress[word.id];
  const region = REGIONS.find((item) => item.id === word.regionId);
  return (
    <ModalFrame labelId="word-modal-title" onClose={onClose} className="word-modal">
      <div className="word-modal-top" style={{ background: region?.accentColor }}><span aria-hidden="true">{word.emoji}</span><small>{region?.name}</small></div>
      <div className="word-modal-body">
        <div className="modal-title-row"><div><span className="pos-chip">{word.partOfSpeech}</span><span className="cefr-chip">{word.cefr} · Lesson {word.lesson}</span><h2 id="word-modal-title" lang="fr">{word.french}</h2>{state.settings.phonetics && <p>{word.ipa}</p>}</div><FrenchAudioButton courseId={state.activeCourseId} wordId={word.id} text={word.french} enabled={state.settings.sound} onPlay={() => trackProductEvent(state.settings.analytics, "audio_played", { wordId: word.id })} className="audio-circle">{({ status: audioStatus }) => audioStatus === "error" ? <span style={{ fontSize: 9, lineHeight: 1.05 }}>Audio<br />unavailable</span> : <Volume2 aria-hidden="true" />}</FrenchAudioButton></div>
        <div className="meaning-row"><strong>{word.english}</strong>{word.gender && <span>{word.gender}</span>}</div>
        <blockquote className="example-card"><MessageCircle size={18} aria-hidden="true" /><p lang="fr">{word.exampleFr}</p><footer>{word.exampleEn}</footer></blockquote>
        <div className="mastery-detail"><div><span>Memory stage</span><strong>{progress ? MASTERY_STAGE_LABELS[progress.stage] : "Not learned yet"}</strong></div><MasteryDots stage={progress?.stage ?? 0} learned={Boolean(progress)} /></div>
        {progress && <div className="next-review"><Clock3 size={17} aria-hidden="true" /><span>Next review</span><strong>{formatDue(progress.nextReviewAt)}</strong></div>}
      </div>
    </ModalFrame>
  );
}

function RegionModal({ region, state, words, publishedLessons, onClose, onStart, onOpenWord }: { region: Region; state: LearningState; words: readonly Word[]; publishedLessons: readonly PublishedLesson[]; onClose: () => void; onStart: () => void; onOpenWord: (word: Word) => void }) {
  const regionWords = words.filter((word) => word.regionId === region.id);
  const count = regionWords.filter((word) => state.wordProgress[word.id]).length;
  const lessonNumbers = [
    ...new Set(regionWords.map((word) => word.lesson)),
  ].sort((first, second) => first - second);
  const plans = lessonNumbers.map((lessonNumber) =>
    curriculumLessonPlan(region.id, lessonNumber, words, publishedLessons),
  );
  return (
    <ModalFrame labelId="region-modal-title" onClose={onClose} className="region-modal">
      <div className="region-modal-hero" style={{ background: region.accentColor }}><span className="region-number">Stop {String(region.number).padStart(2, "0")}</span><span className="region-big-emoji" aria-hidden="true">{region.emoji}</span><h2 id="region-modal-title">{region.name}</h2><p>{region.theme}</p></div>
      <div className="region-modal-body"><p className="culture-note">{region.cultureNote}</p>{publishedLessons.map((lesson) => <article className="published-lesson-note" key={lesson.id}><div><span>Published field lesson · {lesson.estimatedMinutes} min</span><h3>{lesson.title}</h3></div><p>{lesson.summary}</p><details><summary>Read the lesson introduction</summary><p>{lesson.introduction}</p>{lesson.blocks.map((block, index) => <div className={`published-block published-block-${block.type}`} key={`${lesson.id}-${index}`}><strong>{block.type === "tip" ? "Language tip" : block.type === "exercise" ? "Try it" : "Field note"}</strong><p>{block.content}</p></div>)}</details></article>)}<div className="hero-progress-label"><span>{count} of {regionWords.length} words collected</span><strong>{Math.round((count / regionWords.length) * 100)}%</strong></div><ProgressBar value={(count / regionWords.length) * 100} label={`${region.name} vocabulary progress`} /><div className="region-lessons">{plans.map((plan) => { const lessonWords = regionWords.filter((word) => word.lesson === plan.lesson); const learned = lessonWords.filter((word) => state.wordProgress[word.id]).length; return <section key={plan.lesson} aria-labelledby={`region-lesson-${region.id}-${plan.lesson}`}><header><div><span>{plan.cefr}</span><h3 id={`region-lesson-${region.id}-${plan.lesson}`}>Lesson {plan.lesson}: {plan.title}</h3><p>{titleCase(plan.topic)}</p></div><strong>{learned}/{lessonWords.length}</strong></header><div className="region-word-preview">{lessonWords.map((word) => <button type="button" key={word.id} onClick={() => onOpenWord(word)}><span>{word.emoji}</span><span><strong lang="fr">{word.french}</strong><small>{state.wordProgress[word.id] ? word.english : "Ready to discover"}</small></span><ChevronRight size={17} /></button>)}</div></section>; })}</div><button className="primary-button large full" type="button" onClick={onStart}><BookOpen size={18} /> {count === regionWords.length ? "Practice this chapter" : count ? "Continue this chapter" : `Start lesson ${plans[0]?.lesson ?? 1}`}</button></div>
    </ModalFrame>
  );
}

function DiceModal({ state, setState, rewardReplicaId, onClose }: { state: LearningState; setState: React.Dispatch<React.SetStateAction<LearningState>>; rewardReplicaId: string; onClose: () => void }) {
  const [todayKey] = useState(() => localDateKey());
  const savedResult =
    state.dice.lastPlayedResult?.date === todayKey
      ? state.dice.lastPlayedResult
      : null;
  const [stake, setStake] = useState<1 | 3 | 5>(
    savedResult?.stake ?? 1,
  );
  const [result, setResult] = useState<{
    stake: 1 | 3 | 5;
    multiplier: 0.5 | 1 | 1.25 | 1.5 | 2 | 3;
    xp: number;
  } | null>(savedResult);
  const doneToday = state.dice.lastPlayedDate === todayKey;
  const multipliers = [0.5, 1, 1.25, 1.5, 2, 3];

  function roll() {
    if (doneToday || state.coins < stake) return;
    const multiplier = multipliers[
      Math.floor(Math.random() * multipliers.length)
    ] as 0.5 | 1 | 1.25 | 1.5 | 2 | 3;
    const xp = Math.round(12 * stake * multiplier);
    const receipt = { stake, multiplier, xp };
    setResult(receipt);
    setState((current) => {
      const now = new Date();
      const rewarded = applyRewardClaim(
        current,
        `daily:dice:${todayKey}`,
        { xpEarned: xp, coinsSpent: stake },
        rewardReplicaId,
        now,
      );
      return applyCollectibles({
        ...rewarded,
        dice: {
          lastPlayedDate: todayKey,
          lastPlayedResult: { date: todayKey, ...receipt },
        },
        updatedAt: now.toISOString(),
      });
    });
  }

  return (
    <ModalFrame labelId="dice-title" onClose={onClose} className="dice-modal">
      <div className="dice-heading"><span><Dices aria-hidden="true" /></span><div><p className="eyebrow">Travel dice</p><h2 id="dice-title">A little route boost</h2><p>Six equal outcomes: ×0.5, ×1, ×1.25, ×1.5, ×2 or ×3 XP. Use the included starter balance or coins earned in lessons.</p></div></div>
      {doneToday && !result ? <div className="done-panel"><Check aria-hidden="true" /><strong>Today’s roll is complete</strong><p>The reward was saved by an earlier Paretto version. A new detailed receipt will appear after tomorrow’s roll.</p></div> : result ? <div className="dice-result" role="status"><div className="rolling-die">{result.multiplier}×</div><p className="eyebrow">Route boost</p><h3>+{result.xp} XP</h3><p>Your {formatCount(result.stake, "travel coin")} turned into a memory boost.</p><button className="primary-button full" type="button" onClick={onClose}>Collect reward</button></div> : <><div className="coin-balance"><Coins aria-hidden="true" /><span>Available</span><strong>{formatCount(state.coins, "coin")}</strong></div><div className="stake-grid">{([1, 3, 5] as const).map((value) => <button type="button" key={value} className={stake === value ? "is-active" : ""} onClick={() => setStake(value)} disabled={state.coins < value}><Coins size={18} aria-hidden="true" /><strong>{value}</strong><span>{wordForCount(value, "coin")}</span></button>)}</div><p className="odds-note"><Info size={15} aria-hidden="true" /> Every face is equally likely. Base learning XP is never at risk.</p><button className="primary-button large full" type="button" onClick={roll} disabled={state.coins < stake}><Dices size={19} aria-hidden="true" /> Roll the dice</button></>}
    </ModalFrame>
  );
}

function ChallengeModal({ state, words, setState, rewardReplicaId, onClose }: { state: LearningState; words: readonly Word[]; setState: React.Dispatch<React.SetStateAction<LearningState>>; rewardReplicaId: string; onClose: () => void }) {
  const [todayKey] = useState(() => localDateKey());
  const [questions] = useState(() =>
    selectChallengeWords(state, words, todayKey),
  );
  const [rewardEligible] = useState(
    () => state.challenge.lastPlayedDate !== todayKey,
  );
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answerXp, setAnswerXp] = useState(0);
  const [complete, setComplete] = useState(false);
  const answerLocked = useRef(false);
  const answerResults = useRef<Array<{ wordId: string; rating: Rating }>>([]);
  const current = questions[index];
  const questionCount = questions.length;
  const progressDenominator = Math.max(1, questionCount);
  const preloadWords = useMemo(
    () =>
      questions
        .slice(index + 1)
        .map((item) => ({ wordId: item.id, text: item.french })),
    [index, questions],
  );
  const options = useMemo(
    () => current ? buildOptions(current, questions) : [],
    [current, questions],
  );
  const isCorrect = Boolean(current) && selected === current.id;
  const dialogRef = useDialogLifecycle(onClose);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const completionHeadingRef = useRef<HTMLHeadingElement>(null);
  const challengeCoins = score + Math.max(1, Math.floor(score / 2));

  useEffect(() => {
    if (complete) {
      completionHeadingRef.current?.focus({ preventScroll: true });
    } else {
      questionHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [complete, index]);

  function choose(id: string) {
    if (!current || selected || answerLocked.current) return;
    answerLocked.current = true;
    setSelected(id);
    const correct = id === current.id;
    if (correct) setScore((value) => value + 1);
    answerResults.current.push({
      wordId: current.id,
      rating: correct ? "good" : "again",
    });
    if (rewardEligible) {
      setAnswerXp((value) => value + (correct ? 10 : 2));
    }
  }

  function next() {
    if (!current) {
      onClose();
      return;
    }
    if (index === questionCount - 1) {
      const finalScore = answerResults.current.filter(
        (answer) => answer.rating === "good",
      ).length;
      const finalAnswerXp =
        finalScore * 10 + (questionCount - finalScore) * 2;
      const bonusXp = finalScore >= 3 ? 35 : 12;
      trackProductEvent(state.settings.analytics, "challenge_completed", {
        correct: finalScore,
        wordCount: questionCount,
      });
      setState((progress) => {
        if (!rewardEligible) {
          return { ...progress, challenge: { ...progress.challenge, bestScore: Math.max(progress.challenge.bestScore, finalScore) }, updatedAt: new Date().toISOString() };
        }
        const ratedProgress = answerResults.current.reduce(
          (nextProgress, answer) =>
            rateWord(
              nextProgress,
              answer.wordId,
              answer.rating,
              new Date(),
              rewardReplicaId,
              false,
            ),
          progress,
        );
        const completed = completeSession(
          {
            ...ratedProgress,
            challenge: {
              lastPlayedDate: todayKey,
              bestScore: Math.max(
                ratedProgress.challenge.bestScore,
                finalScore,
              ),
            },
          },
          {
            id: createId("challenge"),
            mode: "challenge",
            words: questionCount,
            correct: finalScore,
            xpEarned: bonusXp,
          },
          new Date(),
          localDateKey(),
          rewardReplicaId,
          false,
        );
        return applyCollectibles(
          applyRewardClaim(
            completed,
            `daily:challenge:${todayKey}`,
            {
              xpEarned: finalAnswerXp + bonusXp,
              coinsEarned:
                finalScore + Math.max(1, Math.floor(finalScore / 2)),
            },
            rewardReplicaId,
          ),
        );
      });
      setScore(finalScore);
      setComplete(true);
      return;
    }
    setIndex((value) => value + 1);
    setSelected(null);
    answerLocked.current = false;
  }

  return (
    <div ref={dialogRef} className="modal-backdrop challenge-backdrop" role="dialog" aria-modal="true" aria-labelledby="challenge-title" tabIndex={-1}>
      <div className="challenge-shell">
        <header><button className="icon-button inverted" type="button" onClick={onClose} aria-label="Close challenge" data-dialog-initial-focus><X /></button><div><span>Château gate</span><div><i style={{ width: `${(score / progressDenominator) * 100}%` }} /></div></div><span>{score}/{questionCount}</span></header>
        {!current ? (
          <div className="challenge-complete" role="status">
            <div className="completion-seal"><BookOpen aria-hidden="true" /></div>
            <p className="eyebrow">Challenge unavailable</p>
            <h2 id="challenge-title">No learned cards are ready.</h2>
            <p>Return to a regional lesson to add current vocabulary before opening the château gate.</p>
            <button className="primary-button large" type="button" onClick={onClose}>Return to practice</button>
          </div>
        ) : !complete ? <section className="challenge-content" aria-labelledby="challenge-title"><div className="chateau-scene" aria-hidden="true"><div className="moon" /><div className="castle"><span /><span /><span /></div><div className="gate-progress" style={{ "--gate-open": `${Math.min(100, (score / progressDenominator) * 100)}%` } as CSSProperties} /></div><p className="eyebrow">Question {index + 1} of {questionCount}</p><h2 ref={questionHeadingRef} id="challenge-title" tabIndex={-1}>What does <span lang="fr">“{current.french}”</span> mean?</h2><FrenchAudioButton courseId={state.activeCourseId} wordId={current.id} text={current.french} enabled={state.settings.sound} onPlay={() => trackProductEvent(state.settings.analytics, "audio_played", { wordId: current.id })} preloadWords={preloadWords} className="challenge-audio">{({ status: audioStatus }) => <>{audioStatus === "error" ? <X size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />} {audioStatus === "error" ? "Audio unavailable — try again" : "Hear the prompt"}</>}</FrenchAudioButton><div className="answer-options">{options.map((option) => { const chosen = selected === option.id; const correctOption = selected && option.id === current.id; return <button type="button" key={option.id} onClick={() => choose(option.id)} className={correctOption ? "is-correct" : chosen ? "is-wrong" : ""} disabled={Boolean(selected)}><span>{option.english}</span>{correctOption && <Check aria-hidden="true" />}{chosen && !correctOption && <X aria-hidden="true" />}</button>; })}</div>{selected && <div className={`answer-feedback ${isCorrect ? "correct" : "wrong"}`} role="status"><strong>{isCorrect ? "Bien joué!" : `The answer is “${current.english}.”`}</strong><p>{rewardEligible ? (isCorrect ? "The gate opens a little farther." : "This card will return sooner so it can stick.") : "Practice mode leaves XP and review schedules unchanged."}</p><button className="primary-button" type="button" onClick={next}>{index === questionCount - 1 ? "See result" : "Next question"}<ChevronRight aria-hidden="true" /></button></div>}</section> : <div className="challenge-complete" role="status"><div className="completion-seal"><Trophy aria-hidden="true" /></div><p className="eyebrow">Gate opened</p><h2 ref={completionHeadingRef} id="challenge-title" tabIndex={-1}>{score >= 3 ? "Mission complete." : "A brave first attempt."}</h2><p>{rewardEligible ? `You recalled ${score} of ${questionCount} words. Their review schedules are updated.` : `You recalled ${score} of ${questionCount} words in reward-free practice.`}</p><div><Zap aria-hidden="true" /><strong>{rewardEligible ? `+${answerXp + (score >= 3 ? 35 : 12)} XP · +${formatCount(challengeCoins, "coin")}` : "+0 XP · practice only"}</strong></div><button className="primary-button large" type="button" onClick={onClose}>Return to practice</button></div>}
      </div>
    </div>
  );
}

function ModalFrame({ labelId, onClose, className, children }: { labelId: string; onClose: () => void; className?: string; children: ReactNode }) {
  const dialogRef = useDialogLifecycle(onClose);
  return <div ref={dialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}><div className={`modal-card ${className ?? ""}`}><button className="modal-close icon-button" type="button" onClick={onClose} aria-label="Close" data-dialog-initial-focus><X /></button>{children}</div></div>;
}

function ProgressBar({ value, label, light = false }: { value: number; label: string; light?: boolean }) {
  return <div className={`progress-bar ${light ? "is-light" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function EmptyState({ icon: Icon, title, copy, action, onAction }: { icon: LucideIcon; title: string; copy: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span><Icon aria-hidden="true" /></span><h2>{title}</h2><p>{copy}</p>{action && onAction && <button className="primary-button" type="button" onClick={onAction}>{action}</button>}</div>;
}

export function applyUnlocksAndCollectibles(state: LearningState, regionId: string, words: readonly Word[]): LearningState {
  let next = state;
  const regionIndex = REGIONS.findIndex((region) => region.id === regionId);
  const firstLessonNumber = words
    .filter((word) => word.regionId === regionId)
    .reduce<number | null>(
      (earliest, word) =>
        earliest === null ? word.lesson : Math.min(earliest, word.lesson),
      null,
    );
  const firstLessonWords = words.filter(
    (word) =>
      word.regionId === regionId && word.lesson === firstLessonNumber,
  );
  const requiredWords = Math.min(REGION_UNLOCK_WORDS, firstLessonWords.length);
  const learnedInFirstLesson = firstLessonWords.filter(
    (word) => next.wordProgress[word.id],
  ).length;
  const nextRegion = REGIONS[regionIndex + 1];
  if (requiredWords > 0 && learnedInFirstLesson >= requiredWords && nextRegion && !next.unlockedRegionIds.includes(nextRegion.id)) {
    next = { ...next, unlockedRegionIds: [...next.unlockedRegionIds, nextRegion.id] };
  }
  return applyCollectibles(next);
}

function applyCollectibles(state: LearningState): LearningState {
  const earned = SEED_COLLECTIBLES.filter((item) => state.xp >= item.unlockAtXp).map((item) => item.id);
  if (!earned.some((id) => !state.collectibles.includes(id))) return state;
  return { ...state, collectibles: Array.from(new Set([...state.collectibles, ...earned])) };
}

function collectibleDescription(item: { id: string; description: string }): string {
  return item.id === "alpine-badge"
    ? "Unlocked by reaching 1,600 XP across your learning activities."
    : item.description;
}

function buildOptions(word: Word, allWords: readonly Word[]): Word[] {
  const samePartOfSpeech = allWords.filter(
    (item) => item.id !== word.id && item.partOfSpeech === word.partOfSpeech,
  );
  const otherLearnedWords = allWords.filter(
    (item) =>
      item.id !== word.id &&
      item.partOfSpeech !== word.partOfSpeech &&
      !samePartOfSpeech.some((candidate) => candidate.id === item.id),
  );
  const distractors = [...samePartOfSpeech, ...otherLearnedWords].slice(0, 3);
  const options = [word, ...distractors];
  const shift = word.id.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

function dayGreeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
}

function formatDue(value: string): string {
  const difference = new Date(value).getTime() - Date.now();
  if (difference <= 0) return "Ready now";
  const hours = Math.round(difference / (60 * 60 * 1000));
  if (hours < 24) return `in ${formatCount(Math.max(1, hours), "hour")}`;
  const days = Math.round(hours / 24);
  return `in ${formatCount(days, "day")}`;
}

export function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${wordForCount(count, singular, plural)}`;
}

function wordForCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

function wordLabel(count: number): string {
  return wordForCount(count, "word");
}

function formatRemainingWords(count: number): string {
  return `${formatCount(count, "word")} ${count === 1 ? "remains" : "remain"}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
