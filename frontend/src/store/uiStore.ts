import { create } from 'zustand'

export type ColorPalette = 'premium-dark' | 'retro-crt' | 'minimal-light' | 'midnight-purple' | 'ocean-breeze' | 'sunset-glow';
export type ThemeFont = 'modern' | 'monospace' | 'classic' | 'serif' | 'rounded';

interface UIState {
  palette: ColorPalette;
  themeFont: ThemeFont;
  isSettingsOpen: boolean;
  isProfileOpen: boolean;
  isAgentManagerOpen: boolean;
  agentsRefreshKey: number;
  setPalette: (palette: ColorPalette) => void;
  setThemeFont: (font: ThemeFont) => void;
  toggleSettings: () => void;
  toggleProfile: () => void;
  toggleAgentManager: () => void;
  triggerAgentsRefresh: () => void;
  streamingAgents: Set<string>;
  updateStreamingAgents: (agents: Set<string>) => void;
  agentStatuses: Record<string, 'Idle' | 'Thinking' | 'Speaking' | 'Queued'>;
  agentBudgets: Record<string, number>;
  agentActivity: Record<string, number>;
  updateAgentStatus: (agentName: string, status: 'Idle' | 'Thinking' | 'Speaking' | 'Queued') => void;
  updateAgentBudget: (agentName: string, budget: number) => void;
  setAllBudgets: (budgets: Record<string, number>) => void;
  setAgentActivity: (activity: Record<string, number>) => void;
  latencyHistory: Record<string, number[]>;
  addLatencyPoints: (points: Array<{ agent_name: string; latency_ms: number }>) => void;
  agentScores: Record<string, number>;
  setAgentScores: (scores: Record<string, number>) => void;
  updateAgentScore: (agentName: string, score: number) => void;
  agentReasons: Record<string, string>;
  setAgentReasons: (reasons: Record<string, string>) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  palette: 'premium-dark',
  themeFont: 'modern',
  isSettingsOpen: false,
  isProfileOpen: false,
  isAgentManagerOpen: false,
  agentsRefreshKey: 0,
  setPalette: (palette: ColorPalette) => {
    document.documentElement.setAttribute('data-theme', palette);
    set({ palette });
  },
  setThemeFont: (themeFont: ThemeFont) => {
    document.documentElement.setAttribute('data-font', themeFont);
    set({ themeFont });
  },
  toggleSettings: () => set((state: UIState) => ({ isSettingsOpen: !state.isSettingsOpen })),
  toggleProfile: () => set((state: UIState) => ({ isProfileOpen: !state.isProfileOpen })),
  toggleAgentManager: () => set((state: UIState) => ({ isAgentManagerOpen: !state.isAgentManagerOpen })),
  triggerAgentsRefresh: () => set((state: UIState) => ({ agentsRefreshKey: state.agentsRefreshKey + 1 })),
  streamingAgents: new Set(),
  updateStreamingAgents: (streamingAgents: Set<string>) => set({ streamingAgents }),
  agentStatuses: {},
  agentBudgets: {},
  agentActivity: {},
  latencyHistory: {},
  updateAgentStatus: (agentName, status) => set((state) => ({
    agentStatuses: { ...state.agentStatuses, [agentName]: status }
  })),
  updateAgentBudget: (agentName, budget) => set((state) => ({
    agentBudgets: { ...state.agentBudgets, [agentName]: budget }
  })),
  setAllBudgets: (budgets) => set({ agentBudgets: budgets }),
  setAgentActivity: (agentActivity) => set({ agentActivity }),
  addLatencyPoints: (points) => set((state) => {
    const nextHistory = { ...state.latencyHistory };
    points.forEach(p => {
      if (!nextHistory[p.agent_name]) nextHistory[p.agent_name] = [];
      nextHistory[p.agent_name] = [...nextHistory[p.agent_name], p.latency_ms];
    });
    return { latencyHistory: nextHistory };
  }),
  agentScores: {},
  setAgentScores: (agentScores) => set({ agentScores }),
  updateAgentScore: (agentName, score) => set((state) => ({
    agentScores: { ...state.agentScores, [agentName]: score }
  })),
  agentReasons: {},
  setAgentReasons: (agentReasons) => set({ agentReasons }),
}))
