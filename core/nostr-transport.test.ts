import { describe, expect, it } from 'vitest'
import { isLiveReceive } from './nostr-transport'

/**
 * Regression tests for "the app rings/toasts for messages that arrived hours
 * ago the moment it opens".
 *
 * A relay answers the mailbox subscription with EOSE once it has finished
 * sending everything it had stored for us. Everything BEFORE that answer is
 * catch-up traffic from the time the app was closed/offline, so it must not be
 * treated as live. The old code called every wrap live, which is what made the
 * whole backlog ring at cold start.
 */
const T0 = 1_000_000

describe('isLiveReceive', () => {
  it('is false while a relay is still replaying the stored mailbox', () => {
    // no EOSE yet, one second into a fresh connection window
    expect(isLiveReceive(T0 + 1_000, T0, 0)).toBe(false)
  })

  it('is false for the EOSE settle window (other relays are still replaying)', () => {
    expect(isLiveReceive(T0 + 1_000, T0, T0 + 1_000)).toBe(false)
    expect(isLiveReceive(T0 + 2_999, T0, T0)).toBe(false)
  })

  it('is true once the settle window after EOSE has passed', () => {
    expect(isLiveReceive(T0 + 3_000, T0, T0)).toBe(true)
    expect(isLiveReceive(T0 + 60_000, T0, T0 + 1_000)).toBe(true)
  })

  it('falls back to live after the EOSE timeout (a relay that never answers)', () => {
    // staying silent forever would be a worse bug than a late ring
    expect(isLiveReceive(T0 + 14_999, T0, 0)).toBe(false)
    expect(isLiveReceive(T0 + 15_000, T0, 0)).toBe(true)
  })

  it('is false when the transport never opened a connection window', () => {
    expect(isLiveReceive(T0, 0, 0)).toBe(false)
  })
})
