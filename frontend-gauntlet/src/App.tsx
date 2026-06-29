import { useEffect, useMemo } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  isAuthenticated,
  buildLocalDevSession,
  setAuthSession,
} from "./lib/auth";
import { useAudioStore } from "./store/audioStore";
import { useBgMusic } from "./hooks/useBgMusic";
import { useGameStore } from "./store/gameStore";
import { gauntlet } from "./lib/api";
import AudioControls from "./components/AudioControls";
import IdeaEntryScreen from "./screens/IdeaEntryScreen";
import ChallengerSelectScreen from "./screens/ChallengerSelectScreen";
import StageSelectScreen from "./screens/StageSelectScreen";
import BossInterstitialScreen from "./screens/BossInterstitialScreen";
import BattleScreen from "./screens/BattleScreen";
import SummaryScreen from "./screens/SummaryScreen";

// One track per boss slot (8 slots → 7 unique tracks, slot 7 wraps to arena)
const BATTLE_TRACKS = [
  "arena", "shadow", "boss-rush", "voltage", "thunder", "mirage", "starlight", "arena",
];

function AudioManager() {
  const { musicEnabled, manualTrackId } = useAudioStore();
  const location = useLocation();
  const session = useGameStore((s) => s.session);

  const autoTrackId = useMemo(() => {
    const path = location.pathname;
    if (path === "/" || path === "/choose-challengers") return "overworld";
    if (path === "/stage-select") return "arena";
    if (path.startsWith("/battle/")) {
      const bossId = Number(path.split("/").pop());
      const idx = session?.bosses.findIndex((b) => b.id === bossId) ?? 0;
      return BATTLE_TRACKS[Math.max(0, idx) % BATTLE_TRACKS.length];
    }
    if (path === "/summary") return "credits";
    return "arena";
  }, [location.pathname, session]);

  const isBossInterstitial = location.pathname.startsWith("/boss/");
  useBgMusic(musicEnabled && !isBossInterstitial, manualTrackId ?? autoTrackId);
  return null;
}

function SessionRestorer() {
  const { session, setSession } = useGameStore();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (session) return;
    const savedId = localStorage.getItem("gauntlet_session_id");
    if (!savedId) return;
    gauntlet
      .getSession(Number(savedId))
      .then((s) => {
        setSession(s);
        // Never drop back into a battle/boss screen from a page refresh — redirect to stage select
        const { pathname } = location;
        if (pathname.startsWith("/battle/") || pathname.startsWith("/boss/")) {
          navigate("/stage-select", { replace: true });
        }
      })
      .catch(() => localStorage.removeItem("gauntlet_session_id"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    setAuthSession(buildLocalDevSession());
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <AudioManager />
        <SessionRestorer />
        <AudioControls />
        <Routes>
          <Route path="/" element={<IdeaEntryScreen />} />
          <Route
            path="/choose-challengers"
            element={<ChallengerSelectScreen />}
          />
          <Route path="/stage-select" element={<StageSelectScreen />} />
          <Route path="/boss/:bossId" element={<BossInterstitialScreen />} />
          <Route path="/battle/:bossId" element={<BattleScreen />} />
          <Route path="/summary" element={<SummaryScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
