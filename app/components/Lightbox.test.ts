import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Lightbox from './Lightbox.vue'

// `useI18n` is a Nuxt auto-import at app runtime; stub the global the same way
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }))

const UIcon = { name: 'UIcon', props: ['name'], template: '<span />' }

const ITEMS = [
  { src: '/media/a.png', alt: 'First' },
  { src: '/media/b.png', alt: 'Second' },
  { src: '/media/c.png', alt: 'Third' },
]

function mountLb(index = 0): VueWrapper {
  return mount(Lightbox, {
    props: { items: ITEMS, index },
    global: { stubs: { UIcon } },
    attachTo: document.body,
  })
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

const CLOSE = 'button[aria-label="common.close"]'
const DIALOG = '[role="dialog"]'

describe('Lightbox', () => {
  it('closes via the close button — for mouse and touch (regression)', async () => {
    wrapper = mountLb()
    const btn = wrapper.find(CLOSE)
    expect(btn.exists()).toBe(true)
    expect((btn.element as HTMLButtonElement).tagName).toBe('BUTTON')
    await btn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Escape (window capture) and on backdrop click', async () => {
    wrapper = mountLb()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper?.unmount()
    wrapper = mountLb()
    // a click whose target is the dialog itself = backdrop
    await wrapper.find(DIALOG).trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    // a click on the image must NOT close (bubbles with a non-self target)
    await wrapper.find('img').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('navigates with arrow keys and wraps around', async () => {
    wrapper = mountLb(0)
    const dlg = wrapper.find(DIALOG)
    await dlg.trigger('keydown', { key: 'ArrowRight' })
    await dlg.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:index')).toEqual([[1], [2]])
  })

  it('moves focus in on open and restores it on close (dialog semantics)', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    wrapper = mountLb()
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.find(CLOSE).element)
    wrapper.unmount()
    wrapper = null
    expect(document.activeElement).toBe(trigger)
  })

  it('locks body scroll while open and restores it afterwards', async () => {
    wrapper = mountLb()
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    wrapper = null
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.body.style.overflow).toBe('')
  })

  it('pauses videos behind the lightbox on close', async () => {
    const video = document.createElement('video')
    const pause = vi.spyOn(video, 'pause')
    document.body.appendChild(video)
    wrapper = mountLb()
    await wrapper.find(CLOSE).trigger('click')
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('role=dialog + aria-modal are present', () => {
    wrapper = mountLb()
    const dlg = wrapper.find(DIALOG)
    expect(dlg.attributes('aria-modal')).toBe('true')
    expect(dlg.attributes('aria-label')).toBe('First')
  })

  it('swipe down closes, horizontal swipe navigates (pointer events)', async () => {
    wrapper = mountLb(0)
    const stage = wrapper.find('.touch-none')
    // happy-dom has no real PointerEvent: hand-roll the events the handlers need
    const fire = (target: EventTarget, type: string, x: number, y: number, t: number) => {
      const e = new Event(type, { bubbles: true })
      Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 })
      Object.defineProperty(e, 'timeStamp', { value: t })
      target.dispatchEvent(e)
    }
    // downward swipe past the threshold → close (downward drag with feedback)
    fire(stage.element, 'pointerdown', 100, 100, 0)
    fire(window, 'pointermove', 100, 260, 30)
    fire(window, 'pointerup', 100, 260, 60)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper?.unmount()
    // horizontal swipe RIGHT → previous image (wraps 0 → 2)
    wrapper = mountLb(0)
    const stage2 = wrapper.find('.touch-none')
    fire(stage2.element, 'pointerdown', 100, 100, 0)
    fire(window, 'pointermove', 260, 100, 30)
    fire(window, 'pointerup', 260, 100, 60)
    expect(wrapper.emitted('update:index')).toEqual([[2]])
    wrapper?.unmount()
    // horizontal swipe LEFT → next image (0 → 1)
    wrapper = mountLb(0)
    const stage2b = wrapper.find('.touch-none')
    fire(stage2b.element, 'pointerdown', 260, 100, 0)
    fire(window, 'pointermove', 100, 100, 30)
    fire(window, 'pointerup', 100, 100, 60)
    expect(wrapper.emitted('update:index')).toEqual([[1]])
    wrapper?.unmount()
    // a drag below the threshold stays open (spring back)
    wrapper = mountLb(0)
    const stage3 = wrapper.find('.touch-none')
    fire(stage3.element, 'pointerdown', 100, 100, 0)
    fire(window, 'pointermove', 100, 140, 30)
    fire(window, 'pointerup', 100, 140, 60)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('the mobile/browser Back button closes it via a pushed history entry', async () => {
    wrapper = mountLb()
    expect((window.history.state as { tpLightbox?: boolean }).tpLightbox).toBe(true)
    window.dispatchEvent(new Event('popstate'))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* Regression: "none of the view buttons do anything, and a stray line */
/* of code shows up next to the image".                                */
/* ------------------------------------------------------------------ */
const LB_SRC = readFileSync(join(process.cwd(), 'app/components/Lightbox.vue'), 'utf8')

describe('Lightbox view controls (rotate / pinch / wheel / reset)', () => {
  const ROTATE = 'button[aria-label="lightbox.rotateRight"]'
  const STAGE = '.touch-none'
  const transform = () => (wrapper!.find('img').element as HTMLElement).style.transform
  const scale = () => Number(/scale\(([\d.]+)\)/.exec(transform())?.[1] ?? '0')

  /** happy-dom has no real WheelEvent: hand-roll the field the handler reads */
  const wheel = async (deltaY: number): Promise<void> => {
    const e = new Event('wheel', { bubbles: true, cancelable: true })
    Object.assign(e, { deltaY })
    wrapper!.find(DIALOG).element.dispatchEvent(e)
    await nextTick() // the style binding is applied on the next tick
  }
  /** ...and no real PointerEvent either (same trick as the swipe test above) */
  const fire = async (target: EventTarget, type: string, x: number, y: number, t: number, id = 1): Promise<void> => {
    const e = new Event(type, { bubbles: true })
    Object.assign(e, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0 })
    Object.defineProperty(e, 'timeStamp', { value: t })
    target.dispatchEvent(e)
    await nextTick()
  }

  it('the image transform is BOUND to the <img> (the state changed but never moved)', () => {
    expect(LB_SRC).toMatch(/<img[\s\S]*?:style="imgStyle"/)
    // the wheel listener exists too — `onWheel` used to be unreachable code
    expect(LB_SRC).toContain('@wheel="onWheel"')
    wrapper = mountLb()
    expect(transform()).toContain('rotate(0deg)')
  })

  it('turns 90° clockwise per press and wraps after a full turn', async () => {
    wrapper = mountLb()
    const btn = wrapper.find(ROTATE)
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(transform()).toContain('rotate(90deg)')
    await btn.trigger('click')
    expect(transform()).toContain('rotate(180deg)')
    await btn.trigger('click')
    expect(transform()).toContain('rotate(270deg)')
    await btn.trigger('click')
    expect(transform()).toContain('rotate(0deg)')
  })

  it('a quarter turn swaps the fit box so the image stays on screen', async () => {
    wrapper = mountLb()
    expect(wrapper.find('img').classes().join(' ')).toContain('max-h-[calc(100dvh-2rem)]')
    await wrapper.find(ROTATE).trigger('click')
    expect(wrapper.find('img').classes().join(' ')).toContain('max-h-[calc(100vw-2rem)]')
  })

  it('has exactly ONE rotate control — left/drag buttons are gone', () => {
    wrapper = mountLb()
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label') ?? '')
    expect(labels.filter((l) => l.startsWith('lightbox.rotate'))).toEqual(['lightbox.rotateRight'])
    expect(LB_SRC).not.toContain('lightbox.rotateLeft')
    expect(LB_SRC).not.toContain('lightbox.rotateDrag')
    expect(LB_SRC).not.toContain('rotate-ccw')
  })

  it('no longer renders the raw code note as text (the line beside the image)', () => {
    wrapper = mountLb()
    expect(wrapper.find(DIALOG).text()).not.toContain('iOS Safari')
    expect(LB_SRC).not.toContain('/*Buttons')
  })

  it('zooms with the mouse wheel and clamps back to 1×', async () => {
    wrapper = mountLb()
    await wheel(-120)
    expect(scale()).toBeGreaterThan(1)
    await wheel(4000)
    expect(scale()).toBe(1)
  })

  it('pinch-zooms with two fingers (touch)', async () => {
    wrapper = mountLb(0)
    const stage = wrapper.find(STAGE)
    await fire(stage.element, 'pointerdown', 100, 100, 0, 1)
    await fire(stage.element, 'pointerdown', 200, 100, 0, 2)
    await fire(window, 'pointermove', 300, 100, 20, 2)
    expect(scale()).toBeGreaterThan(1.5)
  })

  it('double-click resets rotation, zoom and pan', async () => {
    wrapper = mountLb()
    await wrapper.find(ROTATE).trigger('click')
    await wheel(-120)
    expect(transform()).toContain('rotate(90deg)')
    expect(scale()).toBeGreaterThan(1)
    await wrapper.find(STAGE).trigger('dblclick')
    expect(transform()).toContain('rotate(0deg)')
    expect(scale()).toBe(1)
  })

  it('a drag while zoomed PANS instead of navigating or closing', async () => {
    wrapper = mountLb(0)
    const stage = wrapper.find(STAGE)
    await wheel(-120)
    await fire(stage.element, 'pointerdown', 100, 100, 0)
    await fire(window, 'pointermove', 180, 240, 30)
    await fire(window, 'pointerup', 180, 240, 60)
    expect(transform()).toContain('translate(80px, 140px)')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('update:index')).toBeUndefined()
  })
})
