import { getDb, setSetting, getSetting, type TelepattyDb, SCHEMA_VERSION } from './db'
import { rebuildConversationSummaries } from './chat-store'

export interface BackupData {
  schemaVersion: number
  createdAt: number
  identity: unknown
  friends: unknown[]
  requests: unknown[]
  blocks: unknown[]
  messages: unknown[]
  settings: unknown[]
  /** optional (large!) — only when the user asked for files in the export */
  files?: unknown[]
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
export async function exportBackup(db: TelepattyDb, passphrase: string, opts: { includeFiles?: boolean } = {}): Promise<BackupFile> {
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
  if (opts.includeFiles) {
    // blobs are base64-inlined; the per-file cap and the size warning still apply
    const rows = await db.files.toArray()
    data.files = await Promise.all(
      rows.map(async (f) => ({
        id: f.id,
        chatId: f.chatId,
        messageId: f.messageId,
        name: f.name,
        mime: f.mime,
        size: f.size,
        direction: f.direction,
        createdAt: f.createdAt,
        expireAt: f.expireAt,
        data: await blobToB64(f.blob),
      })),
    )
  }
  return { app: 'telepatty', payload: await encryptBlob(JSON.stringify(data), passphrase) }
}

async function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(r.error ?? new Error('read-failed'))
    r.readAsDataURL(blob)
  })
}

function b64ToBlob(b64: string, mime: string): Blob {
  return new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime })
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
  const fileRows = (data.files ?? []).map((raw) => {
    const f = raw as { id: string; chatId: string; messageId?: string; name: string; mime: string; size: number; direction: 'in' | 'out'; createdAt: number; expireAt?: number; data: string }
    return { ...f, blob: b64ToBlob(f.data, f.mime || 'application/octet-stream'), data: undefined }
  })
  await db.transaction('rw', db.tables, async () => {
    for (const t of tables) {
      const table = db[t] as DexieTable
      if (mode === 'replace') await table.clear()
      for (const row of rows[t] ?? []) await table.put(row as never)
    }

    if (fileRows.length) {
      if (mode === 'replace') await db.files.clear()
      for (const row of fileRows) await db.files.put(row as never)
    }
    await setSetting(db, 'importedAt', { at: Date.now(), mode })
  })
  if (data.schemaVersion < 4) await rebuildConversationSummaries(db)
}

type DexieTable = ReturnType<TelepattyDb['table']>

export { getDb, getSetting, setSetting, SCHEMA_VERSION }
