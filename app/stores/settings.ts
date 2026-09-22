import { defineStore } from 'pinia'
import {
  browserLanguages,
  defaultSettings,
  mergeSettings,
  readStoredSettings,
  safeStorage,
  sanitizePartialSettings,
  writeStoredSettings,
  type PersistedSettings,
} from '~~/core/prefs'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
]

/** Relays shipped before the 0.1.1 fix; auto-upgraded so existing installs get working defaults. */
const LEGACY_DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://nostr.oxtr.dev',
]


export const DEFAULT_ICE = 'stun:stun.l.google.com:19302'

export interface RelayHealth {
  ok: boolean
  latency?: number
  reason?: 'timeout' | 'error' | 'closed' | 'unsupported'
  closeCode?: number
  checkedAt?: number
}


/**
 * Persisted fields come from core/prefs.ts (one versioned localStorage
 * snapshot, mirrored with IndexedDB); only transient fields live here.
 */
export interface SettingsState extends PersistedSettings {
  health: Record<string, RelayHealth>
  /** relays currently being probed (transient, never persisted) */
  probing: Record<string, boolean>
  loaded: boolean
}


export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => {
    // Synchronous restore BEFORE the first render: this store is created by the
    // client bootstrap plugin (before mount), so the first frame already has
    // the saved language/theme — no flash. Saved values are merged over the
    // defaults and the store NEVER re-initializes to defaults when a value was
    // saved (that was the hydration/ordering race of the old code).
    const base = defaultSettings(browserLanguages())
    base.relays = [...DEFAULT_RELAYS]
    base.iceServersText = DEFAULT_ICE
    const merged = mergeSettings(base, readStoredSettings(safeStorage()))
    return {
      ...merged,
      appearance: { ...merged.appearance },
      relays: [...merged.relays],
      health: {},
      probing: {},
      loaded: false,
    }
  },

  getters: {
    minRelays(state): number {
      return state.requireMinRelays ? Math.min(3, state.relays.length) : 1
    },
    iceServers(state): { urls: string | string[]; username?: string; credential?: string }[] {
      return state.iceServersText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          // turn:user:pass@host:port
          const m = /^turn:([^:]+):([^@]+)@(.+)$/.exec(line)
          if (m) return { urls: `turn:${m[3]}`, username: m[1], credential: m[2] }
          return { urls: line }
        })
    },
  },
  actions: {
    /** Plain, structured-cloneable copy of the persisted fields. */
    snapshot(): PersistedSettings {
      return {
        appearance: { ...this.appearance },
        language: this.language,
        jalali: this.jalali,
        persianDigits: this.persianDigits,
        relays: [...this.relays],
        requireMinRelays: this.requireMinRelays,
        readReceipts: this.readReceipts,
        sessionDays: this.sessionDays,
        iceServersText: this.iceServersText,
        notifMessages: this.notifMessages,
        notifHideContent: this.notifHideContent,
        autoDownloadImages: this.autoDownloadImages,
        sounds: this.sounds,
      }
    },

    /** Replace persisted fields from a validated snapshot (transient state untouched). */
    assignMerged(m: PersistedSettings): void {
      this.appearance = { ...m.appearance }
      this.language = m.language
      this.jalali = m.jalali
      this.persianDigits = m.persianDigits
      this.relays = [...m.relays]
      this.requireMinRelays = m.requireMinRelays
      this.readReceipts = m.readReceipts
      this.sessionDays = m.sessionDays
      this.iceServersText = m.iceServersText
      this.notifMessages = m.notifMessages
      this.notifHideContent = m.notifHideContent
      this.autoDownloadImages = m.autoDownloadImages
      this.sounds = m.sounds
    },

    async load(): Promise<void> {
      // IndexedDB is the richer copy but it is async — the synchronous
      // localStorage snapshot (state()) already holds valid values, so the
      // merge below only ever OVERRIDES with real saved values, never resets.
      let row: { value: unknown } | undefined
      try {
        const db = (await import('~~/core/db')).getDb()
        row = await db.settings.get('settings')
      } catch (e) {
        console.warn('[telepatty] settings: IndexedDB unavailable — keeping localStorage values', e)
      }
      if (row) {
        // Deleted fields (e.g. the removed `disappearDefault`) simply never
        // survive sanitizePartialSettings, so stale rows cannot resurrect them.
        this.assignMerged(mergeSettings(this.snapshot(), sanitizePartialSettings(row.value)))
      }
      // upgrade legacy default relay list to the current one (keeps user customizations)
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
      if (same(this.relays, LEGACY_DEFAULT_RELAYS)) this.relays = [...DEFAULT_RELAYS]
      if (!this.relays.length) this.relays = [...DEFAULT_RELAYS]
      this.loaded = true
      // keep the synchronous mirror in sync with the authoritative DB copy
      writeStoredSettings(this.snapshot(), safeStorage())
    },

    /**
     * Persist the settings as a PLAIN (non-reactive) snapshot.
     *
     * REGRESSION: this used to hand Dexie the store's reactive proxies
     * (`this.appearance` / `this.relays`) — IndexedDB structured clone cannot
     * clone proxies, so EVERY write rejected with `DataCloneError` and nothing
     * was ever saved (all settings reset on reload). The JSON round-trip
     * guarantees a cloneable plain object, the write is wrapped so a private-
     * mode/quota failure can never break the UI, and the same snapshot is
     * mirrored to the versioned localStorage key for the no-flash boot.
     */
    async persist(): Promise<void> {
      const snap = JSON.parse(JSON.stringify(this.snapshot())) as PersistedSettings
      writeStoredSettings(snap, safeStorage())
      try {
        const { getDb, setSetting } = await import('~~/core/db')
        await setSetting(getDb(), 'settings', snap)
      } catch (e) {
        console.warn('[telepatty] settings: IndexedDB persist failed — kept in localStorage', e)
      }
    },
    update(patch: Partial<SettingsState>): void {
      Object.assign(this, patch)
      void this.persist()
    },
    /** Restore the 5 shipped default relays (user list is replaced). */
    resetRelays(): void {
      this.update({ relays: [...DEFAULT_RELAYS] })
      void this.probeRelays(true)
    },
    setHealth(url: string, h: RelayHealth): void {
      this.health = { ...this.health, [url]: h }
    },
    /** REQ→EOSE probe of a single relay; result lands in `health` with a reason. */
    async probeRelay(url: string): Promise<void> {
      if (!import.meta.client || this.probing[url]) return
      this.probing = { ...this.probing, [url]: true }
      try {
        const { probeRelay } = await import('~~/core/relay-health')
        const res = await probeRelay(url, { timeoutMs: 9_000 })
        this.setHealth(url, {
          ok: res.ok,
          latency: res.latency,
          reason: res.reason,
          closeCode: res.closeCode,
          checkedAt: Date.now(),
        })
      } finally {
        const next = { ...this.probing }
        delete next[url]
        this.probing = next
      }
    },
    /** Probe all configured relays; fresh results (<60s) are skipped unless forced. */
    async probeRelays(force = false): Promise<void> {
      const now = Date.now()
      const targets = this.relays.filter((r) => {
        if (force) return true
        const h = this.health[r]
        return !h?.checkedAt || now - h.checkedAt > 60_000
      })
      await Promise.all(targets.map((r) => this.probeRelay(r)))
    },
  },
})

