import Dexie, { type Table } from 'dexie'

export interface IdentityRow {
  id: 'me'
  pk: string
  /** hex secret key — encrypted when app lock is enabled */
  sk: string
  displayName?: string
  phone?: string
  createdAt: number
  /** when set, `sk` holds an encrypted blob and unlocking requires the passphrase */
  lock?: LockBlob
  /** session must be re-unlocked after this time (60 days by default) */
  sessionExpiresAt?: number
}

export interface LockBlob {
  salt: string
  iv: string
  ct: string
  iterations: number
}

export interface FriendRow {
  pk: string
  /** label from the invite (unverified) */
  name?: string
  /** local nickname set by the user */
  nickname?: string
  phone?: string
  addedAt: number
  verified: boolean
  pinned: boolean
  mutedUntil?: number
  archived: boolean
  /** disappearing timer seconds; 0/undefined = off */
  expireAfter?: number
}

export interface RequestRow {
  pk: string
  name?: string
  at: number
  direction: 'in' | 'out'
}

export interface BlockRow {
  pk: string
  at: number
}

export interface ChatMessageRow {
  id: string
  chatId: string
  from: string
  to: string
  body: string
  replyTo?: string
  ts: number
  lamport: number
  state: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  createdAt: number
  attempts: number
  nextAttemptAt: number
  expireAt?: number
  direction: 'out' | 'in'
}

export interface QueueRow {
  /** envelope id */
  id: string
  env: string
  attempts: number
  nextAt: number
  lastError?: string
}

export interface SettingRow {
  key: string
  value: unknown
}

export const SCHEMA_VERSION = 3

export class TelepattyDb extends Dexie {
  identity!: Table<IdentityRow, string>
  friends!: Table<FriendRow, string>
  requests!: Table<RequestRow, string>
  blocks!: Table<BlockRow, string>
  messages!: Table<ChatMessageRow, string>
  queue!: Table<QueueRow, string>
  settings!: Table<SettingRow, string>

  constructor(name = 'telepatty') {
    super(name)
    // v1: initial schema (no expireAt index, disappearing messages not yet supported)
    this.version(1).stores({
      identity: 'id',
      friends: 'pk, addedAt',
      requests: 'pk, at',
      blocks: 'pk',
      messages: 'id, chatId, state, nextAttemptAt, [chatId+lamport]',
      queue: 'id, nextAt',
      settings: 'key',
    })
    // v2: disappearing messages — add expireAt index and backfill from legacy per-chat timers
    this.version(2)
      .stores({
        messages: 'id, chatId, state, nextAttemptAt, expireAt, [chatId+lamport]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('messages')
          .toCollection()
          .modify((msg: ChatMessageRow & { ttlDays?: number }) => {
            if (msg.ttlDays && msg.ttlDays > 0 && !msg.expireAt) {
              msg.expireAt = msg.createdAt + msg.ttlDays * 86_400_000
              delete msg.ttlDays
            }
          })
      })
    // v3: lamport must be its own index (orderBy('lamport') requires it)
    this.version(3).stores({
      messages: 'id, chatId, state, nextAttemptAt, expireAt, lamport, [chatId+lamport]',
    })
  }
}


let dbSingleton: TelepattyDb | null = null

export function getDb(): TelepattyDb {
  if (!dbSingleton) dbSingleton = new TelepattyDb()
  return dbSingleton
}

export function setDb(db: TelepattyDb | null): void {
  dbSingleton = db
}

export async function getSetting<T>(db: TelepattyDb, key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}

export async function setSetting(db: TelepattyDb, key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
