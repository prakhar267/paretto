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
  Volume2,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
  REGIONS,
  SEED_COLLECTIBLES,
  SEED_LEADERBOARD,
  WORDS,
  type Region,
  type Word,
} from "./learning-data";
import {
  completeSession,
  dueCount,
  isDue,
  learnedCount,
  levelFromXp,
  localDateKey,
  markWordKnown,
  masteredCount,
  rateWord,
  type LearningState,
  type Rating,
} from "./learning-engine";
import { useProgress, type SyncStatus } from "./use-progress";

type Screen = "today" | "journey" | "review" | "wordbook" | "profile";

type LessonState = {
  mode: "learn" | "review";
  words: Word[];
  regionId: string;
};

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

export default function PasAPasApp({ storageKey }: { storageKey?: string } = {}) {
  const { state, setState, status, ready, savedAt, retry, deleteProgress } =
    useProgress(storageKey);
  const [screen, setScreen] = useState<Screen>("today");
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [showDice, setShowDice] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);

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
  const reviewsDue = dueCount(state);
  const level = levelFromXp(state.xp);

  function startLesson(mode: "learn" | "review", regionId = state.currentRegionId) {
    const regionWords = WORDS.filter((word) => word.regionId === regionId);
    let lessonWords: Word[];

    if (mode === "review") {
      const due = WORDS.filter((word) => {
        const progress = state.wordProgress[word.id];
        return progress && isDue(progress);
      });
      const learned = WORDS.filter((word) => state.wordProgress[word.id]);
      lessonWords = (due.length ? due : learned).slice(0, 5);
    } else {
      const unseen = regionWords.filter((word) => !state.wordProgress[word.id]);
      const familiar = regionWords.filter((word) => state.wordProgress[word.id]);
      lessonWords = [...unseen, ...familiar].slice(0, 5);
    }

    if (!lessonWords.length) lessonWords = regionWords.slice(0, 5);
    setLesson({ mode, words: lessonWords, regionId });
  }

  function finishLesson(
    mode: "learn" | "review",
    regionId: string,
    correct: number,
    words: number,
  ) {
    setState((current) => {
      const completed = completeSession(
        current,
        {
          id: createId("session"),
          mode,
          words,
          correct,
          xpEarned: 18,
        },
        new Date(),
        localDateKey(),
      );
      return applyUnlocksAndCollectibles(completed, regionId);
    });
  }

  if (status === "loading" && !ready) return <LoadingScreen />;
  if (!ready) return <RecoveryScreen status={status} onRetry={retry} />;

  if (!state.onboarded) {
    return (
      <Onboarding
        onComplete={(details) => {
          setState((current) => ({
            ...current,
            ...details,
            onboarded: true,
            updatedAt: new Date().toISOString(),
          }));
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
              onClick={() => setScreen(item.id)}
            />
          ))}
        </nav>

        <div className="rail-spacer" />
        <button
          className={`profile-button ${screen === "profile" ? "is-active" : ""}`}
          onClick={() => setScreen("profile")}
          type="button"
        >
          <span className="avatar avatar-small" aria-hidden="true">
            {initials(state.displayName)}
          </span>
          <span>
            <strong>{state.displayName}</strong>
            <small>Level {level} traveler</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </aside>

      <div className="app-stage">
        <header className="mobile-header">
          <Brand compact />
          <button
            className="icon-button"
            type="button"
            aria-label="Open profile"
            onClick={() => setScreen("profile")}
          >
            <CircleUserRound aria-hidden="true" />
          </button>
        </header>

        <header className="stats-bar" aria-label="Learning status">
          <div className="stats-cluster">
            <StatPill icon={Flame} value={state.streak} label="day streak" tone="coral" />
            <StatPill icon={Zap} value={state.xp} label="total XP" tone="blue" />
            <StatPill icon={Coins} value={state.coins} label="travel coins" tone="gold" />
          </div>
          <SyncPill status={status} savedAt={savedAt} onRetry={retry} />
        </header>

        <main id="main-content" className="main-canvas" tabIndex={-1}>
          {screen === "today" && (
            <TodayScreen
              state={state}
              currentRegion={currentRegion}
              reviewsDue={reviewsDue}
              status={status}
              onStart={() => startLesson("learn")}
              onReview={() => startLesson("review")}
              onJourney={() => setScreen("journey")}
              onOpenWord={(word) => setSelectedWord(word)}
            />
          )}
          {screen === "journey" && (
            <JourneyScreen
              state={state}
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
              reviewsDue={reviewsDue}
              onReview={() => startLesson("review")}
              onChallenge={() => setShowChallenge(true)}
              onDice={() => setShowDice(true)}
              onProfile={() => setScreen("profile")}
            />
          )}
          {screen === "wordbook" && (
            <WordbookScreen
              state={state}
              onOpenWord={(word) => setSelectedWord(word)}
              onStart={() => startLesson("learn")}
            />
          )}
          {screen === "profile" && (
            <ProfileScreen
              state={state}
              setState={setState}
              status={status}
              savedAt={savedAt}
              onRetry={retry}
              onDelete={deleteProgress}
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
                onClick={() => setScreen(item.id)}
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
          onClose={() => setLesson(null)}
          onRate={(wordId, rating) =>
            setState((current) => applyCollectibles(rateWord(current, wordId, rating)))
          }
          onMarkKnown={(wordId) =>
            setState((current) => applyCollectibles(markWordKnown(current, wordId)))
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
          onClose={() => setShowDice(false)}
        />
      )}
      {showChallenge && (
        <ChallengeModal
          state={state}
          setState={setState}
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
        <span>p</span>
      </div>
      <div>
        <strong>Pas à Pas</strong>
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
          Check your connection or sign-in, then try again.
        </p>
        <button className="primary-button large" type="button" onClick={onRetry}>
          <RefreshCw size={18} aria-hidden="true" /> Try again
        </button>
        <small>{status === "offline" ? "You appear to be offline." : "Your existing data remains untouched."}</small>
      </div>
    </main>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        p
      </span>
      <span className="brand-name">
        Pas <em>à</em> Pas
      </span>
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
  onComplete,
}: {
  onComplete: (details: Pick<LearningState, "displayName" | "level" | "dailyGoal">) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LearningState["level"]>("new");
  const [dailyGoal, setDailyGoal] = useState<LearningState["dailyGoal"]>(5);

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
                Remember useful words, hear real pronunciation, and fill a travel
                journal across all 18 regions of France.
              </p>
              <div className="onboarding-points">
                <OnboardingPoint icon={Headphones} text="French audio on every card" />
                <OnboardingPoint icon={RefreshCw} text="Reviews that adapt to your memory" />
                <OnboardingPoint icon={MapPin} text="Vocabulary with genuine regional context" />
              </div>
              <button className="primary-button large" type="button" onClick={() => setStep(1)}>
                Begin the journey <ChevronRight aria-hidden="true" />
              </button>
              <p className="privacy-note">
                <ShieldCheck size={15} aria-hidden="true" /> Private progress, saved to
                your signed-in workspace.
              </p>
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
                });
              }}
            >
              <p className="eyebrow">Make it yours</p>
              <h1 id="welcome-title">Your first stop</h1>
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
                      ["new", "Fresh start", "Bonjour is familiar"],
                      ["some", "Some French", "I know useful basics"],
                      ["returning", "Returning", "I want a gentle restart"],
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

              <button className="primary-button large" type="submit">
                Start in Paris <MapPin aria-hidden="true" />
              </button>
              <button className="text-button" type="button" onClick={() => setStep(0)}>
                Back
              </button>
            </form>
          )}
        </div>

        <div className="onboarding-art" aria-hidden="true">
          <div className="sun-disc" />
          <div className="postcard postcard-back">
            <span>18 régions</span>
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
  currentRegion,
  reviewsDue,
  status,
  onStart,
  onReview,
  onJourney,
  onOpenWord,
}: {
  state: LearningState;
  currentRegion: Region;
  reviewsDue: number;
  status: SyncStatus;
  onStart: () => void;
  onReview: () => void;
  onJourney: () => void;
  onOpenWord: (word: Word) => void;
}) {
  const regionWords = WORDS.filter((word) => word.regionId === currentRegion.id);
  const learnedHere = regionWords.filter((word) => state.wordProgress[word.id]).length;
  const todayWords = state.sessions
    .filter((session) => localDateKey(new Date(session.completedAt)) === localDateKey())
    .reduce((total, session) => total + session.words, 0);
  const goalProgress = Math.min(100, Math.round((todayWords / state.dailyGoal) * 100));
  const recentWord = WORDS.find((word) => state.wordProgress[word.id]);

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
            <strong>Your lesson is saved on this device.</strong>
            <span>It will sync safely when your connection is ready.</span>
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
              <div className="hero-progress-label">
                <span>{learnedHere} of {regionWords.length} words collected</span>
                <strong>{Math.round((learnedHere / regionWords.length) * 100)}%</strong>
              </div>
              <ProgressBar value={(learnedHere / regionWords.length) * 100} light />
              <button className="cream-button" type="button" onClick={onStart}>
                <BookOpen size={19} aria-hidden="true" />
                {learnedHere ? "Continue today’s lesson" : "Learn your first 5 words"}
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="hero-card-art" aria-hidden="true">
              <div className="passport-stamp">{currentRegion.shortLabel.slice(0, 3).toUpperCase()}</div>
              <span className="region-emoji">{currentRegion.emoji}</span>
              <div className="hero-postmark">PAS À PAS · {String(currentRegion.number).padStart(2, "0")}</div>
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
                title={reviewsDue ? `${reviewsDue} reviews are ready` : "Your memory is clear"}
                copy={reviewsDue ? "A short recovery set, never an endless backlog." : "Practice any learned words whenever you like."}
                action={reviewsDue ? "Review now" : "Practice anyway"}
                onClick={onReview}
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
              <p>{Math.max(0, state.dailyGoal - todayWords)} words remain in today’s goal.</p>
            </div>
          </section>

          <section className="mini-stats-card">
            <MiniStat icon={Library} value={learnedCount(state)} label="words seen" />
            <MiniStat icon={Star} value={masteredCount(state)} label="mastered" />
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

function JourneyScreen({
  state,
  onOpenRegion,
  onSelectRegion,
}: {
  state: LearningState;
  onOpenRegion: (region: Region) => void;
  onSelectRegion: (region: Region) => void;
}) {
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
        <p><Info size={15} aria-hidden="true" /> Collect 4 of 5 words to open the next stop.</p>
      </div>

      <ol className="region-route" aria-label="French regional learning journey">
        {REGIONS.map((region, index) => {
          const regionWords = WORDS.filter((word) => word.regionId === region.id);
          const progress = regionWords.filter((word) => state.wordProgress[word.id]).length;
          const unlocked = state.unlockedRegionIds.includes(region.id);
          const current = state.currentRegionId === region.id;
          const completed = progress === regionWords.length;
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
                  <small>{completed ? "Chapter complete" : current ? "Current chapter" : unlocked ? "Ready to explore" : "Keep traveling"}</small>
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
  reviewsDue,
  onReview,
  onChallenge,
  onDice,
  onProfile,
}: {
  state: LearningState;
  reviewsDue: number;
  onReview: () => void;
  onChallenge: () => void;
  onDice: () => void;
  onProfile: () => void;
}) {
  const learned = learnedCount(state);
  const totalCorrect = Object.values(state.wordProgress).reduce((sum, word) => sum + word.correct, 0);
  const totalSeen = Object.values(state.wordProgress).reduce((sum, word) => sum + word.correct + word.incorrect, 0);
  const accuracy = totalSeen ? Math.round((totalCorrect / totalSeen) * 100) : 0;
  const challengeDone = state.challenge.lastPlayedDate === localDateKey();
  const diceDone = state.dice.lastPlayedDate === localDateKey();

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
          <h2 id="review-title">{reviewsDue ? `${reviewsDue} words are ready` : learned ? "Choose a practice round" : "Your first words will appear here"}</h2>
          <p>{reviewsDue ? "We’ll serve at most five now and keep the remaining queue visible." : learned ? "Nothing is overdue. A mixed practice round is still available." : "Complete one regional lesson to build your first review set."}</p>
        </div>
        <button className="primary-button" type="button" onClick={onReview} disabled={!learned}>
          <RefreshCw size={18} aria-hidden="true" /> {reviewsDue ? "Review 5 words" : "Practice 5 words"}
        </button>
      </section>

      <div className="practice-grid">
        <PracticeCard
          icon={MessageCircle}
          tone="night"
          eyebrow="Dialogue mission"
          title="The Château Challenge"
          copy="Answer five vocabulary prompts to open the château gate. No timer, and every question can be read aloud."
          meta={challengeDone ? "Completed today · practice is reward-free" : learned >= 3 ? "Ready · up to 85 XP" : "Learn 3 words to unlock"}
          action={challengeDone ? "Play again for practice" : "Begin challenge"}
          disabled={learned < 3}
          onClick={onChallenge}
        />
        <PracticeCard
          icon={Dices}
          tone="gold"
          eyebrow="Travel dice"
          title="Roll for a route boost"
          copy="Use earned travel coins for a transparent one-in-six XP boost. No purchases, no hidden odds."
          meta={diceDone ? "Today’s reward collected" : `${state.coins} coins available`}
          action={diceDone ? "See today’s result" : "Open the dice"}
          disabled={!learned}
          onClick={onDice}
        />
      </div>

      <section className="mastery-section" aria-labelledby="mastery-title">
        <div className="section-heading-row">
          <div><p className="eyebrow">Seven-stage memory</p><h2 id="mastery-title">A schedule you can understand</h2></div>
          <span>{masteredCount(state)} words solid</span>
        </div>
        <div className="mastery-ladder">
          {MASTERY_STAGE_LABELS.map((label, index) => {
            const count = Object.values(state.wordProgress).filter((word) => word.stage === index).length;
            return <div key={label}><span>{index + 1}</span><strong>{label}</strong><small>{count} words</small></div>;
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
  onOpenWord,
  onStart,
}: {
  state: LearningState;
  onOpenWord: (word: Word) => void;
  onStart: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Word["partOfSpeech"]>("all");
  const [showAll, setShowAll] = useState(false);
  const normalizedQuery = normalizeText(query);

  const visibleWords = useMemo(
    () =>
      WORDS.filter((word) => showAll || state.wordProgress[word.id])
        .filter((word) => filter === "all" || word.partOfSpeech === filter)
        .filter((word) => {
          if (!normalizedQuery) return true;
          return normalizeText(`${word.french} ${word.search} ${word.english}`).includes(normalizedQuery);
        }),
    [filter, normalizedQuery, showAll, state.wordProgress],
  );

  return (
    <div className="screen-page page-enter">
      <header className="page-heading split-heading">
        <div><p className="eyebrow">Personal wordbook</p><h1>Every word has a story.</h1><p>Search French or English, accents optional. Every learned card keeps its gender, sound, example and next review.</p></div>
        <div className="wordbook-count"><Library aria-hidden="true" /><strong>{learnedCount(state)}</strong><span>collected</span></div>
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
        {(["all", "noun", "verb", "pronominal verb", "adjective"] as const).map((value) => (
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
                <span className="word-main"><strong lang="fr">{word.french}</strong>{state.settings.phonetics && <small>{word.ipa}</small>}</span>
                <span className="word-meaning">{word.english}</span>
                <span className="word-meta"><small>{region?.shortLabel}</small><MasteryDots stage={progress?.stage ?? 0} learned={Boolean(progress)} /></span>
                <ChevronRight size={19} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title={query ? "No matching words" : "Your wordbook is ready"} copy={query ? "Try a shorter French or English search." : "Complete a lesson and your first five cards will live here."} action={!query ? "Start a lesson" : undefined} onAction={!query ? onStart : undefined} />
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

function ProfileScreen({
  state,
  setState,
  status,
  savedAt,
  onRetry,
  onDelete,
}: {
  state: LearningState;
  setState: React.Dispatch<React.SetStateAction<LearningState>>;
  status: SyncStatus;
  savedAt: string | null;
  onRetry: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const level = levelFromXp(state.xp);
  const board = useMemo(() => {
    const seeded = SEED_LEADERBOARD.filter((entry) => entry.name !== "You").map((entry) => ({ ...entry, id: `seed-${entry.rank}`, isCurrentUser: false }));
    return [...seeded, { id: "current-user", isCurrentUser: true, rank: 0, name: state.displayName, xp: state.xp, streak: state.streak, avatar: "🧭" }]
      .sort((a, b) => b.xp - a.xp)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }, [state.displayName, state.streak, state.xp]);

  function updateSetting(key: keyof LearningState["settings"], value: boolean) {
    setState((current) => ({ ...current, settings: { ...current.settings, [key]: value }, updatedAt: new Date().toISOString() }));
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pas-a-pas-progress-${localDateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="screen-page page-enter">
      <header className="profile-hero">
        <div className="avatar avatar-large">{initials(state.displayName)}</div>
        <div><p className="eyebrow">Travel profile</p><h1>{state.displayName}</h1><p>Level {level} · {learnedCount(state)} words · {state.unlockedRegionIds.length} regions</p></div>
        <SyncPill status={status} savedAt={savedAt} onRetry={onRetry} />
      </header>

      <div className="profile-grid">
        <div className="profile-main-column">
          <section className="profile-stats" aria-label="Progress statistics">
            <ProfileStat icon={Zap} value={state.xp} label="Total XP" />
            <ProfileStat icon={Flame} value={state.streak} label="Day streak" />
            <ProfileStat icon={Library} value={learnedCount(state)} label="Words" />
            <ProfileStat icon={Medal} value={masteredCount(state)} label="Mastered" />
          </section>

          <section className="league-card" aria-labelledby="league-title">
            <div className="section-heading-row"><div><p className="eyebrow">Weekly travel league</p><h2 id="league-title">Your learning companions</h2></div><Trophy aria-hidden="true" /></div>
            <p className="league-note"><ShieldCheck size={16} aria-hidden="true" /> Friendly sample cohort. No account details are shared with other learners.</p>
            <div className="leaderboard-list">
              {board.map((entry) => (
                <div key={entry.id} className={entry.isCurrentUser ? "is-you" : ""}>
                  <strong className="rank">{entry.rank}</strong>
                  <span className="leader-avatar">{entry.avatar}</span>
                  <span><strong>{entry.name}</strong><small>{entry.streak} day streak</small></span>
                  <strong>{formatNumber(entry.xp)} XP</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="collection-card" aria-labelledby="profile-collection-title">
            <div className="section-heading-row"><div><p className="eyebrow">Carnet collection</p><h2 id="profile-collection-title">Postcards & keepsakes</h2></div><span>{state.collectibles.length}/{SEED_COLLECTIBLES.length}</span></div>
            <div className="collection-grid">
              {SEED_COLLECTIBLES.map((item) => {
                const collected = state.collectibles.includes(item.id);
                return <article key={item.id} className={collected ? "is-collected" : ""}><span aria-hidden="true">{collected ? item.emoji : "?"}</span><div><small>{item.rarity}</small><strong>{item.name}</strong><p>{collected ? item.description : `Unlocks at ${item.unlockAtXp} XP`}</p></div></article>;
              })}
            </div>
          </section>
        </div>

        <aside className="settings-card" aria-labelledby="settings-title">
          <div><p className="eyebrow">Preferences</p><h2 id="settings-title"><Settings size={20} aria-hidden="true" /> Your studio</h2></div>
          <label className="profile-name-field"><span>Display name</span><input value={state.displayName} maxLength={40} onChange={(event) => setState((current) => ({ ...current, displayName: event.target.value, updatedAt: new Date().toISOString() }))} onBlur={() => setState((current) => ({ ...current, displayName: current.displayName.trim() || "Traveler", updatedAt: new Date().toISOString() }))} /></label>
          <SettingToggle label="French audio" copy="Enable pronunciation buttons" checked={state.settings.sound} onChange={(value) => updateSetting("sound", value)} />
          <SettingToggle label="Show IPA" copy="Keep pronunciation guides visible" checked={state.settings.phonetics} onChange={(value) => updateSetting("phonetics", value)} />
          <SettingToggle label="Reduced motion" copy="Remove movement and celebration effects" checked={state.settings.reducedMotion} onChange={(value) => updateSetting("reducedMotion", value)} />
          <SettingToggle label="Session reminders" copy="Coming soon" checked={false} onChange={() => undefined} disabled />

          <div className="beta-pass"><Sparkles aria-hidden="true" /><div><strong>Founding traveler</strong><span>All lessons and practice modes are unlocked during beta.</span></div></div>
          <div className="privacy-summary"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Your learning data stays private</strong><span>Progress is tied to a protected account key, cached on this device for offline safety, and never used for ads.</span><a href="/privacy">Read privacy &amp; retention details</a></div></div>
          <button className="secondary-button full" type="button" onClick={exportProgress}><Download size={17} aria-hidden="true" /> Export my progress</button>
          {!confirmReset ? (
            <button className="danger-text-button" type="button" onClick={() => setConfirmReset(true)}>Delete my learning data</button>
          ) : (
            <div className="reset-confirm" role="alert"><strong>Delete all learning data?</strong><p>This permanently removes the server record and this device’s offline copy.</p><div><button type="button" onClick={() => setConfirmReset(false)} disabled={deleting}>Cancel</button><button type="button" disabled={deleting} onClick={async () => { setDeleting(true); const deleted = await onDelete(); if (!deleted) setDeleting(false); }}>{deleting ? "Deleting…" : "Delete permanently"}</button></div></div>
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
  onClose,
  onRate,
  onMarkKnown,
  onComplete,
}: {
  lesson: LessonState;
  state: LearningState;
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
  const dialogRef = useDialogLifecycle(onClose);

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
              <div className="lesson-meta"><span>{lesson.mode === "learn" ? "Discover" : "Recall"}</span><span>{region.shortLabel}</span></div>
              <article className={`flash-card ${revealed ? "is-revealed" : ""}`}>
                <span className="flash-emoji" aria-hidden="true">{word.emoji}</span>
                <span className="pos-chip">{word.partOfSpeech}</span>
                <h1 id="lesson-title" lang="fr">{word.french}</h1>
                {state.settings.phonetics && <p className="ipa">{word.ipa}</p>}
                <button className="audio-button" type="button" onClick={() => speakFrench(word.french)} disabled={!state.settings.sound}><Volume2 size={19} aria-hidden="true" /> Hear it in French</button>
                {!revealed ? (
                  <div className="recall-prompt"><p>{lesson.mode === "review" ? "Say the meaning—and the article for nouns—before revealing it." : "Notice the sound and article. What do you think it means?"}</p><button className="primary-button large" type="button" onClick={() => setRevealed(true)}>Reveal the card</button>{lesson.mode === "learn" && !state.wordProgress[word.id] && <button className="text-button" type="button" onClick={markKnownAndAdvance}><Check size={16} aria-hidden="true" /> I already know this</button>}</div>
                ) : (
                  <div className="answer-panel" aria-live="polite"><strong>{word.english}</strong>{word.gender && <span className="gender-chip">{word.gender}</span>}<blockquote><p lang="fr">{word.exampleFr}</p><footer>{word.exampleEn}</footer></blockquote><p className="rating-prompt">How did that feel?</p><div className="rating-grid"><button className="rate-again" type="button" onClick={() => advance("again")}><strong>Again</strong><small>10 min</small></button><button className="rate-hard" type="button" onClick={() => advance("hard")}><strong>Almost</strong><small>Later today</small></button><button className="rate-good" type="button" onClick={() => advance("good")}><strong>Got it</strong><small>Build the interval</small></button></div></div>
                )}
              </article>
            </section>
          </>
        ) : (
          <div className="lesson-complete" role="status">
            <div className="completion-seal"><Check aria-hidden="true" /></div>
            <p className="eyebrow">Session complete</p>
            <h1 id="lesson-title">Très bien, {state.displayName}.</h1>
            <p>You showed up, recalled {correct} of {lesson.words.length}, and moved your regional route forward.</p>
            <div className="completion-stats"><div><Zap aria-hidden="true" /><strong>+{sessionXp + 18}</strong><span>XP</span></div><div><Coins aria-hidden="true" /><strong>+{sessionCoins + Math.max(1, Math.floor(correct / 2))}</strong><span>coins</span></div><div><Flame aria-hidden="true" /><strong>{Math.max(1, state.streak)}</strong><span>day streak</span></div></div>
            <div className="completion-note"><Sparkles aria-hidden="true" /><span>Your progress is safe on this device and queued for cloud sync.</span></div>
            <button className="primary-button large" type="button" onClick={onClose}>Back to today <ChevronRight aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function WordModal({ word, state, onClose }: { word: Word; state: LearningState; onClose: () => void }) {
  const progress = state.wordProgress[word.id];
  const region = REGIONS.find((item) => item.id === word.regionId);
  return (
    <ModalFrame labelId="word-modal-title" onClose={onClose} className="word-modal">
      <div className="word-modal-top" style={{ background: region?.accentColor }}><span aria-hidden="true">{word.emoji}</span><small>{region?.name}</small></div>
      <div className="word-modal-body">
        <div className="modal-title-row"><div><span className="pos-chip">{word.partOfSpeech}</span><h2 id="word-modal-title" lang="fr">{word.french}</h2>{state.settings.phonetics && <p>{word.ipa}</p>}</div><button className="audio-circle" type="button" aria-label={`Hear ${word.french}`} onClick={() => speakFrench(word.french)} disabled={!state.settings.sound}><Volume2 /></button></div>
        <div className="meaning-row"><strong>{word.english}</strong>{word.gender && <span>{word.gender}</span>}</div>
        <blockquote className="example-card"><MessageCircle size={18} aria-hidden="true" /><p lang="fr">{word.exampleFr}</p><footer>{word.exampleEn}</footer></blockquote>
        <div className="mastery-detail"><div><span>Memory stage</span><strong>{progress ? MASTERY_STAGE_LABELS[progress.stage] : "Not learned yet"}</strong></div><MasteryDots stage={progress?.stage ?? 0} learned={Boolean(progress)} /></div>
        {progress && <div className="next-review"><Clock3 size={17} aria-hidden="true" /><span>Next review</span><strong>{formatDue(progress.nextReviewAt)}</strong></div>}
      </div>
    </ModalFrame>
  );
}

function RegionModal({ region, state, onClose, onStart, onOpenWord }: { region: Region; state: LearningState; onClose: () => void; onStart: () => void; onOpenWord: (word: Word) => void }) {
  const regionWords = WORDS.filter((word) => word.regionId === region.id);
  const count = regionWords.filter((word) => state.wordProgress[word.id]).length;
  return (
    <ModalFrame labelId="region-modal-title" onClose={onClose} className="region-modal">
      <div className="region-modal-hero" style={{ background: region.accentColor }}><span className="region-number">Stop {String(region.number).padStart(2, "0")}</span><span className="region-big-emoji" aria-hidden="true">{region.emoji}</span><h2 id="region-modal-title">{region.name}</h2><p>{region.theme}</p></div>
      <div className="region-modal-body"><p className="culture-note">{region.cultureNote}</p><div className="hero-progress-label"><span>{count} of {regionWords.length} words collected</span><strong>{Math.round((count / regionWords.length) * 100)}%</strong></div><ProgressBar value={(count / regionWords.length) * 100} /><div className="region-word-preview">{regionWords.map((word) => <button type="button" key={word.id} onClick={() => onOpenWord(word)}><span>{word.emoji}</span><span><strong lang="fr">{word.french}</strong><small>{state.wordProgress[word.id] ? word.english : "Ready to discover"}</small></span><ChevronRight size={17} /></button>)}</div><button className="primary-button large full" type="button" onClick={onStart}><BookOpen size={18} /> {count ? "Continue this chapter" : "Start this chapter"}</button></div>
    </ModalFrame>
  );
}

function DiceModal({ state, setState, onClose }: { state: LearningState; setState: React.Dispatch<React.SetStateAction<LearningState>>; onClose: () => void }) {
  const [stake, setStake] = useState<1 | 3 | 5>(1);
  const [result, setResult] = useState<{ multiplier: number; xp: number } | null>(null);
  const doneToday = state.dice.lastPlayedDate === localDateKey();
  const multipliers = [0.5, 1, 1.25, 1.5, 2, 3];

  function roll() {
    if (doneToday || state.coins < stake) return;
    const multiplier = multipliers[Math.floor(Math.random() * multipliers.length)];
    const xp = Math.round(12 * stake * multiplier);
    setResult({ multiplier, xp });
    setState((current) => applyCollectibles({ ...current, coins: current.coins - stake, xp: current.xp + xp, dice: { lastPlayedDate: localDateKey() }, updatedAt: new Date().toISOString() }));
  }

  return (
    <ModalFrame labelId="dice-title" onClose={onClose} className="dice-modal">
      <div className="dice-heading"><span><Dices aria-hidden="true" /></span><div><p className="eyebrow">Travel dice</p><h2 id="dice-title">A little route boost</h2><p>Six equal outcomes: ×0.5, ×1, ×1.25, ×1.5, ×2 or ×3 XP. Only earned coins are used.</p></div></div>
      {doneToday && !result ? <div className="done-panel"><Check aria-hidden="true" /><strong>Today’s roll is complete</strong><p>Come back tomorrow after another small French step.</p></div> : result ? <div className="dice-result" role="status"><div className="rolling-die">{result.multiplier}×</div><p className="eyebrow">Route boost</p><h3>+{result.xp} XP</h3><p>Your {stake} travel coin{stake > 1 ? "s" : ""} turned into a memory boost.</p><button className="primary-button full" type="button" onClick={onClose}>Collect reward</button></div> : <><div className="coin-balance"><Coins aria-hidden="true" /><span>Available</span><strong>{state.coins} coins</strong></div><div className="stake-grid">{([1, 3, 5] as const).map((value) => <button type="button" key={value} className={stake === value ? "is-active" : ""} onClick={() => setStake(value)} disabled={state.coins < value}><Coins size={18} /><strong>{value}</strong><span>coin{value > 1 ? "s" : ""}</span></button>)}</div><p className="odds-note"><Info size={15} /> Every face is equally likely. Base learning XP is never at risk.</p><button className="primary-button large full" type="button" onClick={roll} disabled={state.coins < stake}><Dices size={19} /> Roll the dice</button></>}
    </ModalFrame>
  );
}

function ChallengeModal({ state, setState, onClose }: { state: LearningState; setState: React.Dispatch<React.SetStateAction<LearningState>>; onClose: () => void }) {
  const learnedWords = WORDS.filter((word) => state.wordProgress[word.id]);
  const questions = [...learnedWords, ...WORDS.filter((word) => !state.wordProgress[word.id])].slice(0, 5);
  const rewardEligible = state.challenge.lastPlayedDate !== localDateKey();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answerXp, setAnswerXp] = useState(0);
  const [complete, setComplete] = useState(false);
  const current = questions[index];
  const options = useMemo(() => buildOptions(current, WORDS), [current]);
  const isCorrect = selected === current.id;
  const dialogRef = useDialogLifecycle(onClose);

  function choose(id: string) {
    if (selected) return;
    setSelected(id);
    const correct = id === current.id;
    if (correct) setScore((value) => value + 1);
    if (rewardEligible) {
      setAnswerXp((value) => value + (correct ? 10 : 2));
      setState((progress) => applyCollectibles(rateWord(progress, current.id, correct ? "good" : "again")));
    }
  }

  function next() {
    if (index === questions.length - 1) {
      const finalScore = score;
      const bonusXp = finalScore >= 3 ? 35 : 12;
      setState((progress) => {
        if (!rewardEligible) {
          return { ...progress, challenge: { ...progress.challenge, bestScore: Math.max(progress.challenge.bestScore, finalScore) }, updatedAt: new Date().toISOString() };
        }
        return applyCollectibles(completeSession({ ...progress, challenge: { lastPlayedDate: localDateKey(), bestScore: Math.max(progress.challenge.bestScore, finalScore) } }, { id: createId("challenge"), mode: "challenge", words: questions.length, correct: finalScore, xpEarned: bonusXp }));
      });
      setComplete(true);
      return;
    }
    setIndex((value) => value + 1);
    setSelected(null);
  }

  return (
    <div ref={dialogRef} className="modal-backdrop challenge-backdrop" role="dialog" aria-modal="true" aria-labelledby="challenge-title" tabIndex={-1}>
      <div className="challenge-shell">
        <header><button className="icon-button inverted" type="button" onClick={onClose} aria-label="Close challenge" data-dialog-initial-focus><X /></button><div><span>Château gate</span><div><i style={{ width: `${(score / questions.length) * 100}%` }} /></div></div><span>{score}/{questions.length}</span></header>
        {!complete ? <section className="challenge-content" aria-labelledby="challenge-title"><div className="chateau-scene" aria-hidden="true"><div className="moon" /><div className="castle"><span /><span /><span /></div><div className="gate-progress" style={{ "--gate-open": `${Math.min(100, score * 20)}%` } as CSSProperties} /></div><p className="eyebrow">Question {index + 1} of {questions.length}</p><h2 id="challenge-title">What does <span lang="fr">“{current.french}”</span> mean?</h2><button className="challenge-audio" type="button" onClick={() => speakFrench(current.french)} disabled={!state.settings.sound}><Volume2 size={18} /> Hear the prompt</button><div className="answer-options">{options.map((option) => { const chosen = selected === option.id; const correctOption = selected && option.id === current.id; return <button type="button" key={option.id} onClick={() => choose(option.id)} className={correctOption ? "is-correct" : chosen ? "is-wrong" : ""} disabled={Boolean(selected)}><span>{option.english}</span>{correctOption && <Check />}{chosen && !correctOption && <X />}</button>; })}</div>{selected && <div className={`answer-feedback ${isCorrect ? "correct" : "wrong"}`} role="status"><strong>{isCorrect ? "Bien joué!" : `The answer is “${current.english}.”`}</strong><p>{rewardEligible ? (isCorrect ? "The gate opens a little farther." : "This card will return sooner so it can stick.") : "Practice mode leaves XP and review schedules unchanged."}</p><button className="primary-button" type="button" onClick={next}>{index === questions.length - 1 ? "See result" : "Next question"}<ChevronRight /></button></div>}</section> : <div className="challenge-complete"><div className="completion-seal"><Trophy /></div><p className="eyebrow">Gate opened</p><h2 id="challenge-title">{score >= 3 ? "Mission complete." : "A brave first attempt."}</h2><p>{rewardEligible ? `You recalled ${score} of ${questions.length} words. Their review schedules are updated.` : `You recalled ${score} of ${questions.length} words in reward-free practice.`}</p><div><Zap /><strong>{rewardEligible ? `+${answerXp + (score >= 3 ? 35 : 12)} XP · +${score + Math.max(1, Math.floor(score / 2))} coins` : "+0 XP · practice only"}</strong></div><button className="primary-button large" type="button" onClick={onClose}>Return to practice</button></div>}
      </div>
    </div>
  );
}

function ModalFrame({ labelId, onClose, className, children }: { labelId: string; onClose: () => void; className?: string; children: ReactNode }) {
  const dialogRef = useDialogLifecycle(onClose);
  return <div ref={dialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}><div className={`modal-card ${className ?? ""}`}><button className="modal-close icon-button" type="button" onClick={onClose} aria-label="Close" data-dialog-initial-focus><X /></button>{children}</div></div>;
}

function ProgressBar({ value, light = false }: { value: number; light?: boolean }) {
  return <div className={`progress-bar ${light ? "is-light" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function EmptyState({ icon: Icon, title, copy, action, onAction }: { icon: LucideIcon; title: string; copy: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span><Icon aria-hidden="true" /></span><h2>{title}</h2><p>{copy}</p>{action && onAction && <button className="primary-button" type="button" onClick={onAction}>{action}</button>}</div>;
}

function applyUnlocksAndCollectibles(state: LearningState, regionId: string): LearningState {
  let next = state;
  const regionIndex = REGIONS.findIndex((region) => region.id === regionId);
  const learnedInRegion = WORDS.filter((word) => word.regionId === regionId && next.wordProgress[word.id]).length;
  const nextRegion = REGIONS[regionIndex + 1];
  if (learnedInRegion >= 4 && nextRegion && !next.unlockedRegionIds.includes(nextRegion.id)) {
    next = { ...next, unlockedRegionIds: [...next.unlockedRegionIds, nextRegion.id] };
  }
  return applyCollectibles(next);
}

function applyCollectibles(state: LearningState): LearningState {
  const earned = SEED_COLLECTIBLES.filter((item) => state.xp >= item.unlockAtXp).map((item) => item.id);
  if (!earned.some((id) => !state.collectibles.includes(id))) return state;
  return { ...state, collectibles: Array.from(new Set([...state.collectibles, ...earned])) };
}

function buildOptions(word: Word, allWords: readonly Word[]): Word[] {
  const distractors = allWords.filter((item) => item.id !== word.id && item.partOfSpeech === word.partOfSpeech).slice(0, 3);
  const options = [word, ...distractors];
  const shift = word.id.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

function speakFrench(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 0.86;
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith("fr"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
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
  if (hours < 24) return `in ${Math.max(1, hours)} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
