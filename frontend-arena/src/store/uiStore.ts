import { create } from "zustand";

export type ColorPalette =
  | "premium-dark"
  | "retro-crt"
  | "minimal-light"
  | "midnight-purple"
  | "ocean-breeze"
  | "sunset-glow";
export type ThemeFont =
  | "modern"
  | "rounded"
  | "classic"
  | "serif"
  | "monospace"
  | "terminal-retro"
  | "terminal-modern"
  | "code-modern"
  | "hack"
  | "iosevka"
  | "fira-mono"
  | "mononoki"
  | "victor-mono";
export type AgentStatus = "Idle" | "Thinking" | "Speaking" | "Queued";

const THEME_STORAGE_KEY = "tft-arena.theme.palette";
const FONT_STORAGE_KEY = "tft-arena.theme.font";
const AGENT_AUDIO_STORAGE_KEY = "tft-arena.audio.agent-enabled";

const VALID_PALETTES: ColorPalette[] = [
  "premium-dark",
  "retro-crt",
  "minimal-light",
  "midnight-purple",
  "ocean-breeze",
  "sunset-glow",
];

const VALID_FONTS: ThemeFont[] = [
  "modern",
  "rounded",
  "classic",
  "serif",
  "monospace",
  "terminal-retro",
  "terminal-modern",
  "code-modern",
  "hack",
  "iosevka",
  "fira-mono",
  "mononoki",
  "victor-mono",
];

const getStoredPalette = (): ColorPalette => {
  if (typeof window === "undefined") {
    return "premium-dark";
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return VALID_PALETTES.includes(stored as ColorPalette)
    ? (stored as ColorPalette)
    : "premium-dark";
};

const getStoredFont = (): ThemeFont => {
  if (typeof window === "undefined") {
    return "modern";
  }
  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  return VALID_FONTS.includes(stored as ThemeFont)
    ? (stored as ThemeFont)
    : "modern";
};

const getStoredAgentAudioEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }
  const stored = window.localStorage.getItem(AGENT_AUDIO_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  return stored === "true";
};

interface UIState {
  palette: ColorPalette;
  themeFont: ThemeFont;
  agentAudioEnabled: boolean;
  isSettingsOpen: boolean;
  isProfileOpen: boolean;
  isAgentManagerOpen: boolean;
  generationInProgress: boolean;
  agentsRefreshKey: number;
  setPalette: (palette: ColorPalette) => void;
  setThemeFont: (font: ThemeFont) => void;
  setAgentAudioEnabled: (enabled: boolean) => void;
  toggleSettings: () => void;
  toggleProfile: () => void;
  toggleAgentManager: () => void;
  triggerAgentsRefresh: () => void;
  setGenerationInProgress: (inProgress: boolean) => void;
  streamingAgents: Set<string>;
  updateStreamingAgents: (agents: Set<string>) => void;
  agentStatuses: Record<string, AgentStatus>;
  agentBudgets: Record<string, number>;
  agentActivity: Record<string, number>;
  updateAgentStatus: (agentName: string, status: AgentStatus) => void;
  updateAgentBudget: (agentName: string, budget: number) => void;
  setAllBudgets: (budgets: Record<string, number>) => void;
  setAgentActivity: (activity: Record<string, number>) => void;
  latencyHistory: Record<string, number[]>;
  addLatencyPoints: (
    points: Array<{ agent_name: string; latency_ms: number }>,
  ) => void;
  agentScores: Record<string, number>;
  setAgentScores: (scores: Record<string, number>) => void;
  updateAgentScore: (agentName: string, score: number) => void;
  agentReasons: Record<string, string>;
  setAgentReasons: (reasons: Record<string, string>) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  palette: getStoredPalette(),
  themeFont: getStoredFont(),
  agentAudioEnabled: getStoredAgentAudioEnabled(),
  isSettingsOpen: false,
  isProfileOpen: false,
  isAgentManagerOpen: false,
  generationInProgress: false,
  agentsRefreshKey: 0,
  setPalette: (palette: ColorPalette) => {
    document.documentElement.setAttribute("data-theme", palette);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, palette);
    }
    set({ palette });
  },
  setThemeFont: (themeFont: ThemeFont) => {
    document.documentElement.setAttribute("data-font", themeFont);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FONT_STORAGE_KEY, themeFont);
    }
    set({ themeFont });
  },
  setAgentAudioEnabled: (agentAudioEnabled: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        AGENT_AUDIO_STORAGE_KEY,
        String(agentAudioEnabled),
      );
    }
    set({ agentAudioEnabled });
  },
  toggleSettings: () =>
    set((state: UIState) => ({ isSettingsOpen: !state.isSettingsOpen })),
  toggleProfile: () =>
    set((state: UIState) => ({ isProfileOpen: !state.isProfileOpen })),
  toggleAgentManager: () =>
    set((state: UIState) => ({
      isAgentManagerOpen: !state.isAgentManagerOpen,
    })),
  triggerAgentsRefresh: () =>
    set((state: UIState) => ({ agentsRefreshKey: state.agentsRefreshKey + 1 })),
  setGenerationInProgress: (generationInProgress) =>
    set({ generationInProgress }),
  streamingAgents: new Set(),
  updateStreamingAgents: (streamingAgents: Set<string>) =>
    set({ streamingAgents }),
  agentStatuses: {},
  agentBudgets: {},
  agentActivity: {},
  latencyHistory: {},
  updateAgentStatus: (agentName, status) =>
    set((state) => ({
      agentStatuses: { ...state.agentStatuses, [agentName]: status },
    })),
  updateAgentBudget: (agentName, budget) =>
    set((state) => ({
      agentBudgets: { ...state.agentBudgets, [agentName]: budget },
    })),
  setAllBudgets: (budgets) => set({ agentBudgets: budgets }),
  setAgentActivity: (agentActivity) => set({ agentActivity }),
  addLatencyPoints: (points) =>
    set((state) => {
      const nextHistory = { ...state.latencyHistory };
      points.forEach((p) => {
        if (!nextHistory[p.agent_name]) nextHistory[p.agent_name] = [];
        nextHistory[p.agent_name] = [
          ...nextHistory[p.agent_name],
          p.latency_ms,
        ];
      });
      return { latencyHistory: nextHistory };
    }),
  agentScores: {},
  setAgentScores: (agentScores) => set({ agentScores }),
  updateAgentScore: (agentName, score) =>
    set((state) => ({
      agentScores: { ...state.agentScores, [agentName]: score },
    })),
  agentReasons: {},
  setAgentReasons: (agentReasons) => set({ agentReasons }),
}));
