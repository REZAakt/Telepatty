import type { Envelope } from './protocol'
import type { TelepattyDb } from './db'
import type { Clock } from './clock'

/**
 * Purge disappearing messages whose expireAt has passed.
 * Enforced locally on both sides; runs at app start and on an interval.
 * Note: a modified client can ignore the timer — enforced only by honesty.
 */
export async function purgeExpired(db: TelepattyDb, clock: Clock): Promise<number> {
  const now = clock.now()
  const expired = await db.messages.filter((m) => m.expireAt !== undefined && m.expireAt <= now).primaryKeys()
  await db.messages.bulkDelete(expired)
  return expired.length
}
