import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import { getDb, setDb } from '~~/core/db'
import { PREFS_KEY } from '~~/core/prefs'

/**
 * Regression tests for "settings are not persisted".
 *
 * ROOT CAUSE: the old persist() handed Dexie the store's REACTIVE PROXIES and
 * IndexedDB structured clone rejected them (`DataCloneError: #<Object> could
 * not be cloned`) — every settings write failed silently, so every reload
 * restored defaults. These tests prove updates now survive a full
 * save → simulated reload (new store, fresh DB connection) cycle.
 */
describe('settings store persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    setDb(null)
    setActivePinia(createPinia())
  })

  it('update() survives a simulated reload (IndexedDB + localStorage mirror)', async () => {
    const s1 = useSettingsStore()
    s1.update({
      language: 'fa',
      notifMessages: false,
      jalali: true,
      sessionDays: 14,
      appearance: { ...s1.appearance, fontSize: 17, colorMode: 'light', bubbleStyle: 'flat' },
    })
    await s1.persist() // update() fires it fire-and-forget; await for determinism

    // values are in the versioned localStorage mirror for the pre-paint script
    const mirror = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { language?: string; jalali?: boolean }
    expect(mirror.language).toBe('fa')
    expect(mirror.jalali).toBe(true)

    // the IndexedDB row is structured-cloneable PLAIN data (the DataCloneError
    // regression: reactive proxies used to be stored and every clone threw)
    const row = await getDb().settings.get('settings')
    expect(row).toBeTruthy()
    expect(() => structuredClone(row?.value)).not.toThrow()
    expect((row?.value as { language?: string }).language).toBe('fa')

    // simulated reload: brand new pinia + brand new DB connection
    setDb(null)
    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.language).toBe('fa')
    expect(s2.jalali).toBe(true)
    expect(s2.notifMessages).toBe(false)
    expect(s2.sessionDays).toBe(14)
    expect(s2.appearance.fontSize).toBe(17)
    expect(s2.appearance.colorMode).toBe('light')
    expect(s2.appearance.bubbleStyle).toBe('flat')
  })

  it('a partial legacy DB row never resets values the user saved', async () => {
    await getDb().settings.put({ key: 'settings', value: { language: 'en', appearance: { fontSize: 13 } } })
    setDb(null)
    const s = useSettingsStore()
    await s.load()
    expect(s.appearance.fontSize).toBe(13)
    // everything the partial row did not specify keeps its default
    expect(s.notifMessages).toBe(true)
    expect(s.language).toBe('en')
  })

  it('corrupt localStorage degrades to detected defaults', () => {
    localStorage.setItem(PREFS_KEY, '}]corrupt{[')
    const s = useSettingsStore()
    // state() must not throw and must yield defaults for the detected language
    expect(['en', 'fa']).toContain(s.language)
    expect(s.notifMessages).toBe(true)
    expect(s.appearance.fontSize).toBe(15)
  })

  it('saved localStorage values are NOT overwritten by defaults on init', async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ language: 'fa', notifMessages: false, appearance: { fontSize: 20 } }),
    )
    const s = useSettingsStore()
    expect(s.language).toBe('fa')
    expect(s.notifMessages).toBe(false)
    expect(s.appearance.fontSize).toBe(20)
    // ...and load() must not reset them either (start from an empty DB)
    await getDb().settings.delete('settings')
    await s.load()
    expect(s.language).toBe('fa')
    expect(s.notifMessages).toBe(false)
    expect(s.appearance.fontSize).toBe(20)
  })
})
