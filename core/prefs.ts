/**
 * ONE versioned localStorage snapshot of every user setting (`tp.prefs.v1`).
 *
 * Why this exists (root cause of "settings reset after reload"): the settings
 * store persisted ONLY through IndexedDB, and its `persist()` handed Dexie the
 * store's reactive objects (`this.appearance`, `this.relays`). IndexedDB
 * structured-clones values, and structured clone REJECTS Vue reactive proxies —
 * every write died with `DataCloneError: #<Object> could not be cloned`, so
 * nothing was ever saved and each reload restored defaults. localStorage is
 * also the only store readable synchronously before first paint, which the
 * no-flash boot needs (IndexedDB is async).
 *
 * Pure + unit-testable: this module never imports the store. All storage
 * access is wrapped in try/catch (Safari private mode throws on access, quota
 * on write) and every value read back is validated field by field — corrupted
 * storage can only produce safe defaults, never a crash, and merging saved
 * values over defaults can never clobber a saved value with a default.
 *
 * Legacy migration: 0.1.x mirrored appearance to `tp.appearance` and language
 * to `tp.lang`. Those keys are read once if the new key is missing, then live
 * inside the new snapshot.
 */
import { DEFAULT_APPEARANCE, THEME_PRESETS, accentFor, type AppearanceSettings, type ThemePreset } from './theme'
import { dirForLocale, langTagForLocale } from './rtl'

/** THEME_PRESETS is non-empty, but noUncheckedIndexedAccess needs a typed fallback. */
const PRESET_FALLBACK: ThemePreset = THEME_PRESETS[0] ?? {
  id: 'matrix',
  primary: 'green',
  neutral: 'zinc',
  accent: '#00ff9d',
  label: 'Matrix',
}

/** Schema version of the localStorage snapshot (bump on breaking changes). */
export const PREFS_VERSION = 1
export const PREFS_KEY = 'tp.prefs.v1'
/** Keys written by the 0.1.x inline boot script — migrated on first read. */
export const LEGACY_LANG_KEY = 'tp.lang'
export const LEGACY_APPEARANCE_KEY = 'tp.appearance'

export type AppLocale = 'en' | 'fa'
export const APP_LOCALES: readonly AppLocale[] = ['en', 'fa']

/** Every setting that must survive a reload (transient fields excluded). */
export interface PersistedSettings {
  appearance: AppearanceSettings
  language: AppLocale
  jalali: boolean
  persianDigits: boolean
  relays: string[]
  requireMinRelays: boolean
  readReceipts: boolean
  sessionDays: number
  iceServersText: string
  notifMessages: boolean
  notifHideContent: boolean
  autoDownloadImages: boolean
  /** notification/interaction sounds (message in/out + system alerts) */
  sounds: boolean
}

/** Minimal Storage surface (injectable so tests can pass a fake). */
export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Safe storage accessor: Safari private mode throws on property access. */
export function safeStorage(): PrefsStorage | undefined {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* private mode */
  }
  return undefined
}

/**
 * Language when nothing is saved: the first browser language the app supports,
 * otherwise Persian (fa) — the app's primary language.
 */
export function detectLocale(languages?: readonly string[]): AppLocale {
  for (const raw of languages ?? []) {
    const base = String(raw).toLowerCase().split('-')[0]
    if (base === 'fa') return 'fa'
    if (base === 'en') return 'en'
  }
  return 'fa'
}

export function browserLanguages(): readonly string[] {
  try {
    if (typeof navigator === 'undefined') return []
    return navigator.languages ?? (navigator.language ? [navigator.language] : [])
  } catch {
    return []
  }
}

