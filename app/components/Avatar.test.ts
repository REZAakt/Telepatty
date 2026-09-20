import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Avatar from './Avatar.vue'

describe('Avatar identicon', () => {
  it('deterministic for the same key, distinct for different keys', () => {
    const w1 = mount(Avatar, { props: { pk: '11'.repeat(32) } })
    const w2 = mount(Avatar, { props: { pk: '11'.repeat(32) } })
    const w3 = mount(Avatar, { props: { pk: '22'.repeat(32) } })
    expect(w1.html()).toBe(w2.html())
    expect(w1.html()).not.toBe(w3.html())
    expect(w1.find('[role="img"]').exists()).toBe(true)
  })

  it('renders the 5x5 grid', () => {
    const w = mount(Avatar, { props: { pk: 'ab'.repeat(32), size: 48 } })
    expect(w.element.style.width).toBe('48px')
    expect(w.html()).toContain('grid-cols-5')
  })
})

