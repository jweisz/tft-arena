import { useState } from "react";
import { useAudioStore } from "../store/audioStore";
import { TRACKS } from "../hooks/useBgMusic";
import { getAudioContext } from "../hooks/useChiptune";
import SettingsModal from "./SettingsModal";

export default function AudioControls() {
  const { musicEnabled, sfxEnabled, trackId, toggleMusic, toggleSfx, nextTrack, prevTrack } =
    useAudioStore();
  const [showSettings, setShowSettings] = useState(false);

  const trackName = TRACKS.find((t) => t.id === trackId)?.name ?? trackId;

  const base: React.CSSProperties = {
    background: "var(--nes-darkgray)",
    border: "3px solid var(--nes-gray)",
    color: "var(--nes-white)",
    fontFamily: "inherit",
    fontSize: "0.8rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    whiteSpace: "nowrap",
    transition: "border-color 80ms, background 80ms",
  };

  const active: React.CSSProperties = {
    ...base,
    borderColor: "var(--nes-cyan)",
    background: "rgba(66,197,245,0.1)",
  };

  // Compound BGM control: toggle + track picker in a single bordered box.
  // The track picker is always visible so toggling music never shifts other elements.
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 1000,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      {/* ── Compound BGM control ───────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          border: `3px solid ${musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)"}`,
          background: musicEnabled ? "rgba(66,197,245,0.08)" : "var(--nes-darkgray)",
          transition: "border-color 80ms, background 80ms",
        }}
      >
        {/* Toggle half */}
        <button
          onClick={() => {
            // Resume AudioContext inside the user gesture so autoplay policy allows it.
            void getAudioContext().resume();
            toggleMusic();
          }}
          title={musicEnabled ? "Music ON — click to mute" : "Music OFF — click to enable"}
          style={{
            background: "none",
            border: "none",
            borderRight: `2px solid ${musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)"}`,
            color: "var(--nes-white)",
            fontFamily: "inherit",
            fontSize: "0.8rem",
            padding: "6px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap",
            transition: "border-color 80ms",
          }}
        >
          <span>{musicEnabled ? "🎵" : "🔇"}</span>
          <span style={{ fontSize: "0.65rem", color: musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)" }}>
            BGM
          </span>
        </button>

        {/* Track prev */}
        <button
          onClick={prevTrack}
          title="Previous track"
          style={{
            background: "none",
            border: "none",
            color: musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)",
            fontFamily: "inherit",
            fontSize: "0.65rem",
            padding: "0 5px",
            cursor: "pointer",
            lineHeight: 1,
            opacity: musicEnabled ? 1 : 0.45,
            transition: "opacity 80ms, color 80ms",
          }}
        >
          ◄
        </button>

        {/* Track name — fixed width so layout never shifts */}
        <span
          style={{
            fontSize: "0.55rem",
            color: musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)",
            width: 68,
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: musicEnabled ? 1 : 0.45,
            transition: "opacity 80ms, color 80ms",
          }}
        >
          {trackName}
        </span>

        {/* Track next */}
        <button
          onClick={nextTrack}
          title="Next track"
          style={{
            background: "none",
            border: "none",
            color: musicEnabled ? "var(--nes-cyan)" : "var(--nes-gray)",
            fontFamily: "inherit",
            fontSize: "0.65rem",
            padding: "0 5px",
            cursor: "pointer",
            lineHeight: 1,
            opacity: musicEnabled ? 1 : 0.45,
            transition: "opacity 80ms, color 80ms",
          }}
        >
          ►
        </button>
      </div>

      {/* ── SFX toggle ─────────────────────────────────────────────── */}
      <button
        style={sfxEnabled ? active : base}
        onClick={toggleSfx}
        title={sfxEnabled ? "SFX ON — click to mute" : "SFX OFF — click to enable"}
      >
        <span>{sfxEnabled ? "🔊" : "🔕"}</span>
        <span style={{ fontSize: "0.65rem", color: sfxEnabled ? "var(--nes-cyan)" : "var(--nes-gray)" }}>
          SFX
        </span>
      </button>

      {/* ── Settings ───────────────────────────────────────────────── */}
      <button
        style={
          showSettings
            ? { ...active, borderColor: "var(--nes-yellow)", background: "rgba(245,197,66,0.1)" }
            : base
        }
        onClick={() => setShowSettings((s) => !s)}
        title="Settings"
      >
        <span>⚙</span>
        <span style={{ fontSize: "0.65rem", color: showSettings ? "var(--nes-yellow)" : "var(--nes-gray)" }}>
          SETTINGS
        </span>
      </button>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
