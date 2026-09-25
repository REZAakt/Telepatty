import { SimplePool } from 'nostr-tools'
import type { SubCloser } from 'nostr-tools/abstract-pool'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { sealEnvelope, openWrap, verifyEvent } from './crypto'
import type { Identity } from './crypto'
import type { Envelope } from './protocol'
import { MAX_ENVELOPE_BYTES, parseEnvelope } from './protocol'
import type { Clock } from './clock'
import type { SendResult, TransportId, TransportStatus } from './router'
import { normalizeRelayUrl } from './relay-health'

/**
 * How long a connection attempt keeps saying "connecting" while no relay is up
 * before the transport admits it is offline. Relays handshake slowly on bad
 * mobile links, and the old single one-shot 4s check — with nothing re-checking
 * afterwards — left the header chip on "offline" until the next focus event,
 * which is exactly the reported "it says offline until it becomes online".
 */
const CONNECT_WINDOW_MS = 12_000
/** Re-read the relay picture this often while nothing is up (self-correcting). */
const OFFLINE_POLL_MS = 3_000
/** …and this often once a relay is up (only has to notice a dropped socket). */
const ONLINE_POLL_MS = 20_000



export interface NostrTransportOptions {
  relays: string[]
  identity: Identity
  clock: Clock
  /** minimum relays that must accept a publish (capped to relays.length) */
  minAccepts: number
  /** unix seconds to start fetching the mailbox from (default: now - 2 days) */
  since?: number
  /** checked before decrypting a gift wrap */
  isWrapProcessed?: (id: string) => boolean | Promise<boolean>
  /** called after a wrap was opened/ignored so it is never decrypted again */
  markWrapProcessed?: (id: string, createdAt: number, outcome: 'message' | 'ignored') => void | Promise<void>
  onStatus?: (status: TransportStatus, health: Map<string, boolean>) => void
  onUnsupportedVersion?: (from: string) => void
}

/**
 * Nostr transport: NIP-59 gift-wrapped kind-14 rumors published to relays as a
 * public encrypted mailbox. Nothing user-specific is ever cached by the service
 * worker; this is plain WebSocket traffic.
 */
export class NostrTransport {
  readonly id: TransportId = 'nostr'
  private pool: SimplePool

  private subs: SubCloser | null = null
  private cbs = new Set<(env: Envelope) => void>()
  private health = new Map<string, boolean>()
  private current: TransportStatus = 'disconnected'
  private opts: NostrTransportOptions
  /** when the current connection window began — or when a live relay dropped */
  private windowStart = 0
  private poll: ReturnType<typeof setTimeout> | null = null

  constructor(opts: NostrTransportOptions) {
    this.opts = opts
    this.pool = new SimplePool({ enableReconnect: true })
  }

  connect(): void {
    if (this.subs) return
    this.windowStart = Date.now()
    this.setStatus('connecting')
    const since = this.opts.since ?? Math.floor(this.opts.clock.now() / 1000) - 2 * 86_400
    const filter: Filter = { kinds: [1059], '#p': [this.opts.identity.pk], since }
    try {
      this.subs = this.pool.subscribeMany(this.opts.relays, filter, {
        onevent: (ev: NostrEvent) => void this.handleWrap(ev),
        // a relay answering EOSE is proof it is up: flip to online at once
        // instead of waiting for the next poll tick
        oneose: () => this.recomputeHealth(),
        onclose: () => this.recomputeHealth(),
      })
    } catch {
      /* subscribeMany could not even create the subscription: no poll is armed
         (there is nothing to read from the pool) and reconnect() retries */
      return
    }

    // re-read the relay picture on a timer for as long as the transport lives:
    // the old ONE-SHOT 4s check froze the status and left the chip "offline"
    // until the next focus/visibility event (see armPoll)
    this.armPoll()
  }

  /**
   * The ONE place the transport's status is decided, read straight from the pool:
   *
   *  - at least one relay socket is up → `connected`;
   *  - nothing up, but the current attempt window is still open → `connecting`
   *    (relays are being dialed or retried — this is what the header chip shows
   *    at cold start instead of a premature "offline");
   *  - no relay up and the window has run out (or there are no relays at all) →
   *    `disconnected`, the honest verdict.
   */
  private recomputeHealth(): void {
    // stopped (or never started): a late pool callback must not resurrect a status
    if (!this.subs) return
    const m = this.pool.listConnectionStatus()
    // pool keys are normalized URLs (wss://nos.lol → wss://nos.lol/) — compare canonically
    this.health = new Map(this.opts.relays.map((r) => [r, m.get(normalizeRelayUrl(r)) === true || m.get(r) === true] as [string, boolean]))
    const anyConnected = [...this.health.values()].some(Boolean)
    if (anyConnected) {
      this.setStatus('connected')
    } else {
      // a relay that just dropped opens a NEW window: the pool retries it by
      // itself (enableReconnect) and the next poll flips us back to online, so
      // one socket hiccup never reads as "offline" for the rest of the session
      if (this.current === 'connected') this.windowStart = Date.now()
      const expired = Date.now() - this.windowStart >= CONNECT_WINDOW_MS
      this.setStatus(!this.opts.relays.length || expired ? 'disconnected' : 'connecting')
    }
    this.armPoll()
  }

