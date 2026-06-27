import { create } from "zustand";
import { TRACKS } from "../hooks/useBgMusic";

interface AudioState {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  trackId: string;
  toggleMusic: () => void;
  toggleSfx: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  musicEnabled: false,
  sfxEnabled: true,
  trackId: TRACKS[0].id,
  toggleMusic: () => set((s) => ({ musicEnabled: !s.musicEnabled })),
  toggleSfx: () => set((s) => ({ sfxEnabled: !s.sfxEnabled })),
  nextTrack: () => {
    const idx = TRACKS.findIndex((t) => t.id === get().trackId);
    set({ trackId: TRACKS[(idx + 1) % TRACKS.length].id });
  },
  prevTrack: () => {
    const idx = TRACKS.findIndex((t) => t.id === get().trackId);
    set({ trackId: TRACKS[(idx - 1 + TRACKS.length) % TRACKS.length].id });
  },
}));
