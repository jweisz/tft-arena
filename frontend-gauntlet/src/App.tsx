import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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

function AudioManager() {
  const musicEnabled = useAudioStore((s) => s.musicEnabled);
  const trackId = useAudioStore((s) => s.trackId);
  useBgMusic(musicEnabled, trackId);
  return null;
}

function SessionRestorer() {
  const { session, setSession } = useGameStore();
  useEffect(() => {
    if (session) return;
    const savedId = localStorage.getItem("gauntlet_session_id");
    if (!savedId) return;
    gauntlet
      .getSession(Number(savedId))
      .then(setSession)
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
