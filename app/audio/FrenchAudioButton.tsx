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

export type FrenchAudioButtonProps = {
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
  wordId,
  text,
  enabled,
  className,
  children,
  preloadWords = EMPTY_PRELOAD_WORDS,
  service: suppliedService,
  onPlay,
}: FrenchAudioButtonProps) {
  const service = suppliedService ?? getFrenchAudioService();
  const statusId = useId();
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getServerSnapshot,
  );
  const ownsPlayback = snapshot.wordId === wordId;
  const isPlaying =
    ownsPlayback &&
    (snapshot.status === "playing" || snapshot.status === "loading");
  const isPaused = ownsPlayback && snapshot.status === "paused";
  const preloadRequests = useMemo(
    () => [{ wordId, text }, ...preloadWords],
    [preloadWords, text, wordId],
  );

  useEffect(() => {
    service.setEnabled(enabled);
  }, [enabled, service]);

  useEffect(() => {
    service.preload(preloadRequests);
  }, [preloadRequests, service]);

  useEffect(
    () => () => {
      if (service.getSnapshot().wordId === wordId) service.stop();
    },
    [service, wordId],
  );

  const label = !enabled
    ? `French audio is off for ${text}`
    : isPlaying
      ? `Pause pronunciation of ${text}`
      : isPaused
        ? `Resume pronunciation of ${text}`
        : `Hear pronunciation of ${text}`;
  const statusMessage = !enabled
    ? "French audio is turned off in settings."
    : ownsPlayback
      ? snapshot.message
      : "French pronunciation is ready.";

  const handleClick = () => {
    if (!enabled) return;
    if (isPlaying) {
      service.pause();
    } else if (isPaused) {
      void service.resume();
    } else {
      onPlay?.();
      void service.play({ wordId, text, enabled });
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
      : children ?? (isPlaying ? "Pause French audio" : "Hear it in French");

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
