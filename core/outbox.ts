import type { Envelope } from './protocol'
import { PROTOCOL_VERSION } from './protocol'
import { newId } from './ids'
import type { Clock } from './clock'

export interface Message {
  id: string
  /** 1-to-1 conversation id = the other party's public key (hex) */
  chatId: string
  from: string
  to: string
  body: string
  replyTo?: string
  ts: number
  /** per-conversation Lamport counter */
  lamport: number
  state: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  createdAt: number
  attempts: number
  nextAttemptAt: number
  expireAt?: number
  direction: 'out' | 'in'
}

export interface OutboxDeps {
  clock: Clock
  /** attempt to deliver one message; resolve true when a transport accepted it */
  send: (msg: Message) => Promise<boolean>
  onStateChange: (msg: Message) => void
  /** persist outbox state */
  save: (msg: Message) => Promise<void>
  remove: (id: string) => Promise<void>
  get: (id: string) => Promise<Message | undefined>
  /** pending messages with nextAttemptAt <= now */
  due: (now: number) => Promise<Message[]>
  /** earliest nextAttemptAt among pending, or null */
  nextAttemptAt: () => Promise<number | null>
}

const BASE_DELAY = 2_000
const MAX_DELAY = 5 * 60_000
const MAX_ATTEMPTS = 8

/**
 * Durable outbox: keeps unsent messages until a delivery receipt (ACK) arrives.
 * Retries with exponential backoff; survives reloads because state lives in Dexie.
 */
export class Outbox {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight = new Set<string>()
  constructor(private deps: OutboxDeps) {}

  /** Enqueue a chat message for sending. */
  async enqueue(msg: Omit<Message, 'id' | 'state' | 'createdAt' | 'attempts' | 'nextAttemptAt' | 'direction'>): Promise<Message> {
    const now = this.deps.clock.now()
    const full: Message = {
      ...msg,
      id: newId(),
      state: 'pending',
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      direction: 'out',
    }
    await this.deps.save(full)
    this.schedule()
    return full
  }

  /** Called when a delivery receipt for `id` arrived. */
  async ack(id: string, read = false): Promise<void> {
    const msg = await this.deps.get(id)
    if (!msg) return
    msg.state = read ? 'read' : 'delivered'
    this.deps.onStateChange(msg)
    await this.deps.save(msg)
  }

  /** Called when at least one transport accepted the message (relay OK / peer got it). */
  async markSent(id: string): Promise<void> {
    const msg = await this.deps.get(id)
    if (!msg || msg.state !== 'pending') return
    msg.state = 'sent'
    this.deps.onStateChange(msg)
    await this.deps.save(msg)
  }

  /** Called when sending failed permanently this round. */
  async markFailed(id: string): Promise<void> {
    const msg = await this.deps.get(id)
    if (!msg) return
    msg.state = 'failed'
    this.deps.onStateChange(msg)
    await this.deps.save(msg)
  }

  async retryFailed(id: string): Promise<void> {
    const msg = await this.deps.get(id)
    if (!msg) return
    msg.state = 'pending'
    msg.attempts = 0
    msg.nextAttemptAt = this.deps.clock.now()
    await this.deps.save(msg)
    this.schedule()
  }

  /** Drop the outbox entry once delivered (keep the message in history). */
  async complete(id: string): Promise<void> {
    await this.deps.remove(id)
  }

  /** Run one sweep over due pending messages. Safe to call on start/reconnect/interval. */
  async process(): Promise<void> {
    const now = this.deps.clock.now()
    const due = await this.deps.due(now)
    for (const msg of due) {
      if (this.inflight.has(msg.id)) continue
      this.inflight.add(msg.id)
      try {
        msg.attempts += 1
        const ok = await this.deps.send(msg)
        if (ok) {
          await this.deps.save({ ...msg, state: msg.state === 'pending' ? 'sent' : msg.state })
          this.deps.onStateChange(msg)
        } else {
          msg.nextAttemptAt = now + backoff(msg.attempts)
          msg.state = msg.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
          await this.deps.save(msg)
          this.deps.onStateChange(msg)
        }
      } catch {
        msg.nextAttemptAt = now + backoff(msg.attempts)
        await this.deps.save(msg)
      } finally {
        this.inflight.delete(msg.id)
      }
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    const tick = async () => {
      this.timer = null
      await this.process()
      const next = await this.deps.nextAttemptAt()
      if (next !== null) {
        const delay = Math.max(500, Math.min(next - this.deps.clock.now(), MAX_DELAY))
        this.timer = setTimeout(tick, delay)
      }
    }
    this.timer = setTimeout(tick, 1_000)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export function backoff(attempt: number): number {
  return Math.min(BASE_DELAY * 2 ** (attempt - 1), MAX_DELAY)
}

/** Convenience factory for a chat-message envelope. */
export function toEnvelope(msg: Message): Envelope {
  return {
    id: msg.id,
    v: PROTOCOL_VERSION,
    type: 'chat',
    from: msg.from,
    to: msg.to,
    ts: msg.ts,
    lamport: msg.lamport,
    body: msg.body,
    replyTo: msg.replyTo,
    expireAt: msg.expireAt,
  }
}
