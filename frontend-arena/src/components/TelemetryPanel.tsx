import React from "react";
import { Activity } from "lucide-react";
import type { InferenceProcessStatus } from "../hooks/useArenaSocket";

interface Props {
  inferenceProcesses: InferenceProcessStatus[];
}

export const TelemetryPanel: React.FC<Props> = ({
  inferenceProcesses,
}: Props) => {
  const [dotCount, setDotCount] = React.useState(0);

  const activeProcesses = inferenceProcesses.filter(
    (process) => process.active,
  );
  const hasWarming = inferenceProcesses.some(
    (p) => p.active && p.tokens_per_sec === null,
  );
  const streamingAgentProcesses = activeProcesses.filter(
    (process) =>
      process.process_kind === "agent" && (process.tokens_per_sec ?? 0) > 0,
  );
  const streamingProcesses = activeProcesses.filter(
    (process) => (process.tokens_per_sec ?? 0) > 0,
  );
  const warmingAgentProcesses = activeProcesses.filter(
    (process) =>
      process.process_kind === "agent" && process.tokens_per_sec === null,
  );

  const pickByTpsThenId = (processes: InferenceProcessStatus[]) =>
    [...processes].sort((a, b) => {
      const aTps = a.tokens_per_sec ?? -1;
      const bTps = b.tokens_per_sec ?? -1;
      if (aTps !== bTps) return bTps - aTps;
      return a.process_id.localeCompare(b.process_id);
    })[0] ?? null;

  const displayProcess =
    pickByTpsThenId(streamingAgentProcesses) ??
    pickByTpsThenId(streamingProcesses) ??
    pickByTpsThenId(warmingAgentProcesses) ??
    pickByTpsThenId(activeProcesses);

  React.useEffect(() => {
    if (!hasWarming) return;
    const interval = setInterval(() => setDotCount((d) => (d + 1) % 4), 350);
    return () => clearInterval(interval);
  }, [hasWarming]);

  const formatTokensPerSec = (tokensPerSec: number | null) => {
    if (tokensPerSec === null || Number.isNaN(tokensPerSec)) return "—";
    return `${tokensPerSec.toFixed(1)} tok/s`;
  };

  const formatModelName = (process: InferenceProcessStatus) => {
    if (!process.provider && !process.model) return "unknown model";
    if (!process.provider) return process.model;
    if (!process.model) return process.provider;
    return `${process.provider}/${process.model}`;
  };

  const formatProcessLabel = (process: InferenceProcessStatus) => {
    if (process.process_kind !== "agent") return process.process_label;
    return process.process_label.replace(/^Agent:\s*/i, "").trim();
  };

  const currentProcess = displayProcess
    ? formatProcessLabel(displayProcess)
    : "Idle";

  const modelRows = Array.from(
    inferenceProcesses.reduce((acc, process) => {
      const modelName = formatModelName(process);
      const current = acc.get(modelName) ?? {
        model: modelName,
        tokensPerSec: 0,
        warming: false,
      };
      if (process.active && process.tokens_per_sec === null) {
        current.warming = true;
      } else if (process.active && process.tokens_per_sec) {
        current.tokensPerSec += process.tokens_per_sec;
      }
      acc.set(modelName, current);
      return acc;
    }, new Map<string, { model: string; tokensPerSec: number; warming: boolean }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => a.model.localeCompare(b.model));

  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderTop: "1px solid var(--border-color)",
        backgroundColor: "var(--bg-secondary)",
        marginTop: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        <Activity size={13} style={{ color: "var(--accent-color)" }} />
        <h3
          style={{
            margin: 0,
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--text-secondary)",
          }}
        >
          Telemetry
        </h3>
      </div>

      <div
        style={{
          fontSize: "0.78rem",
          fontFamily: "monospace",
          display: "flex",
          flexDirection: "column",
          gap: "0.2rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-secondary)" }}>
            Active process:
          </span>
          <span
            style={{
              color: displayProcess
                ? "var(--text-primary)"
                : "var(--text-secondary)",
            }}
          >
            {currentProcess}
          </span>
        </div>

        {modelRows.length > 0 && (
          <div style={{ marginTop: "0.4rem" }}>
            <span
              style={{
                color: "var(--text-secondary)",
                display: "block",
                marginBottom: "0.3rem",
                fontSize: "0.7rem",
              }}
            >
              Model throughput:
            </span>
            {modelRows.map((row) => {
              const isActive = row.warming || row.tokensPerSec > 0;
              const dots = ".".repeat(dotCount);
              return (
                <div
                  key={row.model}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingLeft: "0.5rem",
                    borderLeft: `2px solid ${isActive ? "var(--accent-color)" : "var(--border-color)"}`,
                    marginBottom: "0.2rem",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    {row.model}
                  </span>
                  <span
                    style={{
                      color: isActive
                        ? "var(--accent-color)"
                        : "var(--text-secondary)",
                      flexShrink: 0,
                      paddingLeft: "0.4rem",
                    }}
                  >
                    {row.tokensPerSec > 0
                      ? formatTokensPerSec(row.tokensPerSec)
                      : row.warming
                        ? `loading${dots}\u00A0\u00A0\u00A0`.slice(0, 10)
                        : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
