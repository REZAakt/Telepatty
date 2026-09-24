import { describe, expect, it, vi } from 'vitest'
import { cancelRecording, stopRecording } from './voice-recorder'

/**
 * Minimal MediaRecorder stand-in that reproduces the REAL event order of
 * `stop()`: one last `dataavailable` (the buffered tail) and then `onstop`.
 * That trailing chunk is what made the discarded voice message go out anyway.
 */
function recorderHarness(state = 'recording') {
  const events: string[] = []
  const rec = {
    state,
    stopCalls: 0,
    ondataavailable: null as ((e: { data: Blob }) => void) | null,
    onstop: null as (() => void) | null,
    stop(): void {
      this.stopCalls += 1
      this.state = 'inactive'
      events.push('stop()')
      this.ondataavailable?.({ data: new Blob(['tail-chunk']) })
      this.onstop?.()
    },
  }
  return { rec, events }
}

describe('cancelRecording (trash button: stop without sending)', () => {
  it('detaches the handlers BEFORE stopping, so the trailing chunk is never delivered', () => {
    const { rec, events } = recorderHarness()
    const onChunk = vi.fn()
    const onStop = vi.fn()
    rec.ondataavailable = onChunk
    rec.onstop = onStop

    cancelRecording(rec)

    expect(rec.ondataavailable).toBeNull()
    expect(rec.onstop).toBeNull()
    expect(rec.stopCalls).toBe(1)
    expect(events).toEqual(['stop()']) // stopped the device…
    expect(onChunk).not.toHaveBeenCalled() // …with nothing collected
    expect(onStop).not.toHaveBeenCalled() // …and no send path at all
  })

  it('proves why detaching is required: the stop-first order DID deliver the tail', () => {
    // This is the old behaviour (buffer cleared, handlers still attached): the
    // last `dataavailable` refilled the buffer and `onstop` sent it anyway.
    const { rec } = recorderHarness()
    const delivered: string[] = []
    rec.ondataavailable = () => delivered.push('tail-chunk')
    rec.onstop = () => delivered.push('send')
    rec.stop()
    expect(delivered).toEqual(['tail-chunk', 'send'])
  })

  it('tolerates a missing recorder', () => {
    expect(() => cancelRecording(null)).not.toThrow()
    expect(() => cancelRecording(undefined)).not.toThrow()
  })
})

describe('stopRecording (send button / already-inactive guard)', () => {
  it('stops a recording recorder once', () => {
    const { rec } = recorderHarness()
    stopRecording(rec)
    expect(rec.stopCalls).toBe(1)
  })

  it('never touches an inactive recorder (stop() throws in the browser)', () => {
    const { rec } = recorderHarness('inactive')
    stopRecording(rec)
    expect(rec.stopCalls).toBe(0)
    expect(() => stopRecording(null)).not.toThrow()
  })

  it('a second cancel cannot throw on an already stopped recorder', () => {
    const { rec } = recorderHarness()
    cancelRecording(rec)
    expect(() => cancelRecording(rec)).not.toThrow()
    expect(rec.stopCalls).toBe(1)
  })
})
