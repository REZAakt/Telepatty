import { generateSecretKey, getPublicKey, nip19, nip59, finalizeEvent, verifyEvent } from 'nostr-tools'
import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'
import type { Envelope } from './protocol'
import { serializeEnvelope } from './protocol'

/** Identity = a secp256k1 keypair generated in the browser. */
export interface Identity {
  /** secret key, 32 bytes */
  sk: Uint8Array
  /** public key, hex */
  pk: string
}

export function generateIdentity(): Identity {
  const sk = generateSecretKey()
  return { sk, pk: getPublicKey(sk) }
}

export function identityFromSk(sk: Uint8Array): Identity {
  return { sk, pk: getPublicKey(sk) }
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Public key as bech32 npub (shareable friend code). */
export function npubEncode(pk: string): string {
  return nip19.npubEncode(pk)
}

/** Public key as bech32 nsec (recovery key — keep secret). */
export function nsecEncode(sk: Uint8Array): string {
  return nip19.nsecEncode(sk)
}

/** Decode npub/nsec/hex into raw bytes. Returns null when invalid. */
export function decodeKey(code: string): Uint8Array | null {
  const c = code.trim()
  try {
    if (c.startsWith('npub') || c.startsWith('nsec')) {
      const d = nip19.decode(c)
      if (d.type === 'npub' || d.type === 'nsec') {
        // nostr-tools bech32 decode returns a hex string for keys
        const data = d.data as unknown as Uint8Array | string
        if (typeof data === 'string') return hexToBytes(data.toLowerCase())
        return data
      }
      return null
    }
  } catch {
    return null
  }
  if (/^[0-9a-fA-F]{64}$/.test(c)) return hexToBytes(c.toLowerCase())
  return null
}


/**
 * Seal an envelope for `toPk` as a NIP-59 gift wrap:
 * rumor (kind 14, content = JSON envelope) → seal (kind 13, signed + NIP-44
 * encrypted) → wrap (kind 1059, encrypted to the recipient). The seal's
 * signature is verified on unwrap, so every received envelope is authenticated.
 * `expireAt` adds a NIP-40 `expiration` tag on the wrap for relays that honor it.
 */
export function sealEnvelope(env: Envelope, from: Identity, toPk: string, expireAt?: number): NostrEvent {
  const tags: string[][] = [['p', toPk]]
  if (expireAt) tags.push(['expiration', String(Math.floor(expireAt / 1000))])
  const rumor = nip59.createRumor(
    {
      kind: 14,
      pubkey: from.pk,
      created_at: Math.floor(env.ts / 1000),
      tags,
      content: serializeEnvelope(env),
    },
    from.sk,
  )
  // expiration tag rides on the wrap too (relays filter kind 1059 by tag)
  const wrap = nip59.wrapEvent(rumor, from.sk, toPk)
  if (expireAt) {
    wrap.tags = [...(wrap.tags ?? []), ['expiration', String(Math.floor(expireAt / 1000))]]
  }
  return wrap
}


/**
 * Unwrap a gift-wrapped event. Returns the rumor (with `id`, `pubkey`) or null
 * when decryption or seal-signature verification fails.
 */
export function openWrap(
  wrap: NostrEvent,
  sk: Uint8Array,
): { rumor: UnsignedEvent & { id: string }; content: string } | null {
  try {
    const rumor = nip59.unwrapEvent(wrap, sk)
    return { rumor, content: rumor.content }
  } catch {
    return null
  }
}


export { verifyEvent }
