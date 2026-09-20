/**
 * Swipe-left-to-reply gesture logic (pure — no DOM here).
 *
 * Telegram style: dragging a message toward the PHYSICAL left opens a reply.
 * The DOM side uses Pointer Events with `touch-action: pan-y` so vertical
 * scrolling (and the iOS edge-swipe-back) stay native; we only observe.
 *
 * Horizontal vs vertical intent is decided early: until |dx| clearly exceeds
 * |dy| (plus slop), we do NOT engage so a scroll never becomes a reply.
 */
export const SWIPE_REPLY_THRESHOLD_PX = 64
/** Minimum horizontal travel before we decide the gesture is horizontal. */
export const SWIPE_INTENT_SLOP_PX = 8

export type SwipePhase = 'idle' | 'undecided' | 'horizontal' | 'vertical' | 'triggered'

export interface SwipeState {
  phase: SwipePhase
  /** signed horizontal offset from the start (negative = toward physical LEFT) */
  dx: number
  /** progress toward the trigger threshold, 0..1 (only while horizontal) */
  progress: number
  /** true once this gesture should fire a reply */
  shouldTrigger: boolean
}

const IDLE: SwipeState = { phase: 'idle', dx: 0, progress: 0, shouldTrigger: false }

export class SwipeTracker {
  private startX = 0
  private startY = 0
  private state: SwipeState = IDLE
  private threshold: number

  constructor(threshold = SWIPE_REPLY_THRESHOLD_PX) {
    this.threshold = threshold
  }

  reset(): void {
    this.state = IDLE
  }

  onDown(x: number, y: number): SwipeState {
    this.startX = x
    this.startY = y
    this.state = { phase: 'undecided', dx: 0, progress: 0, shouldTrigger: false }
    return this.state
  }

  onMove(x: number, y: number): SwipeState {
    if (this.state.phase === 'idle' || this.state.phase === 'triggered') return this.state
    const dx = x - this.startX
    const dy = y - this.startY
    if (this.state.phase === 'undecided') {
      if (Math.abs(dx) >= SWIPE_INTENT_SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
        this.state = { ...this.state, phase: 'horizontal' }
      } else if (Math.abs(dy) > Math.abs(dx) + SWIPE_INTENT_SLOP_PX) {
        // vertical scroll wins — release the gesture silently
        this.state = { ...IDLE, phase: 'vertical' }
        return this.state
      } else {
        return { ...this.state, dx, progress: 0, shouldTrigger: false }
      }
    }
    if (this.state.phase === 'vertical') return this.state
    // horizontal: reply only for movement toward the PHYSICAL left (dx < 0)
    const left = Math.max(0, -dx)
    const triggered = left >= this.threshold
    this.state = {
      phase: triggered ? 'triggered' : 'horizontal',
      dx,
      progress: Math.min(1, left / this.threshold),
      shouldTrigger: triggered,
    }
    return this.state
  }

  /** End the gesture; returns true exactly once when the reply should fire. */
  onUp(): boolean {
    const fire = this.state.phase === 'triggered'
    this.state = IDLE
    return fire
  }

  current(): SwipeState {
    return this.state
  }
}

/** Light haptic tick where supported (never throws). */
export function vibrateReply(ms = 10): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* unsupported */
  }
}
