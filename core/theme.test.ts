import { describe, expect, it } from 'vitest'
import { ACCENT_OPTIONS, appearanceToCss, DEFAULT_APPEARANCE, THEME_PRESETS } from './theme'

describe('appearanceToCss', () => {
  it('emits dark surfaces by default', () => {
    const css = appearanceToCss({ ...DEFAULT_APPEARANCE })
    expect(css['--tp-bg']).toBe('#050807')
    expect(css['--tp-panel']).toBe('#0a0f0d')
    expect(css['color-scheme']).toBe('dark')
  })

  it('emits light surfaces when resolved to light (white theme must restyle the page)', () => {
    const css = appearanceToCss({ ...DEFAULT_APPEARANCE, colorMode: 'light' }, 'light')
    expect(css['--tp-bg']).toBe('#e9efeb')
    expect(css['--tp-panel']).toBe('#f7faf8')
    expect(css['--tp-border']).toBe('#d3ded7')
    expect(css['color-scheme']).toBe('light')
  })

  it('resolves system → dark when no resolved mode is passed', () => {
    const css = appearanceToCss({ ...DEFAULT_APPEARANCE, colorMode: 'system' })
    expect(css['color-scheme']).toBe('dark')
  })

  it('uses the preset accent', () => {
    for (const p of THEME_PRESETS) {
      const css = appearanceToCss({ ...DEFAULT_APPEARANCE, presetId: p.id, primary: p.primary, neutral: p.neutral })
      expect(css['--tp-accent']).toBe(p.accent)
    }
  })

  it('lets the user override the accent color', () => {
    const css = appearanceToCss({ ...DEFAULT_APPEARANCE, accent: '#f472b6' })
    expect(css['--tp-accent']).toBe('#f472b6')
  })

  it('falls back to the preset accent when the override is empty', () => {
    const css = appearanceToCss({ ...DEFAULT_APPEARANCE, accent: '' })
    expect(css['--tp-accent']).toBe('#00ff9d')
  })

  it('exposes swatch options including the preset-default reset', () => {
    expect(ACCENT_OPTIONS[0].value).toBe('')
    expect(ACCENT_OPTIONS.length).toBeGreaterThan(4)
  })
})
