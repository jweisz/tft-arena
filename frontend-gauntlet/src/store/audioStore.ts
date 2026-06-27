import { create } from "zustand";

interface AudioState {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  toggleMusic: () => void;
  toggleSfx: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  musicEnabled: false, // user opts in — don't blast music on load
  sfxEnabled: true,
  toggleMusic: () => set((s) => ({ musicEnabled: !s.musicEnabled })),
  toggleSfx: () => set((s) => ({ sfxEnabled: !s.sfxEnabled })),
}));
