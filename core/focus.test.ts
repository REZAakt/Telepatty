import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_POINTER_QUERY,
  isEditableElement,
  isPrintableCharKey,
  shouldAutoFocusDesktop,
  shouldFocusAfterSend,
  shouldTypeToFocus,
} from './focus'

const G = (over: Partial<Parameters<typeof shouldAutoFocusDesktop>[0]> = {}) => ({
  activeIsEditable: false,
  hasTextSelection: false,
  openDialog: false,
  isComposing: false,
  pointerFine: true,
  ...over,
})

describe('focus decision logic', () => {
  it('targets the true desktop pointer media query', () => {
    expect(DESKTOP_POINTER_QUERY).toBe('(hover: hover) and (pointer: fine)')
  })

  it('auto-focuses on a clean desktop context', () => {
    expect(shouldAutoFocusDesktop(G())).toBe(true)
  })

  it('never auto-focuses on touch devices', () => {
    expect(shouldAutoFocusDesktop(G({ pointerFine: false }))).toBe(false)
  })

  it('never steals focus from editables, selects or contenteditables', () => {
    expect(shouldAutoFocusDesktop(G({ activeIsEditable: true }))).toBe(false)
  })

  it('respects an active text selection', () => {
    expect(shouldAutoFocusDesktop(G({ hasTextSelection: true }))).toBe(false)
  })

  it('respects open dialogs and IME composition', () => {
    expect(shouldAutoFocusDesktop(G({ openDialog: true }))).toBe(false)
    expect(shouldAutoFocusDesktop(G({ isComposing: true }))).toBe(false)
  })

  it('detects editable elements incl. contenteditable', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')
    expect(isEditableElement(input)).toBe(true)
    expect(isEditableElement(div)).toBe(false)
    const ce = document.createElement('div')
    ce.contentEditable = 'true'
    expect(isEditableElement(ce)).toBe(true)
  })

  it('type-to-focus: plain printable characters only', () => {
    expect(isPrintableCharKey({ key: 'a' })).toBe(true)
    expect(isPrintableCharKey({ key: 'س' })).toBe(true) // Persian input works
    expect(isPrintableCharKey({ key: 'ArrowUp' })).toBe(false)
    expect(isPrintableCharKey({ key: 'Backspace' })).toBe(false)
    expect(isPrintableCharKey({ key: 'a', ctrlKey: true })).toBe(false)
    expect(isPrintableCharKey({ key: 'a', metaKey: true })).toBe(false)
    expect(isPrintableCharKey({ key: 'a', altKey: true })).toBe(false)
    expect(isPrintableCharKey({ key: 'a', isComposing: true })).toBe(false)
  })

  it('type-to-focus: only outside editables, no dialog', () => {
    expect(shouldTypeToFocus({ key: 'a' }, G())).toBe(true)
    expect(shouldTypeToFocus({ key: 'a' }, G({ activeIsEditable: true }))).toBe(false)
    expect(shouldTypeToFocus({ key: 'a' }, G({ openDialog: true }))).toBe(false)
    expect(shouldTypeToFocus({ key: 'ArrowLeft' }, G())).toBe(false)
  })

  it('after send: desktop always; mobile keeps an already-open keyboard', () => {
    expect(shouldFocusAfterSend({ composerFocused: false, pointerFine: true })).toBe(true)
    expect(shouldFocusAfterSend({ composerFocused: true, pointerFine: false })).toBe(true)
    expect(shouldFocusAfterSend({ composerFocused: false, pointerFine: false })).toBe(false)
  })

  it('never focuses when a select or contenteditable is active (guard test)', () => {
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()
    const guards = { ...G(), activeIsEditable: isEditableElement(document.activeElement) }
    expect(shouldAutoFocusDesktop(guards)).toBe(false)
    select.remove()
  })

  it('vi trims nothing: guards object shape stays backward compatible', () => {
    vi.unstubAllGlobals()
    expect(Object.keys(G()).sort()).toEqual(
      ['activeIsEditable', 'hasTextSelection', 'isComposing', 'openDialog', 'pointerFine'].sort(),
    )
  })
})
