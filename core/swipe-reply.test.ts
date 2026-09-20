import { describe, expect, it } from 'vitest'
import { SWIPE_REPLY_THRESHOLD_PX, SwipeTracker, SWIPE_INTENT_SLOP_PX } from './swipe-reply'

describe('swipe-left-to-reply gesture logic', () => {
  it('triggers at the 64 px threshold toward the physical LEFT', () => {
    const t = new SwipeTracker()
    t.onDown(200, 300)
    let s = t.onMove(200 - 30, 300)
    expect(s.phase).toBe('horizontal')
    expect(s.shouldTrigger).toBe(false)
    s = t.onMove(200 - SWIPE_REPLY_THRESHOLD_PX, 300)
    expect(s.shouldTrigger).toBe(true)
    expect(t.onUp()).toBe(true)
  })

  it('never triggers for swipes toward the RIGHT', () => {
    const t = new SwipeTracker()
    t.onDown(200, 300)
    const s = t.onMove(200 + 200, 300)
    expect(s.shouldTrigger).toBe(false)
    expect(t.onUp()).toBe(false)
  })

  it('vertical scroll wins: intent is decided early', () => {
    const t = new SwipeTracker()
    t.onDown(200, 300)
    const s = t.onMove(200, 300 + SWIPE_INTENT_SLOP_PX + 10)
    expect(s.phase).toBe('vertical')
    expect(s.shouldTrigger).toBe(false)
    // a later horizontal move does not revive the gesture
    expect(t.onMove(100, 300).shouldTrigger).toBe(false)
    expect(t.onUp()).toBe(false)
  })

  it('small jitters stay undecided and never trigger', () => {
    const t = new SwipeTracker()
    t.onDown(200, 300)
    const s = t.onMove(199, 301)
    expect(s.phase).toBe('undecided')
    expect(t.onUp()).toBe(false)
  })

  it('reports progress 0..1 while dragging', () => {
    const t = new SwipeTracker()
    t.onDown(200, 300)
    const half = t.onMove(200 - SWIPE_REPLY_THRESHOLD_PX / 2, 300)
    expect(half.progress).toBeCloseTo(0.5)
    expect(half.shouldTrigger).toBe(false)
  })

  it('fires exactly once per gesture', () => {
    const t = new SwipeTracker()
    t.onDown(0, 0)
    t.onMove(-100, 0)
    expect(t.onUp()).toBe(true)
    expect(t.onUp()).toBe(false)
  })

  it('after triggering, onUp fires exactly once', () => {
    const t = new SwipeTracker()
    t.onDown(0, 0)
    expect(t.onMove(-100, 0).shouldTrigger).toBe(true)
    // further moves keep the armed (triggered) state — firing only happens on up
    const s = t.onMove(-200, 0)
    expect(s.phase).toBe('triggered')
    expect(t.onUp()).toBe(true)
    expect(t.onUp()).toBe(false)
    t.reset()
    t.onDown(0, 0)
    expect(t.onMove(-100, 0).shouldTrigger).toBe(true)
  })

  it('overshoot clamps progress at 1', () => {
    const t = new SwipeTracker()
    t.onDown(0, 0)
    const s = t.onMove(-500, 0)
    expect(s.progress).toBe(1)
  })
})
