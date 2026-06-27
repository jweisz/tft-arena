import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pencil, Trash2, Upload } from "lucide-react";

import { apiFetch, apiJson, apiUrl, getErrorMessage } from "../lib/api";
import { useUIStore } from "../store/uiStore";

interface Agent {
  id?: number;
  name: string;
  sort_order?: number | null;
  role_description: string;
  relevance_instructions: string;
  system_prompt: string;
  emoji: string;
  model: string;
  provider: string;
  token_budget: number;
}

const DEFAULT_AGENT: Agent = {
  name: "",
  role_description: "",
  relevance_instructions: "",
  system_prompt: "",
  emoji: "🤖",
  model: "llama3",
  provider: "ollama",
  token_budget: 3,
};

interface ProviderModel {
  provider: string;
  models: string[];
}

const encodeModelSelection = (provider: string, model: string) =>
  `${provider}::${encodeURIComponent(model)}`;

const decodeModelSelection = (
  value: string,
): { provider: string; model: string } => {
  const sepIndex = value.indexOf("::");
  if (sepIndex === -1) {
    return { provider: "ollama", model: value };
  }
  const provider = value.slice(0, sepIndex);
  const model = decodeURIComponent(value.slice(sepIndex + 2));
  return { provider, model };
};

export const AgentManager: React.FC = () => {
  const { isAgentManagerOpen, toggleAgentManager, triggerAgentsRefresh } =
    useUIStore();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [activeTab, setActiveTab] = useState<"agents" | "advanced">("agents");
  const [loading, setLoading] = useState(false);
  const [bulkUpdatingModels, setBulkUpdatingModels] = useState(false);
  const [bulkCreatingDefaults, setBulkCreatingDefaults] = useState(false);
  const [bulkRemovingAgents, setBulkRemovingAgents] = useState(false);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [bulkModelSelection, setBulkModelSelection] = useState("");
  const [presets, setPresets] = useState<
    Array<
      Pick<
        Agent,
        | "name"
        | "emoji"
        | "role_description"
        | "relevance_instructions"
        | "system_prompt"
      >
    >
  >([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [draggedAgentId, setDraggedAgentId] = useState<number | null>(null);
  const [dragOverAgentId, setDragOverAgentId] = useState<number | null>(null);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const buildFullPrompt = (agent: Agent, globalInstr = ""): string => {
    const parts: string[] = [];
    if (globalInstr) parts.push(`MISSION CONSTRAINT:\n${globalInstr}`);
    parts.push(
      `ROLE PROFILE:\n${agent.role_description || "(empty)"}\n\nPERSONA INSTRUCTION:\n${agent.system_prompt || "(empty)"}\n\nCORE CHAT PROTOCOL:\n- SPEAK ONLY AS YOURSELF (${agent.name || "Agent"}).\n- DO NOT write lines, dialogue, or reactions for any other agent.\n- PROVIDE EXACTLY ONE UTTERANCE. Do not simulate a conversation.\n- STOP IMMEDIATELY after your own point is made.\n- DO NOT prefix your response with your name or any label (e.g., '${agent.name || "Agent"}:').\n- Start your response directly with the content of your message.`,
    );
    if (globalInstr) parts.push(`FINAL REMINDER:\n${globalInstr}`);
    parts.push("USER BACKGROUND:\n(injected at runtime)");
    parts.push("PAST CONVERSATION MEMORIES:\n(injected at runtime)");
    return parts.join("\n\n");
  };

  const fetchAgents = async () => {
    try {
      setAgents(await apiJson<Agent[]>("/api/agents/"));
    } catch {
      /* No agents found */
    }
  };

  const persistAgentOrder = async (orderedAgents: Agent[]) => {
    const orderedIds = orderedAgents
      .map((agent) => agent.id)
      .filter((id): id is number => id !== undefined);
    if (orderedIds.length !== orderedAgents.length) {
      return;
    }

    const updated = await apiJson<Agent[]>("/api/agents/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_ids: orderedIds }),
    });
    setAgents(updated);
    triggerAgentsRefresh();
  };

  const moveAgent = async (fromId: number, toId: number) => {
    if (fromId === toId) {
      return;
    }

    const previousAgents = agents;
    const fromIndex = previousAgents.findIndex((agent) => agent.id === fromId);
    const toIndex = previousAgents.findIndex((agent) => agent.id === toId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const reorderedAgents = [...previousAgents];
    const [movedAgent] = reorderedAgents.splice(fromIndex, 1);
    reorderedAgents.splice(toIndex, 0, movedAgent);
    setAgents(reorderedAgents);

    try {
      await persistAgentOrder(reorderedAgents);
    } catch (error) {
      console.error("Failed to reorder agents:", error);
      setAgents(previousAgents);
      alert(
        `Failed to reorder agents: ${getErrorMessage(error, "Internal server error")}`,
      );
    }
  };

  const fetchModels = async () => {
    try {
      setAvailableModels(
        await apiJson<ProviderModel[]>("/api/providers/models"),
      );
    } catch {
      console.error("Failed to fetch models");
    }
  };

  const fetchPresets = async () => {
    try {
      setPresets(
        await apiJson<
          Array<
            Pick<
              Agent,
              | "name"
              | "emoji"
              | "role_description"
              | "relevance_instructions"
              | "system_prompt"
            >
          >
        >("/api/agents/presets"),
      );
    } catch {
      console.error("Failed to fetch presets");
    }
  };

  useEffect(() => {
    if (isAgentManagerOpen) {
      fetchAgents();
      fetchModels();
      fetchPresets();
    } else {
      setConfirmDeleteId(null);
      setActiveTab("agents");
    }
  }, [isAgentManagerOpen]);

  useEffect(() => {
    if (!isAgentManagerOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        toggleAgentManager();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isAgentManagerOpen, toggleAgentManager]);

  // Get a flat list of all models for the unified dropdown
  const allModels = useMemo(
    () =>
      availableModels.flatMap((p) =>
        p.models.map((m) => ({ provider: p.provider, model: m })),
      ),
    [availableModels],
  );

  useEffect(() => {
    if (allModels.length === 0) {
      if (bulkModelSelection !== "") {
        setBulkModelSelection("");
      }
      return;
    }

    const currentSelectionIsValid = allModels.some(
      ({ provider, model }) =>
        encodeModelSelection(provider, model) === bulkModelSelection,
    );

    if (currentSelectionIsValid) {
      return;
    }

    const allAgentsShareModel =
      agents.length > 0 &&
      agents.every(
        (agent) =>
          agent.provider === agents[0].provider &&
          agent.model === agents[0].model,
      );

    const preferred = allAgentsShareModel
      ? encodeModelSelection(agents[0].provider, agents[0].model)
      : encodeModelSelection(allModels[0].provider, allModels[0].model);

    const preferredIsValid = allModels.some(
      ({ provider, model }) =>
        encodeModelSelection(provider, model) === preferred,
    );

    setBulkModelSelection(
      preferredIsValid
        ? preferred
        : encodeModelSelection(allModels[0].provider, allModels[0].model),
    );
  }, [agents, allModels, bulkModelSelection]);

  const applyModelToAllAgents = async () => {
    if (!bulkModelSelection || agents.length === 0) {
      return;
    }

    const { provider, model } = decodeModelSelection(bulkModelSelection);
    setBulkUpdatingModels(true);

    try {
      const updateResults = await Promise.allSettled(
        agents
          .filter(
            (agent): agent is Agent & { id: number } => agent.id !== undefined,
          )
          .map((agent) =>
            apiJson<Agent>(`/api/agents/${agent.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...agent, provider, model }),
            }),
          ),
      );

      const failureCount = updateResults.filter(
        (result) => result.status === "rejected",
      ).length;
      await fetchAgents();
      triggerAgentsRefresh();

      if (failureCount > 0) {
        alert(
          `Updated models for ${updateResults.length - failureCount} of ${updateResults.length} agents.`,
        );
      }
    } catch (error) {
      alert(
        `Failed to apply model to all agents: ${getErrorMessage(error, "Internal server error")}`,
      );
    } finally {
      setBulkUpdatingModels(false);
    }
  };

  const createAllDefaultAgents = async () => {
    if (bulkCreatingDefaults || presets.length === 0) {
      return;
    }

    setBulkCreatingDefaults(true);
    try {
      const existingNames = new Set(
        agents.map((agent) => agent.name.toLowerCase()),
      );
      const presetsToCreate = presets.filter(
        (preset) => !existingNames.has(preset.name.toLowerCase()),
      );

      if (presetsToCreate.length === 0) {
        alert("All default agents already exist.");
        return;
      }

      const fallbackModel = allModels[0] || {
        provider: "ollama",
        model: "llama3",
      };
      const createResults = await Promise.allSettled(
        presetsToCreate.map((preset) =>
          apiJson<Agent>("/api/agents/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...DEFAULT_AGENT,
              name: preset.name,
              emoji: preset.emoji,
              role_description: preset.role_description,
              relevance_instructions: preset.relevance_instructions,
              system_prompt: preset.system_prompt,
              provider: fallbackModel.provider,
              model: fallbackModel.model,
            }),
          }),
        ),
      );

      const failureCount = createResults.filter(
        (result) => result.status === "rejected",
      ).length;
      await fetchAgents();
      triggerAgentsRefresh();

      if (failureCount > 0) {
        alert(
          `Created ${createResults.length - failureCount} of ${createResults.length} default agents.`,
        );
      }
    } catch (error) {
      alert(
        `Failed to create default agents: ${getErrorMessage(error, "Internal server error")}`,
      );
    } finally {
      setBulkCreatingDefaults(false);
    }
  };

  const removeAllAgents = async () => {
    if (bulkRemovingAgents || agents.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Remove all agents? This action cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    setBulkRemovingAgents(true);
    try {
      const deleteResults = await Promise.allSettled(
        agents
          .filter(
            (agent): agent is Agent & { id: number } => agent.id !== undefined,
          )
          .map((agent) =>
            apiFetch(`/api/agents/${agent.id}`, { method: "DELETE" }).then(
              async (res) => {
                if (!res.ok) {
                  throw new Error(
                    getErrorMessage(
                      await res.json().catch(() => undefined),
                      "Unknown error",
                    ),
                  );
                }
                return res;
              },
            ),
          ),
      );

      const failureCount = deleteResults.filter(
        (result) => result.status === "rejected",
      ).length;
      await fetchAgents();
      triggerAgentsRefresh();

      if (failureCount > 0) {
        alert(
          `Removed ${deleteResults.length - failureCount} of ${deleteResults.length} agents.`,
        );
      }
    } catch (error) {
      alert(
        `Failed to remove all agents: ${getErrorMessage(error, "Internal server error")}`,
      );
    } finally {
      setBulkRemovingAgents(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setLoading(true);

    // Auto-generate system prompt if empty
    const payload = { ...editing };
    if (!payload.system_prompt) {
      payload.system_prompt = `You are ${payload.name}. Your role is: ${payload.role_description}. Always stay in character.`;
    }

    console.log("[AGENT MANAGER] Saving agent...", payload);
    try {
      const url = payload.id ? `/api/agents/${payload.id}` : "/api/agents/";
      const method = payload.id ? "PUT" : "POST";

      console.log(`[AGENT MANAGER] ${method} to ${url}`);
      await apiJson<Agent>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await fetchAgents();
      triggerAgentsRefresh();
      setEditing(null);
      setPromptPreviewOpen(false);
    } catch (err) {
      console.error("Network error during save:", err);
      alert(
        `Failed to save agent persona: ${getErrorMessage(err, "Internal server error")}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      console.log(`Sending DELETE for agent ${id}...`);
      await apiFetch(`/api/agents/${id}`, { method: "DELETE" }).then(
        async (res) => {
          if (!res.ok) {
            throw new Error(
              getErrorMessage(
                await res.json().catch(() => undefined),
                "Unknown error",
              ),
            );
          }
        },
      );
      console.log(`Agent ${id} deleted successfully.`);
      setConfirmDeleteId(null);
      await fetchAgents();
      triggerAgentsRefresh();
    } catch (err) {
      console.error("Network or other error during delete:", err);
      alert(
        `Failed to delete agent: ${getErrorMessage(err, "Internal error")}`,
      );
    }
  };

  const getAvatarUrl = (agent: Agent) =>
    apiUrl(
      `/api/avatars/generate-default?role_description=${encodeURIComponent(agent.role_description)}&agent_name=${encodeURIComponent(agent.name)}`,
    );

  const buildAgentSpecMarkdown = (agent: Agent): string => {
    const yamlQuote = (s: string): string =>
      `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

    const yamlBlock = (s: string): string => {
      const indented = s
        .trim()
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      return `|\n${indented}`;
    };

    return [
      "---",
      `name: ${yamlQuote(agent.name)}`,
      `emoji: ${yamlQuote(agent.emoji || "🤖")}`,
      `role_description: ${yamlQuote(agent.role_description || "")}`,
      `relevance_instructions: ${yamlBlock(agent.relevance_instructions || "")}`,
      "---",
      agent.system_prompt || "",
      "",
    ].join("\n");
  };

  const slugify = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const extractMarkdownSection = (
    content: string,
    sectionTitle: string,
  ): string => {
    const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `##\\s+${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
      "i",
    );
    const match = content.match(regex);
    return match?.[1]?.trim() || "";
  };

  const parseImportedAgentSpec = (content: string): Partial<Agent> => {
    // Try YAML frontmatter format first (---\n<fields>\n---\n<body>)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1];
      const body = fmMatch[2].trim();

      const readQuoted = (key: string): string => {
        const quoted = frontmatter.match(
          new RegExp(`(?:^|\\n)${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
        );
        if (quoted)
          return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        const unquoted = frontmatter.match(
          new RegExp(`(?:^|\\n)${key}:\\s*([^\\n|>][^\\n]*)`),
        );
        return unquoted?.[1]?.trim() || "";
      };

      const readBlock = (key: string): string => {
        const startMatch = frontmatter.match(
          new RegExp(`(?:^|\\n)${key}:\\s*[|>][^\\n]*\\n`),
        );
        if (!startMatch) return readQuoted(key);
        const startIdx =
          frontmatter.indexOf(startMatch[0]) + startMatch[0].length;
        const rest = frontmatter.slice(startIdx);
        const lines: string[] = [];
        for (const line of rest.split("\n")) {
          if (line === "" || line.startsWith("  ")) {
            lines.push(line.startsWith("  ") ? line.slice(2) : "");
          } else {
            break;
          }
        }
        return lines.join("\n").trim();
      };

      const name = readQuoted("name");
      if (!name)
        throw new Error("Could not find an agent name in the markdown file.");

      return {
        name,
        emoji: readQuoted("emoji") || "🤖",
        role_description: readBlock("role_description"),
        relevance_instructions: readBlock("relevance_instructions"),
        system_prompt: body,
      };
    }

    // Fallback: legacy # Agent Persona: format
    const nameMatch =
      content.match(/^#\s*Agent Persona:\s*(.+)$/im) ||
      content.match(/^#\s*(.+)$/im);
    const name = nameMatch?.[1]?.trim() || "";
    if (!name) {
      throw new Error("Could not find an agent name in the markdown file.");
    }

    const emojiMatch = content.match(/^[-*]\s*Emoji:\s*(.+)$/im);

    return {
      name,
      emoji: emojiMatch?.[1]?.trim() || "🤖",
      role_description: extractMarkdownSection(content, "Role Description"),
      relevance_instructions: extractMarkdownSection(
        content,
        "Relevance Instructions",
      ),
      system_prompt: extractMarkdownSection(content, "Persona Instructions"),
    };
  };

  const downloadAgentSpec = (agent: Agent, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const markdown = buildAgentSpecMarkdown(agent);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${slugify(agent.name) || "agent-persona"}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const openImportDialog = () => {
    importFileInputRef.current?.click();
  };

  const importAgentSpec = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(typeof reader.result === "string" ? reader.result : "");
              reader.onerror = () =>
                reject(new Error("Failed to read markdown file."));
              reader.readAsText(file);
            });
      const parsed = parseImportedAgentSpec(text);
      const firstModel = allModels[0] || {
        provider: "ollama",
        model: "llama3",
      };
      setEditing({
        ...DEFAULT_AGENT,
        ...parsed,
        provider: firstModel.provider,
        model: firstModel.model,
      });
    } catch (error) {
      alert(
        `Failed to import agent persona: ${getErrorMessage(error, "Invalid markdown file")}`,
      );
    } finally {
      event.target.value = "";
    }
  };

  if (!isAgentManagerOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1001,
        backdropFilter: "blur(3px)",
      }}
      onClick={toggleAgentManager}
    >
      <div
        style={{
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "2rem",
          width: editing ? (promptPreviewOpen ? "1000px" : "700px") : "550px",
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflowY: editing ? "hidden" : "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
          transition: "width 0.2s ease",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h2
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
            }}
          >
            👤 Agent Management
          </h2>
          <button
            onClick={toggleAgentManager}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <input
          ref={importFileInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          onChange={importAgentSpec}
          style={{ display: "none" }}
          aria-label="Import agent persona markdown"
        />

        {/* Agent List */}
        {!editing && (
          <>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                marginBottom: "1.5rem",
              }}
            >
              Define global agent personas here. You can activate or deactivate
              these in individual rooms via the sidebar.
            </p>
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--border-color)",
                marginBottom: "1rem",
              }}
            >
              <button
                onClick={() => setActiveTab("agents")}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  padding: "0.75rem",
                  cursor: "pointer",
                  borderBottom:
                    activeTab === "agents"
                      ? "2px solid var(--accent-color)"
                      : "2px solid transparent",
                  color:
                    activeTab === "agents"
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  fontWeight: activeTab === "agents" ? "bold" : "normal",
                }}
              >
                Agents
              </button>
              <button
                onClick={() => setActiveTab("advanced")}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  padding: "0.75rem",
                  cursor: "pointer",
                  borderBottom:
                    activeTab === "advanced"
                      ? "2px solid var(--accent-color)"
                      : "2px solid transparent",
                  color:
                    activeTab === "advanced"
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  fontWeight: activeTab === "advanced" ? "bold" : "normal",
                }}
              >
                Advanced
              </button>
            </div>
            {activeTab === "agents" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  minHeight: "calc(90vh - 260px)",
                  maxHeight: "calc(90vh - 260px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    marginBottom: "0.5rem",
                    overflowY: "auto",
                    paddingRight: "0.25rem",
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  {agents.length === 0 && (
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.9rem",
                      }}
                    >
                      No agents yet. Create your first persona!
                    </p>
                  )}
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      draggable={confirmDeleteId !== agent.id}
                      onDragStart={() => setDraggedAgentId(agent.id ?? null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverAgentId(agent.id ?? null);
                      }}
                      onDragLeave={() => {
                        if (dragOverAgentId === agent.id) {
                          setDragOverAgentId(null);
                        }
                      }}
                      onDrop={async (event) => {
                        event.preventDefault();
                        const targetId = agent.id ?? null;
                        const sourceId = draggedAgentId;
                        setDraggedAgentId(null);
                        setDragOverAgentId(null);
                        if (sourceId !== null && targetId !== null) {
                          await moveAgent(sourceId, targetId);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedAgentId(null);
                        setDragOverAgentId(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "1rem",
                        padding: "0.75rem",
                        backgroundColor:
                          draggedAgentId === agent.id
                            ? "var(--bg-secondary)"
                            : "var(--bg-tertiary)",
                        borderRadius: "6px",
                        border:
                          dragOverAgentId === agent.id
                            ? "1px solid var(--accent-color)"
                            : "1px solid transparent",
                      }}
                    >
                      <div
                        aria-label={`Drag ${agent.name}`}
                        title="Drag to reorder"
                        style={{
                          cursor: "grab",
                          color: "var(--text-secondary)",
                          fontSize: "1rem",
                          userSelect: "none",
                          lineHeight: 1,
                        }}
                      >
                        ⋮⋮
                      </div>
                      <img
                        src={getAvatarUrl(agent)}
                        alt={agent.name}
                        width={40}
                        height={40}
                        style={{ borderRadius: "50%", flexShrink: 0 }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: "bold",
                            marginBottom: "0.2rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                          }}
                        >
                          <span style={{ fontSize: "1.2rem" }}>
                            {agent.emoji || "🤖"}
                          </span>
                          {agent.name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {agent.provider} / {agent.model}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          flexShrink: 0,
                        }}
                      >
                        {!editing && confirmDeleteId === agent.id ? (
                          <button
                            onClick={(e) => agent.id && remove(agent.id, e)}
                            style={{
                              padding: "0.4rem 0.6rem",
                              fontSize: "0.8rem",
                              color: "#fff",
                              backgroundColor: "#ef4444",
                              border: "none",
                              cursor: "pointer",
                              fontWeight: "bold",
                            }}
                          >
                            Confirm Delete?
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={(e) => downloadAgentSpec(agent, e)}
                              aria-label={`Download ${agent.name} markdown`}
                              title="Download markdown"
                              style={{
                                width: "2.2rem",
                                height: "2.2rem",
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                cursor: "pointer",
                                color: "var(--text-primary)",
                              }}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              onClick={() => setEditing(agent)}
                              aria-label={`Edit ${agent.name}`}
                              title="Edit"
                              style={{
                                width: "2.2rem",
                                height: "2.2rem",
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                cursor: "pointer",
                                color: "var(--text-primary)",
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(agent.id || null);
                              }}
                              aria-label={`Delete ${agent.name}`}
                              title="Delete"
                              style={{
                                width: "2.2rem",
                                height: "2.2rem",
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                                border: "1px solid #ef4444",
                                borderRadius: "6px",
                                cursor: "pointer",
                                color: "#ef4444",
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    backgroundColor: "var(--bg-primary)",
                    paddingTop: "0.75rem",
                    borderTop: "1px solid var(--border-color)",
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={openImportDialog}
                    style={{
                      flex: 1,
                      padding: "0.75rem",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-tertiary)",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      borderRadius: "6px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <Upload size={15} /> Import
                  </button>
                  <button
                    onClick={() => {
                      const firstModel = allModels[0] || {
                        provider: "ollama",
                        model: "llama3",
                      };
                      setEditing({
                        ...DEFAULT_AGENT,
                        provider: firstModel.provider,
                        model: firstModel.model,
                      });
                    }}
                    style={{
                      flex: 1,
                      padding: "0.75rem",
                      border: "1px solid var(--accent-color)",
                      backgroundColor: "var(--accent-color)",
                      cursor: "pointer",
                      color: "#fff",
                      borderRadius: "6px",
                      fontWeight: "bold",
                    }}
                  >
                    + Create
                  </button>
                </div>
              </div>
            )}

            {activeTab === "advanced" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  marginBottom: "0.5rem",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "var(--text-secondary)",
                    fontSize: "0.82rem",
                  }}
                >
                  Bulk operations apply across all agent personas.
                </p>
                <div
                  style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                >
                  <button
                    onClick={createAllDefaultAgents}
                    disabled={
                      presets.length === 0 ||
                      bulkCreatingDefaults ||
                      bulkRemovingAgents
                    }
                    style={{
                      padding: "0.55rem 0.9rem",
                      cursor: "pointer",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                      borderRadius: "4px",
                      opacity:
                        presets.length === 0 ||
                        bulkCreatingDefaults ||
                        bulkRemovingAgents
                          ? 0.5
                          : 1,
                    }}
                  >
                    {bulkCreatingDefaults
                      ? "Creating…"
                      : "Create All Default Agents"}
                  </button>
                  <button
                    onClick={removeAllAgents}
                    disabled={
                      agents.length === 0 ||
                      bulkRemovingAgents ||
                      bulkCreatingDefaults ||
                      bulkUpdatingModels
                    }
                    style={{
                      padding: "0.55rem 0.9rem",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                      border: "1px solid #ef4444",
                      color: "#ef4444",
                      borderRadius: "4px",
                      opacity:
                        agents.length === 0 ||
                        bulkRemovingAgents ||
                        bulkCreatingDefaults ||
                        bulkUpdatingModels
                          ? 0.5
                          : 1,
                    }}
                  >
                    {bulkRemovingAgents ? "Removing…" : "Remove All Agents"}
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="bulk-model-selector"
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: "0.25rem",
                        fontWeight: "bold",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Apply model to all agents
                    </label>
                    <select
                      id="bulk-model-selector"
                      aria-label="Bulk model selector"
                      value={bulkModelSelection}
                      onChange={(event) =>
                        setBulkModelSelection(event.target.value)
                      }
                      disabled={
                        allModels.length === 0 ||
                        agents.length === 0 ||
                        bulkUpdatingModels
                      }
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                      }}
                    >
                      {availableModels.map(
                        (providerModel) =>
                          providerModel.models.length > 0 && (
                            <optgroup
                              key={providerModel.provider}
                              label={providerModel.provider.toUpperCase()}
                            >
                              {providerModel.models.map((modelName) => (
                                <option
                                  key={modelName}
                                  value={encodeModelSelection(
                                    providerModel.provider,
                                    modelName,
                                  )}
                                >
                                  {modelName}
                                </option>
                              ))}
                            </optgroup>
                          ),
                      )}
                    </select>
                  </div>
                  <button
                    onClick={applyModelToAllAgents}
                    disabled={
                      !bulkModelSelection ||
                      allModels.length === 0 ||
                      agents.length === 0 ||
                      bulkUpdatingModels ||
                      bulkCreatingDefaults ||
                      bulkRemovingAgents
                    }
                    style={{
                      padding: "0.55rem 0.9rem",
                      cursor: "pointer",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                      borderRadius: "4px",
                      opacity:
                        !bulkModelSelection ||
                        allModels.length === 0 ||
                        agents.length === 0 ||
                        bulkUpdatingModels ||
                        bulkCreatingDefaults ||
                        bulkRemovingAgents
                          ? 0.5
                          : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {bulkUpdatingModels ? "Applying…" : "Apply to All"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Agent Edit Form */}
        {editing && (
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              alignItems: "stretch",
              animation: "fadeSlideIn 0.2s ease",
              minHeight: 0,
              maxHeight: "calc(90vh - 170px)",
            }}
          >
            {/* Left: form fields */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1rem" }}>
                  {editing.id ? "Edit Persona" : "New Persona"}
                </h3>
                <button
                  onClick={() => setPromptPreviewOpen((o) => !o)}
                  aria-label={
                    promptPreviewOpen
                      ? "Hide full prompt preview"
                      : "Show full prompt preview"
                  }
                  title={
                    promptPreviewOpen
                      ? "Hide full prompt preview"
                      : "Show full prompt preview"
                  }
                  style={{
                    height: "2rem",
                    padding: "0 0.65rem",
                    cursor: "pointer",
                    backgroundColor: promptPreviewOpen
                      ? "var(--bg-tertiary)"
                      : "transparent",
                    border: "1px solid var(--border-color)",
                    color: promptPreviewOpen
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {promptPreviewOpen ? "Hide Preview" : "Show Preview"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  paddingRight: "0.25rem",
                  marginTop: "1rem",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      marginBottom: "0.6rem",
                      fontWeight: "bold",
                    }}
                  >
                    Presets
                  </label>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      marginBottom: "1rem",
                    }}
                  >
                    {presets.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            name: preset.name,
                            role_description: preset.role_description,
                            relevance_instructions:
                              preset.relevance_instructions,
                            system_prompt: preset.system_prompt,
                            emoji: preset.emoji,
                          })
                        }
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.4rem 0.8rem",
                          backgroundColor: "var(--bg-tertiary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "20px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          color: "var(--text-primary)",
                        }}
                      >
                        {preset.emoji} {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                  <div style={{ flex: 1 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.85rem",
                        marginBottom: "0.3rem",
                        fontWeight: "bold",
                      }}
                    >
                      Name
                    </label>
                    <input
                      type="text"
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                      placeholder="e.g. Devil's Advocate"
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>
                  <div style={{ width: "80px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.85rem",
                        marginBottom: "0.3rem",
                        fontWeight: "bold",
                      }}
                    >
                      Emoji
                    </label>
                    <input
                      type="text"
                      value={editing.emoji}
                      onChange={(e) =>
                        setEditing({ ...editing, emoji: e.target.value })
                      }
                      placeholder="🤖"
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                        textAlign: "center",
                        fontSize: "1.2rem",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      marginBottom: "0.3rem",
                      fontWeight: "bold",
                    }}
                  >
                    Role Description
                  </label>
                  <textarea
                    value={editing.role_description}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        role_description: e.target.value,
                      })
                    }
                    placeholder="e.g. Challenges assumptions and finds edge cases..."
                    style={{
                      width: "100%",
                      minHeight: "100px",
                      padding: "0.6rem",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      marginBottom: "0.3rem",
                      fontWeight: "bold",
                    }}
                  >
                    Relevance Instructions
                  </label>
                  <textarea
                    value={editing.relevance_instructions}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        relevance_instructions: e.target.value,
                      })
                    }
                    placeholder="Describe the kinds of messages this agent should respond to..."
                    style={{
                      width: "100%",
                      minHeight: "80px",
                      padding: "0.6rem",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      marginBottom: "0.3rem",
                      fontWeight: "bold",
                    }}
                  >
                    Persona Instructions
                  </label>
                  <textarea
                    value={editing.system_prompt}
                    onChange={(e) =>
                      setEditing({ ...editing, system_prompt: e.target.value })
                    }
                    placeholder="Full behavioral instructions for this agent. If left empty, a basic prompt is auto-generated from the role description."
                    style={{
                      width: "100%",
                      minHeight: "160px",
                      padding: "0.6rem",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      marginBottom: "0.3rem",
                      fontWeight: "bold",
                    }}
                  >
                    Model
                  </label>
                  {allModels.length === 0 ? (
                    <div
                      style={{
                        padding: "0.5rem",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        color: "#ef4444",
                      }}
                    >
                      No models found. Please configure API keys in Settings.
                    </div>
                  ) : (
                    <select
                      value={encodeModelSelection(
                        editing.provider,
                        editing.model,
                      )}
                      onChange={(e) => {
                        const { provider, model } = decodeModelSelection(
                          e.target.value,
                        );
                        setEditing({ ...editing, provider, model });
                      }}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                      }}
                    >
                      {availableModels.map(
                        (p) =>
                          p.models.length > 0 && (
                            <optgroup
                              key={p.provider}
                              label={p.provider.toUpperCase()}
                            >
                              {p.models.map((m) => (
                                <option
                                  key={m}
                                  value={encodeModelSelection(p.provider, m)}
                                >
                                  {m}
                                </option>
                              ))}
                            </optgroup>
                          ),
                      )}
                    </select>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "flex-end",
                  marginTop: "0.75rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--border-color)",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => {
                    setEditing(null);
                    setPromptPreviewOpen(false);
                  }}
                  style={{
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                    borderRadius: "4px",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={
                    loading || !editing.name || !editing.role_description
                  }
                  style={{
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                    backgroundColor: "var(--accent-color)",
                    color: "#fff",
                    border: "none",
                    fontWeight: "bold",
                    borderRadius: "4px",
                    opacity:
                      loading || !editing.name || !editing.role_description
                        ? 0.5
                        : 1,
                  }}
                >
                  {loading ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
            {/* end left column */}

            {/* Right: full prompt preview */}
            {promptPreviewOpen && (
              <div
                style={{
                  width: "300px",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: "bold",
                    color: "var(--text-secondary)",
                    paddingBottom: "0.4rem",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  Full Prompt Preview
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "0.75rem",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflowY: "auto",
                    flex: 1,
                    minHeight: 0,
                    lineHeight: 1.5,
                    fontFamily: "monospace",
                  }}
                >
                  {buildFullPrompt(editing)}
                </pre>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.7rem",
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                  }}
                >
                  Runtime fields (memory, user profile, global instruction)
                  shown as placeholders.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
