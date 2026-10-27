import { useEffect, useRef } from "react";
import type { SoundState } from "../lib/gallery-audio.ts";
import type { GallerySound } from "../lib/useGalleryAudio.ts";

// The opened record's player (G02): one code-native Play/Pause button, the
// elapsed and total time and a volume slider, only for a record whose score
// is published and served. Everything else is the honest no-sound copy. The
// time is read from the audio clock and written to the DOM directly, never
// ticked through React; only state changes are announced.

const NOTE: Record<SoundState["kind"], string> = {
  none: "There is no sound for this record yet.",
  unsupported: "Sound is not supported in this browser.",
  ready: "AI-directed generative instrumental",
  rendering: "Preparing sound…",
  playing: "AI-directed generative instrumental",
  paused: "AI-directed generative instrumental",
  ended: "AI-directed generative instrumental",
  failed: "Sound could not start. Try again.",
};
const ANNOUNCE: Partial<Record<SoundState["kind"], string>> = {
  rendering: "Preparing sound",
  playing: "Playing",
  paused: "Paused",
  ended: "Finished",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z" fill="currentColor" />
    </svg>
  );
}

// notHeard: this browser has not played it yet; a paper tag on the hairline
export function RecordPlayer({ sound, notHeard = false }: { sound?: GallerySound; notHeard?: boolean }) {
  const state: SoundState = sound?.state ?? { kind: "none" };
  const time = useRef<HTMLSpanElement>(null);
  const kind = state.kind;
  const note = kind === "failed" && state.reason === "reconnect" ? "Reconnect to listen." : NOTE[kind];
  const timed = kind === "playing" || kind === "paused" || kind === "ended";

  // leaving the player (closing the record, opening its report) stops sound
  const stop = sound?.stop;
  useEffect(() => () => stop?.(), [stop]);

  // the elapsed time, from the audio clock, a few times a second
  useEffect(() => {
    if (!timed || !sound) return;
    const show = () => {
      if (time.current) time.current.textContent = clock(sound.elapsed());
    };
    show();
    if (kind !== "playing") return;
    const timer = setInterval(show, 250);
    return () => clearInterval(timer);
  }, [timed, kind, sound]);

  const label =
    kind === "playing" ? "Pause" : kind === "paused" ? "Resume" : kind === "ended" ? "Play again" : kind === "failed" && state.reason === "error" ? "Try again" : "Listen";
  const enabled = kind === "ready" || kind === "playing" || kind === "paused" || kind === "ended" || (kind === "failed" && state.reason === "error");

  return (
    <div className="record-player" role="group" aria-label="Sound" data-state={kind}>
      {notHeard && <p className="record-tag">Not heard yet</p>}
      <button
        type="button"
        className="player-button"
        disabled={!enabled}
        aria-describedby="player-note"
        aria-busy={kind === "rendering" || undefined}
        onClick={() => (kind === "playing" ? sound?.pause() : sound?.play())}
      >
        {kind === "playing" ? <PauseIcon /> : <PlayIcon />}
        <span className="visually-hidden">{label}</span>
      </button>
      <div className="player-body">
        <p className="player-note" id="player-note">
          {note}
        </p>
        {timed && (
          <div className="player-meta">
            <span className="player-time">
              <span ref={time}>0:00</span> / 0:24
            </span>
            <label className="player-volume">
              <span className="visually-hidden">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                defaultValue={sound?.volume() ?? 0.35}
                onChange={(e) => sound?.setVolume(Number(e.currentTarget.value))}
              />
            </label>
          </div>
        )}
      </div>
      <p className="visually-hidden" role="status">
        {ANNOUNCE[kind] ?? ""}
      </p>
    </div>
  );
}
