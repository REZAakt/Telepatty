import { defineStore } from 'pinia'
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '~~/core/theme'

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


export interface SettingsState {
  appearance: AppearanceSettings
  language: 'en' | 'fa'
  jalali: boolean
  persianDigits: boolean
  relays: string[]
  requireMinRelays: boolean
  readReceipts: boolean
  disappearDefault: number
  sessionDays: number
  iceServersText: string
  notifHideContent: boolean
  /** auto-download images from friends (default on, up to the file cap) */
  autoDownloadImages: boolean
  health: Record<string, RelayHealth>
  /** relays currently being probed (transient, never persisted) */
  probing: Record<string, boolean>
  loaded: boolean
}


export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    appearance: { ...DEFAULT_APPEARANCE },
    language: 'en',
    jalali: false,
    persianDigits: false,
    relays: [...DEFAULT_RELAYS],
    requireMinRelays: true,
    readReceipts: true,
    disappearDefault: 0,
    sessionDays: 60,
    iceServersText: DEFAULT_ICE,
    notifHideContent: false,
    autoDownloadImages: true,
    health: {},
    probing: {},
    loaded: false,
  }),

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
    async load(): Promise<void> {
      const db = (await import('~~/core/db')).getDb()
      const row = await db.settings.get('settings')
      if (row) {
        const s = row.value as Partial<SettingsState>
        Object.assign(this, {
          ...s,
          appearance: { ...DEFAULT_APPEARANCE, ...(s.appearance ?? {}) },
          health: s.health ?? {},
          loaded: true,
        })
      }
      // upgrade legacy default relay list to the current one (keeps user customizations)
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
      if (same(this.relays, LEGACY_DEFAULT_RELAYS)) this.relays = [...DEFAULT_RELAYS]
      if (!this.relays.length) this.relays = [...DEFAULT_RELAYS]
      this.loaded = true
    },

    async persist(): Promise<void> {
      const { getDb, setSetting } = await import('~~/core/db')
      const { appearance, language, jalali, persianDigits, relays, requireMinRelays, readReceipts, disappearDefault, sessionDays, iceServersText, notifHideContent, autoDownloadImages } = this
      await setSetting(getDb(), 'settings', { appearance, language, jalali, persianDigits, relays, requireMinRelays, readReceipts, disappearDefault, sessionDays, iceServersText, notifHideContent, autoDownloadImages })
    },
    update(patch: Partial<SettingsState>): void {
      Object.assign(this, patch)
      void this.persist()
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

