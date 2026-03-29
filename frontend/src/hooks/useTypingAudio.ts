import { useRef, useCallback } from 'react'

/**
 * useTypingAudio — plays a subtle click sound on each received token.
 * Uses the Web Audio API to synthesize a very short low-frequency tick.
 * No external audio files required.
 */
export function useTypingAudio() {
  const ctxRef = useRef<AudioContext | null>(null)

  const getCtx = (): AudioContext => {
    if (!ctxRef.current) {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) {
        throw new Error('Web Audio API is not available in this browser')
      }
      ctxRef.current = new AudioContextCtor()
    }
    return ctxRef.current
  }

  const playTick = useCallback(() => {
    try {
      const ctx = getCtx()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.connect(gain)
      gain.connect(ctx.destination)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(1200, ctx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.04)

      gain.gain.setValueAtTime(0.04, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.05)
    } catch {
      // Silently fail if audio is not available
    }
  }, [])

  return { playTick }
}
