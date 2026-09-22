/**
 * Notification sounds — synthesized with WebAudio (no audio assets, no
 * dependencies). Three clearly distinct profiles:
 *
 * - `incoming` — iPhone/iMessage-style message-received tone: a quick, warm
 *   two-note descending figure (E6 → C6) with a soft attack, like the classic
 *   "tri-tone" family.
 * - `sent` — a single short, soft rising blip: clearly "your message went out".
 * - `alert` — a double square-wave beep, unmistakably a SYSTEM alert — used for
 *   friend requests / accepts / app updates, never for messages.
 *
 * All sounds respect `settings.sounds`. The AudioContext is created lazily and
 * resumed on demand (autoplay policies allow it inside a user gesture; if the
 * browser still refuses, the sound silently skips — never an error).
 */
interface Note {
  /** start offset in seconds from the sound start */
  at: number
  freq: number
  dur: number
  type: OscillatorType
  gain: number
  /** optional end frequency for a glide */
  glideTo?: number
}

const PROFILES: Record<'incoming' | 'sent' | 'alert', Note[]> = {
  incoming: [
    { at: 0, freq: 1318.5, dur: 0.09, type: 'sine', gain: 0.16 }, // E6
    { at: 0.1, freq: 1046.5, dur: 0.16, type: 'sine', gain: 0.16 }, // C6
  ],
  sent: [
    { at: 0, freq: 880, dur: 0.07, type: 'sine', gain: 0.1, glideTo: 1174.7 }, // A4 → D6-ish blip
  ],
  alert: [
    { at: 0, freq: 523.25, dur: 0.09, type: 'square', gain: 0.05 }, // C5
    { at: 0.15, freq: 523.25, dur: 0.12, type: 'square', gain: 0.05 },
  ],
}

let ctx: AudioContext | null = null
let muted = false

function audio(): AudioContext | null {
  if (!import.meta.client) return null
  if (muted) return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx.state === 'closed' ? null : ctx
  } catch {
    return null
  }
}

function play(profile: 'incoming' | 'sent' | 'alert'): void {
  const ac = audio()
  if (!ac) return
  try {
    const t0 = ac.currentTime + 0.01
    for (const n of PROFILES[profile]) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = n.type
      osc.frequency.setValueAtTime(n.freq, t0 + n.at)
      if (n.glideTo) osc.frequency.exponentialRampToValueAtTime(n.glideTo, t0 + n.at + n.dur)
      // soft attack + exponential release: no clicks, iMessage-like warmth
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
      osc.connect(gain).connect(ac.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.dur + 0.02)
    }
  } catch {
    /* audio must never break the app */
  }
}

export const useSounds = () => {
  const settings = useSettingsStore()
  muted = !settings.sounds
  return {
    /** a new chat message arrived (iMessage-style) */
    playIncoming: () => settings.sounds && play('incoming'),
    /** the user sent a message (distinct soft blip) */
    playSent: () => settings.sounds && play('sent'),
    /** non-message system notifications: friend requests/accepts, app updates */
    playAlert: () => settings.sounds && play('alert'),
  }
}
