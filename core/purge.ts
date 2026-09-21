import type { Envelope } from './protocol'
import type { TelepattyDb } from './db'
import type { Clock } from './clock'

/**
 * Purge disappearing messages whose expireAt has passed — and their file blobs.
 * Enforced locally on both sides; runs at app start and on an interval.
 * Note: a modified client can ignore the timer — enforced only by honesty.
 *
 * Additionally enforces the FIXED local retention window: messages (and their
 * files) older than 3 months are removed. This is not a setting — the window
 * is hardcoded so local storage cannot grow without bound.
 */
/** Fixed retention window: 3 months (~90 days). */
export const RETENTION_MS = 90 * 86_400_000

export async function purgeExpired(db: TelepattyDb, clock: Clock): Promise<number> {
  const now = clock.now()
  const expired = await db.messages.filter((m) => m.expireAt !== undefined && m.expireAt <= now).primaryKeys()
  await db.messages.bulkDelete(expired)
  // files whose owning message expired (or whose own mirrored expiry passed)
  await db.files.where('expireAt').belowOrEqual(now).delete()
  const orphaned = await db.files
    .filter((f) => f.messageId !== undefined && expired.includes(f.messageId))
    .primaryKeys()
  if (orphaned.length) await db.files.bulkDelete(orphaned)

  // fixed 3-month retention: everything strictly older goes, together with its
  // files. Never touches anything newer (disappearing timers still win).
  const cutoff = now - RETENTION_MS
  const oldIds = await db.messages.filter((m) => m.ts < cutoff).primaryKeys()
  if (oldIds.length) {
    await db.messages.bulkDelete(oldIds)
    const oldFiles = await db.files
      .filter((f) => f.messageId !== undefined && oldIds.includes(f.messageId))
      .primaryKeys()
    if (oldFiles.length) await db.files.bulkDelete(oldFiles)
  }
  return expired.length + oldIds.length
}

