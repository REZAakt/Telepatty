/** App-lock crypto: encrypt the secret key at rest with AES-GCM + PBKDF2. */
import type { LockBlob } from './db'

const ITERATIONS = 310_000

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Encrypt a hex secret key with the passphrase. */
export async function encryptSk(skHex: string, passphrase: string): Promise<LockBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(skHex))
  return { salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)), iterations: ITERATIONS }
}

/** Decrypt the secret key. Returns null on wrong passphrase. */
export async function decryptSk(blob: LockBlob, passphrase: string): Promise<string | null> {
  try {
    const key = await deriveKey(passphrase, unb64(blob.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, key, unb64(blob.ct) as BufferSource)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/** Session lifetime: 60 days, renewed on every unlock. */
export const SESSION_DAYS = 60

export function sessionExpiry(now: number, days = SESSION_DAYS): number {
  return now + days * 86_400_000
}