/** Defaults with the detected language applied (fresh installs follow the OS theme). */
export function defaultSettings(languages?: readonly string[]): PersistedSettings {
  return {
    appearance: { ...DEFAULT_APPEARANCE, colorMode: 'system' },
    language: detectLocale(languages),
    jalali: false,
    persianDigits: false,
    relays: [],
    requireMinRelays: true,
    readReceipts: true,
    sessionDays: 60,
    iceServersText: '',
    notifMessages: true,
    notifHideContent: false,
    autoDownloadImages: true,
    sounds: true,
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** Validate the appearance sub-object field by field (never trust storage). */
export function sanitizeAppearance(raw: unknown): AppearanceSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const preset = THEME_PRESETS.find((p) => p.id === r.presetId) ?? PRESET_FALLBACK
  const mode: AppearanceSettings['colorMode'] | null =
    r.colorMode === 'dark' || r.colorMode === 'light' || r.colorMode === 'system' ? r.colorMode : null
  const accent = typeof r.accent === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.accent) ? r.accent : undefined
  const fontSize = typeof r.fontSize === 'number' && Number.isFinite(r.fontSize) ? clamp(Math.round(r.fontSize), 12, 22) : null
  const radius = typeof r.radius === 'number' && Number.isFinite(r.radius) ? clamp(r.radius, 0, 1.5) : null
  const hasFlags = isBool(r.texture) || isBool(r.reducedMotion) || r.density === 'compact' || r.bubbleStyle === 'flat'
  if (mode === null && fontSize === null && radius === null && accent === undefined && !hasFlags) {
    return null // nothing usable → corrupt; let defaults stand
  }
  return {
    presetId: preset.id,
    colorMode: mode ?? DEFAULT_APPEARANCE.colorMode,
    primary: typeof r.primary === 'string' && r.primary.trim() ? r.primary.trim() : preset.primary,
    neutral: typeof r.neutral === 'string' && r.neutral.trim() ? r.neutral.trim() : preset.neutral,
    accent,
    radius: radius ?? DEFAULT_APPEARANCE.radius,
    fontSize: fontSize ?? DEFAULT_APPEARANCE.fontSize,
    density: r.density === 'compact' ? 'compact' : 'comfortable',
    bubbleStyle: r.bubbleStyle === 'flat' ? 'flat' : 'classic',
    texture: isBool(r.texture) ? r.texture : DEFAULT_APPEARANCE.texture,
    reducedMotion: isBool(r.reducedMotion) ? r.reducedMotion : DEFAULT_APPEARANCE.reducedMotion,
  }
}

const RELAY_RE = /^wss?:\/\/\S{1,200}$/

/**
 * Validate an arbitrary stored value into `Partial<PersistedSettings>` — ONLY
 * fields that are present AND valid come back, so merging saved values can
 * never clobber good values with defaults ("the stores must never overwrite
 * saved values with defaults on init").
 */
export function sanitizePartialSettings(raw: unknown): Partial<PersistedSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<PersistedSettings> = {}

  const appearance = sanitizeAppearance(r.appearance)
  if (appearance) out.appearance = appearance
  if (r.language === 'fa' || r.language === 'en') out.language = r.language

  for (const key of ['jalali', 'persianDigits', 'requireMinRelays', 'readReceipts', 'notifMessages', 'notifHideContent', 'autoDownloadImages', 'sounds'] as const) {
    if (isBool(r[key])) out[key] = r[key]
  }
  if (typeof r.iceServersText === 'string' && r.iceServersText.length <= 5000) out.iceServersText = r.iceServersText
  if (typeof r.sessionDays === 'number' && Number.isFinite(r.sessionDays)) out.sessionDays = clamp(Math.round(r.sessionDays), 1, 365)
  if (Array.isArray(r.relays)) {
    const relays = [...new Set(r.relays.filter((x): x is string => typeof x === 'string' && RELAY_RE.test(x.trim())).map((x) => x.trim()))].slice(0, 50)
    out.relays = relays // an empty list stays empty (user removed all relays on purpose)
  }
  return out
}

/** Merge validated saved fields over a base — the patch always wins. */
export function mergeSettings(base: PersistedSettings, patch: Partial<PersistedSettings>): PersistedSettings {
  return { ...base, ...patch, appearance: { ...(patch.appearance ?? base.appearance) } }
}

/** The font size shipped by 0.1.x (bumped to 16 — see the migration below). */
export const LEGACY_DEFAULT_FONT_SIZE = 15
/** Written once the bump happened, so a DELIBERATE 15 is never bumped again. */
export const FONT_SIZE_MIGRATED_KEY = 'tp.fontMigrated.16'

