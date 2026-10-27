import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "./api.ts";
import { createGalleryAudio, type GalleryAudio, type SoundState } from "./gallery-audio.ts";
import { getScore, type PublicArtifact } from "./gallery-api.ts";

// The page's one player, bridged to React: it follows the opened record,
// the server's music flag and the Gallery connection, and stops on hiding
// the tab or leaving the page. Only coarse player states live in React; the
// elapsed time is read from the audio clock by the control that shows it.

export type GallerySound = {
  state: SoundState;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
  volume: () => number;
  elapsed: () => number;
};

export function useGalleryAudio(selected: PublicArtifact | null, musicEnabled: boolean, connected: boolean): GallerySound {
  const [state, setState] = useState<SoundState>({ kind: "none" });
  const [player, setPlayer] = useState<GalleryAudio | null>(null);

  // created on mount (no context, module or PCM until a Play), disposed on leaving
  useEffect(() => {
    const p = createGalleryAudio({
      fetchScore: (id, signal) => getScore(id, signal),
      loadSynth: () => import("./gallery-synth.ts"),
      onState: setState,
      isGone: (err) => err instanceof ApiError && err.status === 404,
    });
    setPlayer(p);
    return () => p.dispose();
  }, []);

  const id = selected?.id ?? null;
  const version = selected?.version ?? 0;
  const ready = musicEnabled && selected?.music?.status === "ready";
  useEffect(() => {
    player?.select(id ? { id, version, ready } : null);
  }, [player, id, version, ready]);

  useEffect(() => {
    player?.setConnected(connected);
  }, [player, connected]);

  // backgrounding stops it; coming back never resumes on its own
  useEffect(() => {
    if (!player) return;
    const hidden = () => {
      if (document.visibilityState === "hidden") player.stop();
    };
    const leave = () => player.stop();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    };
  }, [player]);

  const play = useCallback(() => player?.play(), [player]);
  const pause = useCallback(() => player?.pause(), [player]);
  const stop = useCallback(() => player?.stop(), [player]);
  const setVolume = useCallback((v: number) => player?.setVolume(v), [player]);
  const volume = useCallback(() => player?.volume() ?? 0.35, [player]);
  const elapsed = useCallback(() => player?.elapsed() ?? 0, [player]);

  return useMemo(() => ({ state, play, pause, stop, setVolume, volume, elapsed }), [state, play, pause, stop, setVolume, volume, elapsed]);
}
