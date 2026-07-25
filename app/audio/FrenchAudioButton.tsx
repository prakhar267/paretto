"use client";

import {
  useEffect,
  useId,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  getFrenchAudioService,
  type FrenchAudioPreloadRequest,
  type FrenchAudioService,
  type FrenchAudioSource,
  type FrenchAudioStatus,
} from "./french-audio-service";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  type CourseId,
} from "../course-catalog";

export type FrenchAudioButtonProps = {
  courseId?: CourseId;
  wordId: string;
  text: string;
  enabled: boolean;
  className?: string;
  children?:
    | ReactNode
    | ((state: {
        isPlaying: boolean;
        isPaused: boolean;
        status: FrenchAudioStatus;
        source: FrenchAudioSource | "none";
      }) => ReactNode);
  preloadWords?: readonly FrenchAudioPreloadRequest[];
  service?: FrenchAudioService;
  onPlay?: () => void;
};

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

const EMPTY_PRELOAD_WORDS: readonly FrenchAudioPreloadRequest[] = [];

export function FrenchAudioButton({
  courseId: suppliedCourseId,
  wordId,
  text,
  enabled,
  className,
  children,
  preloadWords = EMPTY_PRELOAD_WORDS,
  service: suppliedService,
  onPlay,
}: FrenchAudioButtonProps) {
  const courseId: CourseId = suppliedCourseId ?? DEFAULT_COURSE_ID;
  const course = COURSE_CATALOG[courseId];
  const service = suppliedService ?? getFrenchAudioService();
  const statusId = useId();
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getServerSnapshot,
  );
  const ownsPlayback =
    snapshot.wordId === wordId &&
    (snapshot.courseId ?? DEFAULT_COURSE_ID) === courseId;
  const isPlaying =
    ownsPlayback &&
    (snapshot.status === "playing" || snapshot.status === "loading");
  const isPaused = ownsPlayback && snapshot.status === "paused";
  const preloadRequests = useMemo<FrenchAudioPreloadRequest[]>(
    () => [
      { courseId, wordId, text },
      ...preloadWords.map<FrenchAudioPreloadRequest>((request) => ({
        courseId: (request.courseId ?? courseId) as CourseId,
        wordId: request.wordId,
        text: request.text,
      })),
    ],
    [courseId, preloadWords, text, wordId],
  );

  useEffect(() => {
    service.setEnabled(enabled);
  }, [enabled, service]);

  useEffect(() => {
    service.preload(preloadRequests);
  }, [preloadRequests, service]);

  useEffect(
    () => () => {
      const current = service.getSnapshot();
      if (
        current.wordId === wordId &&
        (current.courseId ?? DEFAULT_COURSE_ID) === courseId
      ) {
        service.stop();
      }
    },
    [courseId, service, wordId],
  );

  const label = !enabled
    ? `${course.targetLanguageName} audio is off for ${text}`
    : isPlaying
      ? `Pause pronunciation of ${text}`
      : isPaused
        ? `Resume pronunciation of ${text}`
        : `Hear pronunciation of ${text}`;
  const statusMessage = !enabled
    ? `${course.targetLanguageName} audio is turned off in settings.`
    : ownsPlayback
      ? snapshot.message
      : `${course.targetLanguageName} pronunciation is ready.`;

  const handleClick = () => {
    if (!enabled) return;
    if (isPlaying) {
      service.pause();
    } else if (isPaused) {
      void service.resume();
    } else {
      onPlay?.();
      void service.play({ courseId, wordId, text, enabled });
    }
  };
  const content =
    typeof children === "function"
      ? children({
          isPlaying,
          isPaused,
          status: ownsPlayback ? snapshot.status : "idle",
          source: ownsPlayback ? (snapshot.source ?? "none") : "none",
        })
      : children ??
        (isPlaying
          ? `Pause ${course.targetLanguageName} audio`
          : `Hear it in ${course.targetLanguageName}`);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={!enabled}
        aria-label={label}
        aria-describedby={statusId}
        aria-pressed={isPlaying}
        data-audio-status={ownsPlayback ? snapshot.status : "idle"}
        data-audio-source={ownsPlayback ? (snapshot.source ?? "none") : "none"}
      >
        {content}
      </button>
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={visuallyHidden}
      >
        {statusMessage}
      </span>
    </>
  );
}
