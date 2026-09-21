import { beforeEach, describe, expect, it } from 'vitest'
import {
  PREFS_KEY,
  LEGACY_APPEARANCE_KEY,
  LEGACY_LANG_KEY,
  applyPrefsToDocument,
  browserLanguages,
  defaultSettings,
  detectLocale,
  mergeSettings,
  readStoredSettings,
  sanitizePartialSettings,
  writeStoredSettings,
  type PersistedSettings,
} from './prefs'
import { PREFS_BOOT_SCRIPT } from './prefs-inline'
import { DEFAULT_APPEARANCE } from './theme'

/** Tiny in-memory Storage (happy-dom's localStorage is global and shared). */
function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: (): Record<string, string> => Object.fromEntries(m),
  }
}

describe('detectLocale (language default when nothing is saved)', () => {
  it('uses the first supported browser language', () => {
    expect(detectLocale(['fa-IR', 'en-US'])).toBe('fa')
    expect(detectLocale(['en-US', 'fa-IR'])).toBe('en')
  })
  it('falls back to Persian (fa) for unsupported browser languages', () => {
    expect(detectLocale(['de-DE'])).toBe('fa')
    expect(detectLocale([])).toBe('fa')
    expect(detectLocale(undefined)).toBe('fa')
  })
})

describe('settings persistence (save → simulated reload → restored)', () => {
  it('round-trips every field through the versioned key', () => {
    const s1 = fakeStorage()
    const base = defaultSettings(['en-US'])
    const changed: PersistedSettings = {
      ...base,
      language: 'fa',
      jalali: true,
      persianDigits: true,
      notifMessages: false,
      notifHideContent: true,
      sessionDays: 30,
      iceServersText: 'stun:example.org',
      relays: ['wss://my.relay.example'],
      requireMinRelays: false,
      readReceipts: false,
      autoDownloadImages: false,
      appearance: { ...base.appearance, colorMode: 'light', fontSize: 18, bubbleStyle: 'flat', reducedMotion: true },
    }
    expect(writeStoredSettings(changed, s1)).toBe(true)

    // "reload": a fresh storage instance seeded with the same persisted bytes
    const s2 = fakeStorage(s1.dump())
    const restored = mergeSettings(defaultSettings(['en-US']), readStoredSettings(s2))

    expect(restored.language).toBe('fa')
    expect(restored.jalali).toBe(true)
    expect(restored.persianDigits).toBe(true)
    expect(restored.notifMessages).toBe(false)
    expect(restored.notifHideContent).toBe(true)
    expect(restored.sessionDays).toBe(30)
    expect(restored.iceServersText).toBe('stun:example.org')
    expect(restored.relays).toEqual(['wss://my.relay.example'])
    expect(restored.requireMinRelays).toBe(false)
    expect(restored.readReceipts).toBe(false)
    expect(restored.autoDownloadImages).toBe(false)
    expect(restored.appearance.colorMode).toBe('light')
    expect(restored.appearance.fontSize).toBe(18)
    expect(restored.appearance.bubbleStyle).toBe('flat')
    expect(restored.appearance.reducedMotion).toBe(true)
  })

  it('corrupt storage yields safe defaults instead of crashing', () => {
    const s = fakeStorage({ [PREFS_KEY]: '{oops not json' })
    const merged = mergeSettings(defaultSettings(['en-US']), readStoredSettings(s))
    expect(merged.language).toBe('en')
    // fresh installs follow the OS theme (spec: "nothing saved → theme = system")
    expect(merged.appearance).toEqual({ ...DEFAULT_APPEARANCE, colorMode: 'system' })
  })

  it('migrates the 0.1.x mirrors when the new key is missing', () => {
    const s = fakeStorage({
      [LEGACY_LANG_KEY]: 'fa',
      [LEGACY_APPEARANCE_KEY]: JSON.stringify({ ...DEFAULT_APPEARANCE, fontSize: 16, colorMode: 'system' }),
    })
    const read = readStoredSettings(s)
    expect(read.language).toBe('fa')
    expect(read.appearance?.fontSize).toBe(16)
    expect(read.appearance?.colorMode).toBe('system')
  })

  it('a write failure (quota/private mode) is reported, not thrown', () => {
    const throwing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded') } }
    expect(writeStoredSettings(defaultSettings(), throwing)).toBe(false)
    expect(readStoredSettings(throwing)).toEqual({})
    expect(readStoredSettings(undefined)).toEqual({})
  })
})