/**
 * One-time bump of the SHIPPED default font size (15 → 16).
 *
 * Every settings save persists the WHOLE snapshot, so virtually every existing
 * install carries an explicit `fontSize: 15`: changing DEFAULT_APPEARANCE alone
 * would never reach them. The marker is written BEFORE the value, so a user who
 * slides back to 15 AFTER the migration keeps it. Returns true when the value
 * changed (the caller must re-persist, or the next boot would merge 15 back).
 */
export function migrateDefaultFontSize(appearance: AppearanceSettings, storage?: PrefsStorage): boolean {
  if (appearance.fontSize !== LEGACY_DEFAULT_FONT_SIZE) return false
  // no storage → the migration could not be recorded once → leave the value be
  if (!storage) return false
  try {
    if (storage.getItem(FONT_SIZE_MIGRATED_KEY)) return false
    storage.setItem(FONT_SIZE_MIGRATED_KEY, '1')
  } catch {
    /* private mode / quota — never break boot over a font size */
    return false
  }
  appearance.fontSize = 16
  return true
}

/** Read + validate the snapshot. Corrupt/missing falls back to legacy keys. */
export function readStoredSettings(storage?: PrefsStorage): Partial<PersistedSettings> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(PREFS_KEY)
    if (raw !== null) return sanitizePartialSettings(JSON.parse(raw))
  } catch {
    /* corrupt JSON or blocked storage → fall through to legacy */
  }
  const legacy: Partial<PersistedSettings> = {}
  try {
    const lang = storage.getItem(LEGACY_LANG_KEY)
    if (lang === 'fa' || lang === 'en') legacy.language = lang
    const apRaw = storage.getItem(LEGACY_APPEARANCE_KEY)
    if (apRaw) {
      const appearance = sanitizeAppearance(JSON.parse(apRaw))
      if (appearance) legacy.appearance = appearance
    }
  } catch {
    /* ignore */
  }
  return legacy
}

/** Write the snapshot; false when storage is unavailable or over quota. */
export function writeStoredSettings(settings: PersistedSettings, storage?: PrefsStorage): boolean {
  if (!storage) return false
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

/**
 * Apply the boot-relevant prefs to `<html>` synchronously: lang, dir (derived
 * from the locale), font size, accent color, radius/density, color scheme and
 * the reduced-motion / flat-bubble / no-texture classes. The client plugin runs
 * this from the restored snapshot; core/prefs.test.ts executes it and the
 * inline boot script (core/prefs-inline.ts) side by side and asserts parity.
 */
export function applyPrefsToDocument(
  settings: PersistedSettings,
  doc: { style: Pick<CSSStyleDeclaration, 'setProperty' | 'colorScheme'>; setAttribute: (name: string, value: string) => void; classList: DOMTokenList },
  resolvedMode: 'dark' | 'light' = 'dark',
): void {
  const ap = settings.appearance
  doc.setAttribute('lang', langTagForLocale(settings.language))
  doc.setAttribute('dir', dirForLocale(settings.language))
  doc.style.colorScheme = resolvedMode
  // accent = explicit override OR the reactive Nuxt UI primary token — the
  // single source that keeps every surface on the global theme switcher
  doc.style.setProperty('--tp-accent', accentFor(ap))
  doc.style.setProperty('--tp-font-size', `${ap.fontSize}px`)
  doc.style.setProperty('--tp-radius', `${ap.radius}rem`)
  doc.style.setProperty('--ui-radius', `${ap.radius}rem`)
  doc.style.setProperty('--tp-density', ap.density === 'compact' ? '0.42rem' : '0.75rem')
  doc.classList.toggle('tp-reduced-motion', ap.reducedMotion)
  doc.classList.toggle('tp-bubble-flat', ap.bubbleStyle === 'flat')
  doc.classList.toggle('no-texture', !ap.texture)
}

/** Preferred dark when the OS says so (system color mode). */
export function prefersDarkColorScheme(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

