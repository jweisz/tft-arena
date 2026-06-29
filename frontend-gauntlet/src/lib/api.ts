import { withAuthHeaders } from "./auth";

const defaultBase = `${window.location.protocol}//${window.location.hostname}:8000`;
export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? defaultBase;

function url(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function readDetail(res: Response): Promise<string> {
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) return j.detail;
    } else {
      const t = await res.text();
      if (t.trim()) return t.trim();
    }
  } catch {
    /* fall through */
  }
  return `Request failed with status ${res.status}`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(url(path), withAuthHeaders(init));
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Settings & Providers types
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  provider: string;
  models: string[];
}

export interface AppSettings {
  non_agent_provider: string | null;
  non_agent_model: string | null;
  openai_api_key: boolean;
  anthropic_api_key: boolean;
  google_api_key: boolean;
  ollama_base_url: string | null;
}

export const settingsApi = {
  get: () => apiJson<AppSettings>("/api/settings/"),
  update: (patch: Partial<AppSettings>) =>
    apiJson<void>("/api/settings/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
};

export const providersApi = {
  list: () => apiJson<ProviderInfo[]>("/api/providers/models"),
};

// ---------------------------------------------------------------------------
// Gauntlet API types
// ---------------------------------------------------------------------------

export interface AgentSummary {
  id: number;
  name: string;
  emoji: string;
  role_description: string;
  provider: string;
  model: string;
}

export interface BattleMessageOut {
  id: number;
  role: "user" | "agent";
  content: string;
  damage: number | null;
  damage_reason?: string | null;
  created_at: string;
}

export interface BattleBossOut {
  id: number;
  agent_id: number;
  status: "pending" | "active" | "defeated" | "failed";
  user_hp: number;
  agent_hp: number;
  agent: AgentSummary;
  messages: BattleMessageOut[];
}

export type Difficulty = "easy" | "normal" | "difficult";

export interface SessionOut {
  id: number;
  idea: string;
  agent_ids: string;
  status: "active" | "complete";
  difficulty: Difficulty;
  summary: string | null;
  created_at: string;
  bosses: BattleBossOut[];
}

export interface BossSummaryEntry {
  name: string;
  summary: string;
}

export interface ObjectionEntry {
  objection: string;
  raised_by: string[];
  counterpoint: string;
}

export interface BattleTurnOut {
  agent_reply: string;
  user_damage: number;
  user_damage_reason?: string | null;
  agent_damage: number;
  agent_damage_reason?: string | null;
  user_hp: number;
  agent_hp: number;
  battle_over: boolean;
  winner: "user" | "agent" | null;
  defeat_reason?: string | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const gauntlet = {
  randomAgents: (count = 8) =>
    apiJson<AgentSummary[]>(`/api/gauntlet/agents/random?count=${count}`),

  allAgents: () => apiJson<AgentSummary[]>("/api/agents/"),

  createSession: (
    idea: string,
    agent_ids: number[],
    model_overrides?: Record<number, { provider: string; model: string }>,
    difficulty: Difficulty = "difficult",
  ) =>
    apiJson<SessionOut>("/api/gauntlet/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, agent_ids, model_overrides, difficulty }),
    }),

  getSession: (id: number) =>
    apiJson<SessionOut>(`/api/gauntlet/sessions/${id}`),

  getBattleOpening: (session_id: number, boss_id: number) =>
    apiJson<{ agent_reply: string }>(
      `/api/gauntlet/sessions/${session_id}/battles/${boss_id}/opening`,
      {
        method: "POST",
      },
    ),

  sendMessage: (session_id: number, boss_id: number, content: string) =>
    apiJson<BattleTurnOut>(
      `/api/gauntlet/sessions/${session_id}/battles/${boss_id}/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    ),

  retryBattle: (session_id: number, boss_id: number) =>
    apiJson<{ ok: boolean }>(
      `/api/gauntlet/sessions/${session_id}/battles/${boss_id}/retry`,
      {
        method: "POST",
      },
    ),

  bypassBattle: (session_id: number, boss_id: number) =>
    apiJson<BattleTurnOut>(
      `/api/gauntlet/sessions/${session_id}/battles/${boss_id}/bypass`,
      {
        method: "POST",
      },
    ),

  generateSummary: (session_id: number) =>
    apiJson<{ summary: string }>(
      `/api/gauntlet/sessions/${session_id}/summary`,
      { method: "POST" },
    ),

  bossSummary: (session_id: number, boss_id: number) =>
    apiJson<BossSummaryEntry>(
      `/api/gauntlet/sessions/${session_id}/summary/boss/${boss_id}`,
      { method: "POST" },
    ),

  objectionsSummary: (session_id: number) =>
    apiJson<{ objections: ObjectionEntry[] }>(
      `/api/gauntlet/sessions/${session_id}/summary/objections`,
      { method: "POST" },
    ),

  storeSummary: (session_id: number, data: string) =>
    apiJson<{ summary: string }>(
      `/api/gauntlet/sessions/${session_id}/summary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      },
    ),
};
