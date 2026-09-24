import { describe, expect, it } from 'vitest'
import { webRtcConfiguration } from './webrtc-transport'

describe('WebRTC privacy policy', () => {
  it('uses direct candidates by default', () => {
    expect(webRtcConfiguration({ iceServers: [{ urls: 'stun:example.test' }] }).iceTransportPolicy).toBe('all')
  })

  it('can require TURN relay candidates', () => {
    const config = webRtcConfiguration({ iceServers: [{ urls: 'turn:turn.example.test', username: 'u', credential: 'p' }], iceTransportPolicy: 'relay' })
    expect(config.iceTransportPolicy).toBe('relay')
  })
})
