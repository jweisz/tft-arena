/**
 * Looping chiptune background music via Web Audio API.
 * Procedurally generated — no audio files required.
 *
 * Two interleaved square-wave voices (melody + bass) scheduled with
 * a recursive setTimeout sequencer so the loop is gapless.
 */
import { useEffect, useRef } from "react";
import { getAudioContext } from "./useChiptune";

type Note = [number, number]; // [hz (0 = rest), duration_ms]

// ── Tempo ──────────────────────────────────────────────────────────────────
const BPM = 155;
const Q = Math.round((60 / BPM) * 1000); // quarter  ~387 ms
const E = Math.round(Q / 2); // eighth   ~194 ms
const S = Math.round(Q / 4); // 16th     ~97 ms
const DQ = Math.round(Q * 1.5); // dotted quarter ~581 ms

// ── Melody (square wave, mid register) ────────────────────────────────────
// A minor pentatonic: A C D E G  (+ occasional B)
const MELODY: Note[] = [
  // Phrase 1 — ascending run
  [659, S],
  [784, S],
  [880, E],
  [784, S],
  [659, S],
  [0, S],
  [659, S],
  [587, E],
  [523, E],
  [440, E],
  [0, S],
  [523, S],
  [587, E],
  [659, DQ],
  [0, E],

  // Phrase 2 — lower response
  [523, S],
  [587, S],
  [659, E],
  [587, S],
  [523, S],
  [0, S],
  [523, S],
  [440, E],
  [392, E],
  [330, E],
  [0, S],
  [392, S],
  [440, E],
  [523, DQ],
  [0, E],

  // Phrase 3 — energetic scale run
  [440, S],
  [494, S],
  [523, S],
  [587, S],
  [659, S],
  [784, S],
  [880, E],
  [0, S],
  [784, S],
  [659, S],
  [587, S],
  [523, S],
  [494, E],
  [440, DQ],
  [0, E],

  // Phrase 4 — resolve and turnaround
  [659, E],
  [0, S],
  [523, S],
  [587, E],
  [523, E],
  [440, E],
  [0, S],
  [330, S],
  [392, E],
  [440, E],
  [523, E],
  [0, S],
  [659, S],
  [784, E],
  [880, S],
  [784, S],
  [659, DQ],
  [0, E],
];

// ── Bass (triangle wave, low register) ─────────────────────────────────────
const BASS: Note[] = [
  [220, Q],
  [0, E],
  [220, E],
  [0, Q],
  [165, E],
  [0, E], // bar 1
  [175, Q],
  [0, E],
  [175, E],
  [0, Q],
  [147, E],
  [0, E], // bar 2
  [196, Q],
  [0, E],
  [196, E],
  [0, Q],
  [220, E],
  [0, E], // bar 3
  [175, Q],
  [0, E],
  [131, E],
  [0, Q],
  [165, E],
  [0, Q], // bar 4
  [220, Q],
  [0, E],
  [220, E],
  [0, Q],
  [196, E],
  [0, E], // bar 5
  [175, Q],
  [0, E],
  [175, E],
  [0, Q],
  [165, E],
  [0, E], // bar 6
  [131, Q],
  [0, E],
  [131, E],
  [0, Q],
  [165, E],
  [0, E], // bar 7
  [196, Q],
  [0, Q],
  [165, Q],
  [0, Q], // bar 8
];

function playNote(
  hz: number,
  durationMs: number,
  wave: OscillatorType,
  vol: number,
  masterGain: GainNode,
) {
  if (hz <= 0) return;
  const ac = getAudioContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave;
  osc.frequency.value = hz;
  const dur = durationMs / 1000;
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur * 0.88);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

function startSequencer(
  track: Note[],
  wave: OscillatorType,
  vol: number,
  masterGain: GainNode,
  activeRef: React.MutableRefObject<boolean>,
  indexRef: React.MutableRefObject<number>,
) {
  function tick() {
    if (!activeRef.current) return;
    const [hz, ms] = track[indexRef.current];
    playNote(hz, ms, wave, vol, masterGain);
    indexRef.current = (indexRef.current + 1) % track.length;
    window.setTimeout(tick, ms);
  }
  tick();
}

export function useBgMusic(enabled: boolean) {
  const activeRef = useRef(false);
  const melodyIdx = useRef(0);
  const bassIdx = useRef(0);
  const masterRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (enabled) {
      const ac = getAudioContext();

      // Resume suspended context (browsers require user gesture first)
      if (ac.state === "suspended") {
        void ac.resume();
      }

      const master = ac.createGain();
      master.gain.value = 0.7;
      master.connect(ac.destination);
      masterRef.current = master;

      activeRef.current = true;
      melodyIdx.current = 0;
      bassIdx.current = 0;

      startSequencer(MELODY, "square", 0.1, master, activeRef, melodyIdx);
      startSequencer(BASS, "triangle", 0.12, master, activeRef, bassIdx);
    } else {
      activeRef.current = false;
      // Fade out the master gain to avoid a hard click
      if (masterRef.current) {
        const g = masterRef.current;
        const ac = getAudioContext();
        g.gain.setValueAtTime(g.gain.value, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.3);
        masterRef.current = null;
      }
    }

    return () => {
      activeRef.current = false;
    };
  }, [enabled]);
}