describe('sanitize + merge (defaults never clobber saved values)', () => {
  it('keeps only present+valid fields and clamps ranges', () => {
    const out = sanitizePartialSettings({
      language: 'klingon',
      notifMessages: 'yes',
      sessionDays: 99999,
      relays: ['wss://ok.relay', 'http://bad', 42],
      appearance: { colorMode: 'weird', accent: 'not-a-color' },
    })
    expect(out.language).toBeUndefined()
    expect(out.notifMessages).toBeUndefined()
    expect(out.sessionDays).toBe(365)
    expect(out.relays).toEqual(['wss://ok.relay'])
    expect(out.appearance).toBeUndefined() // nothing usable → corrupt

    // a PARTIALLY valid appearance is salvaged field by field
    const salvaged = sanitizePartialSettings({ appearance: { fontSize: 999, colorMode: 'weird' } })
    expect(salvaged.appearance?.fontSize).toBe(22)
    expect(salvaged.appearance?.colorMode).toBe(DEFAULT_APPEARANCE.colorMode)
  })

  it('merges the patch over the base field by field', () => {
    const base = defaultSettings(['en-US'])
    const merged = mergeSettings(base, sanitizePartialSettings({ language: 'fa', appearance: { fontSize: 13 } }))
    expect(merged.language).toBe('fa')
    expect(merged.appearance.fontSize).toBe(13)
    expect(merged.appearance.colorMode).toBe(DEFAULT_APPEARANCE.colorMode) // untouched default
    // an EMPTY relay list is a real user choice and must survive
    expect(mergeSettings(base, sanitizePartialSettings({ relays: [] })).relays).toEqual([])
  })
})

describe('applyPrefsToDocument ↔ inline boot script parity (no flash)', () => {
  const doc = document.documentElement

  beforeEach(() => {
    localStorage.clear()
    doc.removeAttribute('lang')
    doc.removeAttribute('dir')
    doc.removeAttribute('class')
    doc.removeAttribute('style')
  })

  function runBootScript(): void {
    // executes exactly what <head> runs before the first paint
    new Function(PREFS_BOOT_SCRIPT)()
  }

  it('restores fa → dir=rtl synchronously from storage', () => {
    const prefs: PersistedSettings = {
      ...defaultSettings(['en-US']),
      language: 'fa',
      appearance: { ...DEFAULT_APPEARANCE, fontSize: 19, reducedMotion: true },
    }
    writeStoredSettings(prefs, localStorage)
    runBootScript()
    expect(doc.getAttribute('lang')).toBe('fa-IR')
    expect(doc.getAttribute('dir')).toBe('rtl')
    expect(doc.style.getPropertyValue('--tp-font-size')).toBe('19px')
    expect(doc.classList.contains('tp-reduced-motion')).toBe(true)
  })

  it('applies the same lang/dir/vars/classes as applyPrefsToDocument', () => {
    const prefs: PersistedSettings = {
      ...defaultSettings(['en-US']),
      language: 'fa',
      jalali: true,
      appearance: {
        ...DEFAULT_APPEARANCE,
        colorMode: 'dark',
        accent: '#f472b6',
        density: 'compact',
        bubbleStyle: 'flat',
        texture: false,
      },
    }
    applyPrefsToDocument(prefs, doc, 'dark')
    const viaFn = {
      lang: doc.getAttribute('lang'),
      dir: doc.getAttribute('dir'),
      accent: doc.style.getPropertyValue('--tp-accent'),
      font: doc.style.getPropertyValue('--tp-font-size'),
      radius: doc.style.getPropertyValue('--tp-radius'),
      uiRadius: doc.style.getPropertyValue('--ui-radius'),
      density: doc.style.getPropertyValue('--tp-density'),
      scheme: doc.style.colorScheme,
      reduced: doc.classList.contains('tp-reduced-motion'),
      flat: doc.classList.contains('tp-bubble-flat'),
      noTexture: doc.classList.contains('no-texture'),
    }
    doc.removeAttribute('lang')
    doc.removeAttribute('dir')
    doc.removeAttribute('class')
    doc.removeAttribute('style')
    writeStoredSettings(prefs, localStorage)
    runBootScript()
    expect(doc.getAttribute('lang')).toBe(viaFn.lang)
    expect(doc.getAttribute('dir')).toBe(viaFn.dir)
    expect(doc.style.getPropertyValue('--tp-accent')).toBe(viaFn.accent)
    expect(doc.style.getPropertyValue('--tp-font-size')).toBe(viaFn.font)
    expect(doc.style.getPropertyValue('--tp-radius')).toBe(viaFn.radius)
    expect(doc.style.getPropertyValue('--ui-radius')).toBe(viaFn.uiRadius)
    expect(doc.style.getPropertyValue('--tp-density')).toBe(viaFn.density)
    expect(doc.style.colorScheme).toBe(viaFn.scheme)
    expect(doc.classList.contains('tp-reduced-motion')).toBe(viaFn.reduced)
    expect(doc.classList.contains('tp-bubble-flat')).toBe(viaFn.flat)
    expect(doc.classList.contains('no-texture')).toBe(viaFn.noTexture)
  })

  it('the script is self-sufficient: bad storage never breaks boot', () => {
    localStorage.setItem(PREFS_KEY, 'not json at all')
    expect(() => runBootScript()).not.toThrow()
    // browser-language fallback (Persian) applies with nothing saved
    const langs = browserLanguages()
    runBootScript()
    expect(doc.getAttribute('dir')).toBe(detectLocale(langs) === 'fa' ? 'rtl' : 'ltr')
  })

  it('still reads the exact keys the app writes (no drift)', () => {
    expect(PREFS_BOOT_SCRIPT).toContain(PREFS_KEY)
    expect(PREFS_BOOT_SCRIPT).toContain(LEGACY_LANG_KEY)
    expect(PREFS_BOOT_SCRIPT).toContain(LEGACY_APPEARANCE_KEY)
  })
})
