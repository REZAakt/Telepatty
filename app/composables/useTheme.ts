import { appearanceToCss, DEFAULT_APPEARANCE, THEME_PRESETS, type AppearanceSettings } from '~~/core/theme'

/** Live theme application: Nuxt UI colors via appConfig, rest via CSS variables. */
export const useTheme = () => {
  const settings = useSettingsStore()
  const appConfig = useAppConfig() as unknown as { ui: { colors: { primary: string; neutral: string } } }
  const colorMode = useColorMode() as unknown as { preference: string; value?: string }

  const apply = (ap: AppearanceSettings = settings.appearance): void => {
    if (!import.meta.client) return
    appConfig.ui.colors.primary = ap.primary
    appConfig.ui.colors.neutral = ap.neutral
    colorMode.preference = ap.colorMode
    // 'system' resolves against the actual OS/browser mode so surfaces match --ui-* tokens
    const resolved = ap.colorMode === 'system' ? (colorMode.value === 'light' ? 'light' : 'dark') : ap.colorMode
    const css = appearanceToCss(ap, resolved)
    for (const [k, v] of Object.entries(css)) document.documentElement.style.setProperty(k, v)
    document.documentElement.classList.toggle('no-texture', !ap.texture)
    document.documentElement.classList.toggle('tp-reduced-motion', ap.reducedMotion)
    // bubble style is app-wide: one class on <html>, consumed by main.css + bubbles
    document.documentElement.classList.toggle('tp-bubble-flat', ap.bubbleStyle === 'flat')
    // keep the browser/PWA chrome color in sync with the page background
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', css['--tp-bg'] ?? '')
    // NOTE: no localStorage mirror here — the settings store mirrors the whole
    // snapshot (`tp.prefs.v1`) on every update; a second theme-only mirror
    // could disagree with it.
  }

  const update = (patch: Partial<AppearanceSettings>): void => {
    settings.update({ appearance: { ...settings.appearance, ...patch } })
    apply()
  }

  const applyPreset = (id: string): void => {
    const p = THEME_PRESETS.find((x) => x.id === id)
    if (!p) return
    // a preset restores its full identity — any accent override is cleared
    update({ presetId: p.id, primary: p.primary, neutral: p.neutral, accent: undefined })
  }

  const reset = (): void => {
    settings.update({ appearance: { ...DEFAULT_APPEARANCE } })
    apply()
  }

  const exportTheme = (): string => JSON.stringify(settings.appearance)
  const importTheme = (json: string): boolean => {
    try {
      const parsed = JSON.parse(json) as AppearanceSettings
      if (!parsed || typeof parsed !== 'object' || !('primary' in parsed)) return false
      update(parsed)
      return true
    } catch {
      return false
    }
  }

  return { apply, update, applyPreset, reset, exportTheme, importTheme, presets: THEME_PRESETS }
}
