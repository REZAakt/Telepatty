/**
 * Reply protocol helpers: excerpt creation/sanitisation and the pure parts of
 * the keyboard reply-target cycling. Envelope shape:
 *
 *   replyTo?: { id: string, senderPubkey: string, excerpt: string }
 *
 * Backward compatible: the field rides inside the E2EE envelope, older clients
 * that expect `replyTo` to be a string simply drop it (their parser only accepts
 * strings for that field). Wire version stays at major 1 (see versions.ts).
 */
import type { Envelope, ReplyRef } from './protocol'

/** Hard cap for the excerpt snippet carried in the envelope. */
export const EXCERPT_MAX = 120
/** Reply references must stay small and well-formed. */
const ID_MAX = 80

/** Bidi overrides / control chars never belong in user-visible snippets. */
const BIDI_AND_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g

export type MessageKind = 'text' | 'image' | 'video' | 'file'

/**
 * Build the excerpt for a reply reference. `attachmentLabel` is a pre-localised
 * label ("Photo"/"File"/"Video") used when there is no text to quote — core
 * stays i18n-agnostic, the caller passes the translated label.
 */
export function makeExcerpt(body: string | undefined, attachmentLabel?: string): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  const source = text || attachmentLabel || ''
  return truncateExcerpt(source)
}

/** Trim to EXCERPT_MAX, strip bidi overrides/control chars, collapse spaces. */
export function truncateExcerpt(s: string): string {
  const clean = s.replace(BIDI_AND_CONTROL, '').replace(/\s+/g, ' ').trim()
  if (clean.length <= EXCERPT_MAX) return clean
  return `${clean.slice(0, EXCERPT_MAX - 1)}…`
}

/** Validate + sanitise an incoming replyTo object; undefined when unusable. */
export function sanitizeReplyRef(raw: unknown): ReplyRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.slice(0, ID_MAX) : ''
  const sender = typeof r.senderPubkey === 'string' ? r.senderPubkey.toLowerCase() : ''
  const excerpt = typeof r.excerpt === 'string' ? truncateExcerpt(r.excerpt) : ''
  if (!id || !/^[0-9a-f]{64}$/.test(sender)) return undefined
  return { id, senderPubkey: sender, excerpt }
}

/** Build a reply reference from locally stored message fields (sender side). */
export function replyRefOf(
  id: string | undefined,
  senderPubkey: string,
  excerpt: string | undefined,
): ReplyRef | undefined {
  if (!id || !/^[0-9a-f]{64}$/.test(senderPubkey)) return undefined
  return { id, senderPubkey, excerpt: truncateExcerpt(excerpt ?? '') }
}

/** Extract the (sanitised) reply reference from an envelope, if any. */
export function replyRefFromEnvelope(env: Envelope): ReplyRef | undefined {
  return sanitizeReplyRef(env.replyTo)
}

/* ------------------------------------------------------------------ */
/* Keyboard reply-target cycling (Arrow Up / Arrow Down / Esc)         */
/* ------------------------------------------------------------------ */

export type CycleDirection = 'up' | 'down'

/**
 * Pure target cycler for "Arrow Up in an empty composer".
 * `list` is ordered oldest → newest.
 * - up:   from none → newest; from a target → the previous (older) one
 * - down: from a target → the next (newer) one; past the newest → cancel (null)
 */
export function cycleReplyTarget(list: { id: string }[], currentId: string | null, dir: CycleDirection): string | null {
  if (!list.length) return null
  const ids = list.map((m) => m.id)
  const newest = ids[ids.length - 1] ?? null
  const oldest = ids[0] ?? null
  if (dir === 'up') {
    // unknown/stale current id → start from the newest
    if (currentId === null) return newest
    const i = ids.lastIndexOf(currentId)
    if (i === -1) return newest
    if (i === 0) return oldest // already the oldest — stay
    return ids[i - 1] ?? oldest
  }
  if (currentId === null) return null
  const i = ids.indexOf(currentId)
  if (i === -1 || i === ids.length - 1) return null // past newest → cancel
  return ids[i + 1] ?? null
}

/**
 * May ArrowUp start/continue cycling right now? Only when the composer is empty,
 * the caret sits at the very start, and no IME composition is running.
 */
export function canStartReplyCycle(input: {
  value: string
  selectionStart: number
  selectionEnd: number
  isComposing: boolean
}): boolean {
  if (input.isComposing) return false
  if (input.value.length > 0) return false
  return input.selectionStart === 0 && input.selectionEnd === 0
}
