import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gauntlet } from "../lib/api";
import { useGameStore } from "../store/gameStore";
import { useChiptune } from "../hooks/useChiptune";

export default function SummaryScreen() {
  const navigate = useNavigate();
  const { session, clearSession } = useGameStore();
  const { unlock, blip } = useChiptune();

  const [summary, setSummary] = useState<string | null>(
    session?.summary ?? null,
  );
  const [loading, setLoading] = useState(!session?.summary);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      navigate("/", { replace: true });
      return;
    }

    if (session.summary) {
      unlock();
      return;
    }

    gauntlet
      .generateSummary(session.id)
      .then(({ summary: text }) => {
        setSummary(text);
        unlock();
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to generate summary"),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;

  const defeatedBosses = session.bosses.filter((b) => b.status === "defeated");

  const handleNewGame = () => {
    blip();
    clearSession();
    navigate("/");
  };

  return (
    <div
      className="screen"
      style={{ gap: 32, maxWidth: 720, margin: "0 auto" }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>⭐</div>
        <h1
          className="text-yellow animate-glow"
          style={{ fontSize: "1.1rem", marginBottom: 8 }}
        >
          IDEA MASTERED
        </h1>
        <p style={{ fontSize: "0.65rem", color: "var(--nes-gray)" }}>
          ALL CRITICS DEFEATED — SYNTHESIS UNLOCKED
        </p>
      </div>

      {/* Original idea */}
      <div
        className="pixel-box pixel-box--yellow"
        style={{ width: "100%", textAlign: "center" }}
      >
        <p
          style={{
            fontSize: "0.6rem",
            color: "var(--nes-yellow)",
            marginBottom: 8,
          }}
        >
          YOUR IDEA:
        </p>
        <p style={{ fontSize: "0.75rem", lineHeight: 2 }}>"{session.idea}"</p>
      </div>

      {/* Defeated bosses roll of honor */}
      <div style={{ width: "100%" }}>
        <p
          style={{
            fontSize: "0.65rem",
            color: "var(--nes-gray)",
            marginBottom: 12,
          }}
        >
          CRITICS DEFEATED:
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {defeatedBosses.map((boss) => (
            <div
              key={boss.id}
              style={{
                border: "3px solid var(--nes-green)",
                padding: "6px 12px",
                fontSize: "0.65rem",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{boss.agent.emoji}</span>
              <span>{boss.agent.name}</span>
              <span style={{ color: "var(--nes-green)" }}>✓</span>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="pixel-box" style={{ width: "100%" }}>
        <p
          style={{
            fontSize: "0.7rem",
            color: "var(--nes-cyan)",
            marginBottom: 12,
          }}
        >
          FINAL SYNTHESIS:
        </p>
        {loading && (
          <p
            style={{
              fontSize: "0.7rem",
              color: "var(--nes-gray)",
              animation: "blink 800ms step-start infinite",
            }}
          >
            GENERATING SYNTHESIS...
          </p>
        )}
        {error && (
          <p style={{ fontSize: "0.7rem", color: "var(--nes-red)" }}>{error}</p>
        )}
        {summary && (
          <div
            style={{
              fontSize: "0.75rem",
              lineHeight: 2.2,
              color: "var(--nes-white)",
              whiteSpace: "pre-wrap",
              animation: "fade-in 800ms ease",
            }}
          >
            {summary}
          </div>
        )}
      </div>

      <button
        className="pixel-btn pixel-btn--green"
        onClick={handleNewGame}
        style={{ fontSize: "0.9rem", padding: "14px 32px" }}
      >
        ► NEW GAME
      </button>
    </div>
  );
}
