import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { BUBBLE_LAYOUT_DIR, bubbleSideClasses, dirForLocale, langTagForLocale, sidebarSideForDir } from '~~/core/rtl'
import { useHtmlDir } from './composables/useHtmlDir'
import { useSettingsStore } from './stores/settings'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

describe('locale → direction mapping (pure)', () => {
  it('fa is RTL, en is LTR', () => {
    expect(dirForLocale('fa')).toBe('rtl')
    expect(dirForLocale('en')).toBe('ltr')
    expect(langTagForLocale('fa')).toBe('fa-IR')
    expect(langTagForLocale('en')).toBe('en')
  })

  it('the sidebar follows the document direction (logical start side)', () => {
    expect(sidebarSideForDir('ltr')).toBe('left')
    expect(sidebarSideForDir('rtl')).toBe('right')
  })

  it('bubble sides are PHYSICAL and constant in both directions (Telegram-like)', () => {
    expect(bubbleSideClasses(true)).toBe('ml-auto mr-0') // outgoing → physical right
    expect(bubbleSideClasses(false)).toBe('ml-0 mr-auto') // incoming → physical left
    void dirForLocale
  })
})

/**
 * App-shell test: mounts a shell wired to the REAL useHtmlDir composable and
 * the REAL settings store, switches locale fa <-> en and asserts
 * documentElement.dir/lang plus the expected sidebar side.
 *
 * (The sidebar is the first child of a flex row — with logical CSS its physical
 * side IS `sidebarSideForDir(dir)` by spec: `border-e`/start placement flips
 * with the document direction.)
 */
describe('app shell direction switching', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
    localStorage.clear()
  })

  it('flips dir/lang instantly on locale change, without reload', async () => {
    setActivePinia(createPinia())
    const settings = useSettingsStore()

    const Shell = defineComponent({
      setup() {
        useHtmlDir()
        return () =>
          h('div', { class: 'flex' }, [
            h('nav', { class: 'border-e', 'data-testid': 'sidebar' }, 'nav'),
            h('main', 'content'),
          ])
      },
    })
    const w = mount(Shell)

    // English (default): LTR, sidebar on the left
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(sidebarSideForDir('ltr')).toBe('left')
    expect(w.find('[data-testid="sidebar"]').classes()).toContain('border-e')

    // Switch to Persian: RTL instantly, no reload
    settings.language = 'fa'
    await w.vm.$nextTick()
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('fa-IR')
    expect(sidebarSideForDir('rtl')).toBe('right')

    // localStorage mirror for the pre-paint inline script
    expect(localStorage.getItem('tp.lang')).toBe('fa')

    // Back to English
    settings.language = 'en'
    await w.vm.$nextTick()
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(localStorage.getItem('tp.lang')).toBe('en')
    w.unmount()
  })
})

/* ------------------------------------------------------------------ */
/* Regression: "own messages jump to the LEFT in Persian".             */
/* ------------------------------------------------------------------ */
/**
 * A flex row packs along its main axis, and BOTH `row` and `row-reverse` start
 * at that row's inline start — which mirrors together with `<html dir="rtl">`.
 * The physical margins in `bubbleSideClasses()` can only decide the side when
 * they sit on a box with a definite width, so the MessageBubble subtree is
 * locked to the physical axis (`BUBBLE_LAYOUT_DIR`). These tests pin both
 * halves — dropping either one silently mirrors `fa` again.
 */
describe('bubble layout is physically locked (fa renders like en)', () => {
  const bubbleSrc = readFileSync(join(process.cwd(), 'app/components/MessageBubble.vue'), 'utf8')

  it('applies the physical dir to the bubble subtree root', () => {
    expect(BUBBLE_LAYOUT_DIR).toBe('ltr')
    expect(bubbleSrc).toMatch(/<div class="group flex flex-col[^"]*"\s+:class="side"\s+:dir="BUBBLE_LAYOUT_DIR">/)
  })

  it('gives that root a definite width — otherwise the physical auto margin resolves to 0', () => {
    expect(bubbleSrc).toMatch(/class="group flex flex-col[^"]*w-full max-w-\[85%\]"/)
    expect(bubbleSrc).toMatch(/class="max-w-full px-3/)
  })

  it('packs the rows on the physical axis, while the bubble text stays dir="auto"', () => {
    expect(bubbleSrc).toMatch(/class="flex items-center"\s+:class="mine \? 'flex-row-reverse' : ''"/)
    expect(bubbleSrc).toContain('dir="auto"')
  })
})

/* ------------------------------------------------------------------ */
/* Grep guard: no NEW physical-direction classes in app/ templates.    */
/* Logical utilities (ms/me/ps/pe/start/end/border-s/border-e) only.   */
/* ------------------------------------------------------------------ */
const PHYSICAL_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|[\s"'])ml-[\d.]/, 'ml-* (use ms-*)'],
  [/(?:^|[\s"'])mr-[\d.]/, 'mr-* (use me-*)'],
  [/(?:^|[\s"'])pl-[\d.]/, 'pl-* (use ps-*)'],
  [/(?:^|[\s"'])pr-[\d.]/, 'pr-* (use pe-*)'],
  [/(?:^|[\s"'])left-\S/, 'left-* (use start-*)'],
  [/(?:^|[\s"'])right-\S/, 'right-* (use end-*)'],
  [/text-(?:left|right)/, 'text-left/right (use text-start/end)'],
  [/rounded-(?:l|r)-/, 'rounded-l/r (use rounded-s/e)'],
  [/border-(?:l|r)-/, 'border-l/r (use border-s/e)'],
  [/(?:^|[\s"'])float-(?:left|right)/, 'float-left/right'],
  [/(?:^|[\s"'])translate-x-/, 'translate-x on drawers (use logical positioning)'],
]

function collectVueFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collectVueFiles(p, out)
    else if (name.endsWith('.vue') && !name.includes('.test.')) out.push(p)
  }
  return out
}

describe('no physical-direction CSS classes in app/ (grep guard)', () => {
  it('app templates use logical utilities only', () => {
    const files = collectVueFiles(join(process.cwd(), 'app'))
    expect(files.length).toBeGreaterThan(5)
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const [re, why] of PHYSICAL_PATTERNS) {
        if (re.test(src)) offenders.push(`${file}: ${why}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
