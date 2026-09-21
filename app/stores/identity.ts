import { defineStore } from 'pinia'
import { generateIdentity, bytesToHex, hexToBytes, identityFromSk, decodeKey } from '~~/core/crypto'
import { encryptSk, decryptSk, sessionExpiry } from '~~/core/lock'
import { getDb, type IdentityRow } from '~~/core/db'
import { useSettingsStore } from './settings'


export const useIdentityStore = defineStore('identity', {
  state: () => ({
    pk: '',
    /** secret key hex, in memory only after unlock */
    skHex: '',
    displayName: '',
    hasLock: false,
    locked: false,
    sessionExpiresAt: 0,
    /** identity exists in db */
    exists: false,
    initialized: false,
  }),
  getters: {
    ready: (s) => s.initialized && s.exists && !s.locked && !!s.skHex,
    skBytes: (s) => (s.skHex ? hexToBytes(s.skHex) : null),
  },
  actions: {
    async bootstrap(): Promise<void> {
      const db = getDb()
      const row = await db.identity.get('me')
      if (!row) {
        this.initialized = true
        return
      }
      this.pk = row.pk
      this.displayName = row.displayName ?? ''
      this.hasLock = !!row.lock
      this.sessionExpiresAt = row.sessionExpiresAt ?? 0
      this.exists = true
      if (row.lock) {
        // locked until user unlocks; also re-lock when session expired
        const now = Date.now()
        if (row.sessionExpiresAt && row.sessionExpiresAt < now) this.locked = true
        else this.locked = true // start locked every launch when lock is enabled
      } else {
        this.skHex = row.sk
        this.locked = false
      }
      this.initialized = true
    },

    /** Fresh keypair on first launch. (No phone number — identity is just a keypair.) */
    async create(displayName: string, lockPass?: string): Promise<IdentityRow> {
      const db = getDb()
      const id = generateIdentity()
      const now = Date.now()
      const lock = lockPass ? await encryptSk(bytesToHex(id.sk), lockPass) : undefined
      const row: IdentityRow = {
        id: 'me',
        pk: id.pk,
        sk: lock ? '' : bytesToHex(id.sk),
        displayName: displayName || undefined,
        createdAt: now,
        lock,
        sessionExpiresAt: lock ? sessionExpiry(now) : undefined,
      }
      await db.identity.put(row)
      this.pk = row.pk
      this.skHex = bytesToHex(id.sk)
      this.displayName = row.displayName ?? ''
      this.hasLock = !!lock
      this.locked = false
      this.sessionExpiresAt = row.sessionExpiresAt ?? 0
      this.exists = true
      this.initialized = true
      return row
    },

    /** Restore from an exported nsec key. */
    async restore(nsec: string, displayName?: string, lockPass?: string): Promise<boolean> {
      const bytes = decodeKey(nsec)
      if (!bytes || bytes.length !== 32) return false
      const db = getDb()
      const id = identityFromSk(bytes)
      const now = Date.now()
      const lock = lockPass ? await encryptSk(bytesToHex(bytes), lockPass) : undefined
      const row: IdentityRow = {
        id: 'me',
        pk: id.pk,
        sk: lock ? '' : bytesToHex(bytes),
        displayName: displayName || undefined,
        createdAt: now,
        lock,
        sessionExpiresAt: lock ? sessionExpiry(now) : undefined,
      }
      await db.identity.put(row)
      this.$patch({ pk: row.pk, skHex: bytesToHex(bytes), displayName: row.displayName ?? '', hasLock: !!lock, locked: false, sessionExpiresAt: row.sessionExpiresAt ?? 0, exists: true, initialized: true })
      return true
    },

    /** Decrypt the key with the passphrase; renews the session on success. */
    async unlock(pass: string): Promise<boolean> {
      const db = getDb()
      const row = await db.identity.get('me')
      if (!row?.lock) return false
      const sk = await decryptSk(row.lock, pass)
      if (!sk) return false
      const now = Date.now()
      this.sessionExpiresAt = sessionExpiry(now, useSettingsStore().sessionDays)

      await db.identity.put({ ...row, sk: '', sessionExpiresAt: this.sessionExpiresAt })
      this.skHex = sk
      this.locked = false
      return true
    },

    async setLock(pass: string): Promise<void> {
      const db = getDb()
      const row = await db.identity.get('me')
      if (!row) return
      const lock = await encryptSk(this.skHex, pass)
      await db.identity.put({ ...row, sk: '', lock, sessionExpiresAt: sessionExpiry(Date.now()) })
      this.hasLock = true
    },

    async removeLock(): Promise<void> {
      const db = getDb()
      const row = await db.identity.get('me')
      if (!row) return
      await db.identity.put({ ...row, lock: undefined, sessionExpiresAt: undefined })
      this.hasLock = false
    },

    async setProfile(displayName: string): Promise<void> {
      const db = getDb()
      const row = await db.identity.get('me')
      if (!row) return
      await db.identity.put({ ...row, displayName: displayName || undefined })
      this.displayName = displayName
    },

    lockNow(): void {
      if (!this.hasLock) return
      this.locked = true
      this.skHex = ''
    },

    async wipe(): Promise<void> {
      const db = getDb()
      await db.delete()
      this.$reset()
      this.initialized = false
    }
  },
})