  /**
   * Re-read the relay picture on a timer — fast (3s) while nothing is up so the
   * status corrects itself without a focus/visibility event, slow (20s) once a
   * relay is up, where the only job is noticing a dropped socket.
   */
  private armPoll(): void {
    if (this.poll) clearTimeout(this.poll)
    this.poll = setTimeout(() => {
      this.poll = null
      this.recomputeHealth()
    }, this.current === 'connected' ? ONLINE_POLL_MS : OFFLINE_POLL_MS)
  }


  private setStatus(s: TransportStatus): void {
    if (this.current === s) return
    this.current = s
    this.opts.onStatus?.(s, this.health)
  }

  private async handleWrap(wrap: NostrEvent): Promise<void> {
    // A relay is untrusted. Reject cheaply before NIP-59/NIP-44 work.
    if (!isSafeGiftWrap(wrap)) return
    if (await this.opts.isWrapProcessed?.(wrap.id)) return
    const opened = openWrap(wrap, this.opts.identity.sk)
    if (!opened) {
      await this.opts.markWrapProcessed?.(wrap.id, wrap.created_at, 'ignored')
      return
    }
    if (new TextEncoder().encode(opened.content).byteLength > MAX_ENVELOPE_BYTES) {
      await this.opts.markWrapProcessed?.(wrap.id, wrap.created_at, 'ignored')
      return
    }
    const parsed = parseEnvelope(opened.content)
    if (!parsed.ok) {
      if (parsed.reason === 'unsupported-version') {
        this.opts.onUnsupportedVersion?.(opened.rumor.pubkey)
      }
      await this.opts.markWrapProcessed?.(wrap.id, wrap.created_at, 'ignored')
      return
    }
    // the seal signature verified; the rumor pubkey is the authenticated sender
    if (parsed.env.from !== opened.rumor.pubkey) {
      await this.opts.markWrapProcessed?.(wrap.id, wrap.created_at, 'ignored')
      return
    }
    await this.opts.markWrapProcessed?.(wrap.id, wrap.created_at, 'message')
    for (const cb of this.cbs) cb(parsed.env)
  }

  async send(env: Envelope): Promise<SendResult> {
    const wrap = sealEnvelope(env, this.opts.identity, env.to, env.expireAt)
    try {
      const pubs = this.pool.publish(this.opts.relays, wrap)
      const results = await Promise.allSettled(pubs)
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const min = Math.min(this.opts.minAccepts, this.opts.relays.length)
      return ok >= min ? { ok: true } : { ok: false, error: 'min-relays' }
    } catch {
      return { ok: false, error: 'relay-down' }
    }
  }

  onReceive(cb: (env: Envelope) => void): () => void {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }

  status(): TransportStatus {
    return this.current
  }

  relayHealth(): Map<string, boolean> {
    return new Map(this.health)
  }

  /** Re-evaluate relay connections (on focus/online). */
  reconnect(): void {
    if (this.subs) {
      this.subs.close('reconnect')
      this.subs = null
    }
    this.connect()
  }

  stop(): void {
    try {
      this.subs?.close('stop')
    } catch {
      /* already closed */
    }
    this.subs = null
    if (this.poll) clearTimeout(this.poll)
    this.poll = null
    this.pool.close(this.opts.relays)
    this.setStatus('disconnected')
  }
}

const MAX_WRAP_CONTENT_CHARS = 160 * 1024

/** Structural and signature checks for relay-supplied outer events. */
export function isSafeGiftWrap(wrap: unknown): wrap is NostrEvent {
  if (!wrap || typeof wrap !== 'object') return false
  const event = wrap as Partial<NostrEvent>
  if (event.kind !== 1059 || typeof event.id !== 'string' || !/^[0-9a-f]{64}$/.test(event.id)) return false
  if (typeof event.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(event.pubkey)) return false
  if (typeof event.sig !== 'string' || !/^[0-9a-f]{128}$/.test(event.sig)) return false
  if (typeof event.created_at !== 'number' || !Number.isSafeInteger(event.created_at)) return false
  if (typeof event.content !== 'string' || event.content.length > MAX_WRAP_CONTENT_CHARS) return false
  if (!Array.isArray(event.tags) || event.tags.length > 32) return false
  try {
    // nostr-tools memoizes verification on the event object. Build a clean
    // record so a relay cannot reuse a previously verified mutable object.
    return verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags as string[][],
      content: event.content,
      sig: event.sig,
    })
  } catch {
    return false
  }
}
