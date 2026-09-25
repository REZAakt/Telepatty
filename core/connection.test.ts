import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONNECTION_BADGE_COLOR,
  CONNECTION_LABEL_KEY,
  connectionState,
  type ConnectionState,
} from './connection'

const STATES: ConnectionState[] = ['online', 'connecting', 'offline']

function locale(name: string): { chats: Record<string, string> } {
  return JSON.parse(readFileSync(join(process.cwd(), 'i18n/locales', `${name}.json`), 'utf8')) as {
    chats: Record<string, string>
  }
}

describe('header chip: connection state', () => {
  it('a browser with no network is offline, whatever the transport claims', () => {
    expect(connectionState(false, 'connected')).toBe('offline')
    expect(connectionState(false, 'connecting')).toBe('offline')
    expect(connectionState(false, 'disconnected')).toBe('offline')
  })

  it('a live relay socket is online', () => {
    expect(connectionState(true, 'connected')).toBe('online')
  })

  it('an attempt still in flight is connecting — the cold start must never say "offline"', () => {
    expect(connectionState(true, 'connecting')).toBe('connecting')
  })

  it('only a transport that gave up is offline', () => {
    expect(connectionState(true, 'disconnected')).toBe('offline')
  })
})

describe('header chip: labels and colours', () => {
  it('every state has its own label key and badge colour', () => {
    expect(STATES.map((s) => CONNECTION_LABEL_KEY[s])).toEqual(['chats.online', 'chats.connecting', 'chats.offline'])
    expect(new Set(STATES.map((s) => CONNECTION_BADGE_COLOR[s])).size).toBe(STATES.length)
  })

  it('both locales carry every label the chip can render', () => {
    for (const name of ['en', 'fa']) {
      const messages = locale(name)
      for (const state of STATES) {
        expect(messages.chats[CONNECTION_LABEL_KEY[state].replace('chats.', '')]).toBeTruthy()
      }
    }
  })

  it('persian wording is the expected one', () => {
    expect(locale('fa').chats.connecting).toBe('در حال اتصال')
  })
})
