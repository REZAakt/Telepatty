import { getDb, setSetting, getSetting, type TelepattyDb, SCHEMA_VERSION } from './db'

export interface BackupData {
  schemaVersion: number
  createdAt: number
  identity: unknown
  friends: unknown[]
  requests: unknown[]
  blocks: unknown[]
  messages: unknown[]
  settings: unknown[]
}

export interface BackupFile {
  app: 'telepatty'
  /** envelope describing the encrypted payload */
  payload: {
    salt: string
    iv: string
    ct: string
    iterations: number
  }
}

const PBKDF2_ITERATIONS = 250_000

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export async function encryptBlob(data: string, passphrase: string): Promise<BackupFile['payload']> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(data))
  return { salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)), iterations: PBKDF2_ITERATIONS }
}

export async function decryptBlob(payload: BackupFile['payload'], passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, unb64(payload.salt), payload.iterations)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) as BufferSource }, key, unb64(payload.ct) as BufferSource)
  return new TextDecoder().decode(pt)
}

/** Export everything as a passphrase-encrypted JSON file. */
export async function exportBackup(db: TelepattyDb, passphrase: string): Promise<BackupFile> {
  const data: BackupData = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    identity: (await db.identity.toArray())[0] ?? null,
    friends: await db.friends.toArray(),
    requests: await db.requests.toArray(),
    blocks: await db.blocks.toArray(),
    messages: await db.messages.toArray(),
    settings: (await db.settings.toArray()).filter((s) => s.key !== 'lock'),
  }
  return { app: 'telepatty', payload: await encryptBlob(JSON.stringify(data), passphrase) }
}

export type ImportResult =
  | { ok: true; mode: 'merge' | 'replace'; data: BackupData }
  | { ok: false; reason: 'bad-passphrase' | 'newer-schema' | 'invalid' }

/** Parse + decrypt a backup file. Refuses newer schema versions with a clear reason. */
export async function parseBackup(file: unknown, passphrase: string): Promise<ImportResult> {
  const f = file as BackupFile | null
  if (!f || f.app !== 'telepatty' || !f.payload?.ct) return { ok: false, reason: 'invalid' }
  let raw: string
  try {
    raw = await decryptBlob(f.payload, passphrase)
  } catch {
    return { ok: false, reason: 'bad-passphrase' }
  }
  let data: BackupData
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!data || typeof data.schemaVersion !== 'number') return { ok: false, reason: 'invalid' }
  if (data.schemaVersion > SCHEMA_VERSION) return { ok: false, reason: 'newer-schema' }
  return { ok: true, mode: 'merge', data }
}

/** Import with merge (keeps newer rows by key) or replace (wipes then writes). */
export async function importBackup(db: TelepattyDb, data: BackupData, mode: 'merge' | 'replace'): Promise<void> {
  const tables = ['identity', 'friends', 'requests', 'blocks', 'messages', 'settings'] as const
  const rows: Record<string, unknown[]> = {
    identity: data.identity ? [data.identity] : [],
    friends: data.friends ?? [],
    requests: data.requests ?? [],
    blocks: data.blocks ?? [],
    messages: data.messages ?? [],
    settings: data.settings ?? [],
  }
  await db.transaction('rw', db.tables, async () => {
    for (const t of tables) {
      const table = db[t] as DexieTable
      if (mode === 'replace') await table.clear()
      for (const row of rows[t] ?? []) await table.put(row as never)
    }

    await setSetting(db, 'importedAt', { at: Date.now(), mode })
  })
}

type DexieTable = ReturnType<TelepattyDb['table']>

export { getDb, getSetting, setSetting, SCHEMA_VERSION }
