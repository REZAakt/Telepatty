import { SimplePool } from 'nostr-tools'
import type { SubCloser } from 'nostr-tools/abstract-pool'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { sealEnvelope, openWrap } from './crypto'
import type { Identity } from './crypto'
import type { Envelope } from './protocol'
import { parseEnvelope } from './protocol'
import type { Clock } from './clock'
import type { SendResult, TransportId, TransportStatus } from './router'
import { normalizeRelayUrl } from './relay-health'



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

  constructor(opts: NostrTransportOptions) {
    this.opts = opts
    this.pool = new SimplePool({ enableReconnect: true })
  }

  connect(): void {
    if (this.subs) return
    this.setStatus('connecting')
    const since = this.opts.since ?? Math.floor(this.opts.clock.now() / 1000) - 2 * 86_400
    const filter: Filter = { kinds: [1059], '#p': [this.opts.identity.pk], since }
    try {
      this.subs = this.pool.subscribeMany(this.opts.relays, filter, {
        onevent: (ev: NostrEvent) => void this.handleWrap(ev),
        onclose: () => this.recomputeHealth(),
      })
    } catch {
      /* relays unreachable — status stays connecting; retry via reconnect() */
    }

    setTimeout(() => {
      this.recomputeHealth()
    }, 4_000)
  }

  private recomputeHealth(): void {
    const m = this.pool.listConnectionStatus()
    // pool keys are normalized URLs (wss://nos.lol → wss://nos.lol/) — compare canonically
    this.health = new Map(this.opts.relays.map((r) => [r, m.get(normalizeRelayUrl(r)) === true || m.get(r) === true] as [string, boolean]))
    const anyConnected = [...this.health.values()].some(Boolean)
    this.setStatus(anyConnected ? 'connected' : 'disconnected')
  }


  private setStatus(s: TransportStatus): void {
    if (this.current === s) return
    this.current = s
    this.opts.onStatus?.(s, this.health)
  }

  private async handleWrap(wrap: NostrEvent): Promise<void> {
    if (await this.opts.isWrapProcessed?.(wrap.id)) return
    const opened = openWrap(wrap, this.opts.identity.sk)
    if (!opened) {
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
    this.pool.close(this.opts.relays)
    this.setStatus('disconnected')
  }
}
