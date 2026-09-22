import type { Envelope } from './protocol'
import type { SendResult, TransportId, TransportStatus } from './router'

export interface IceServerConfig {


  urls: string | string[]
  username?: string
  credential?: string
}

export interface WebRtcTransportOptions {
  iceServers: IceServerConfig[]
  /** send a signaling envelope through the slow path (Nostr) */
  signal: (env: Envelope) => Promise<SendResult>
  onEnvelope: (env: Envelope) => void
  /** raw DataChannel lines that are NOT envelopes (file-transfer chunk frames) */
  onRaw?: (peerPk: string, raw: string) => void
  /** a peer DataChannel opened/closed — kicks pending file transfers */
  onPeerChannel?: (peerPk: string, open: boolean) => void
  /** channel drained below the backpressure watermark — resume pumping */
  onBufferLow?: (peerPk: string) => void
  onStatus?: (status: TransportStatus, peers: string[]) => void
}

interface Peer {
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  open: boolean
  pendingIce: RTCIceCandidateInit[]
  polite: boolean
  makingOffer: boolean
}

const DC_LABEL = 'tp'
/** how long a recent failed connection still counts as "offline" for the UI */
const FAILURE_WINDOW_MS = 45_000

/**
 * WebRTC live/fast path. Signaling rides the Nostr transport (wrapped kind-14
 * rumors with `type: 'signal'`), the DataChannel carries envelopes directly.
 * Perfect-negotiation-lite: the peer with the lexicographically smaller pubkey
 * is the impolite peer (initiates offers).
 */
export class WebRtcTransport {
  readonly id: TransportId = 'webrtc'
  private peers = new Map<string, Peer>()
  /** pk → timestamp of the last failed/dropped connection (drives "offline") */
  private lastFailure = new Map<string, number>()

  private cbs = new Set<(env: Envelope) => void>()
  private opts: WebRtcTransportOptions
  private myPk: string

  constructor(myPk: string, opts: WebRtcTransportOptions) {
    this.myPk = myPk
    this.opts = opts
    this.onEnvelopeRef = opts.onEnvelope
  }

  private emitStatus(): void {
    const peers = [...this.peers.entries()].filter(([, p]) => p.open).map(([k]) => k)
    const status: TransportStatus = peers.length ? 'connected' : this.peers.size ? 'connecting' : 'disconnected'
    this.opts.onStatus?.(status, peers)
  }

  private createPeer(peerPk: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers })
    const polite = this.myPk > peerPk // larger pubkey is polite, smaller initiates
    const peer: Peer = { pc, dc: null, open: false, pendingIce: [], polite, makingOffer: false }
    this.peers.set(peerPk, peer)

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.signal(peerPk, { step: 'ice', candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'failed' || st === 'closed') {
        // remember the failure so the UI can honestly show "offline" for a while
        this.lastFailure.set(peerPk, Date.now())
        this.dropPeer(peerPk)
      } else if (st === 'disconnected') {
        // ICE hiccup vs. peer gone: give the connection a few seconds to recover
        // before declaring the peer dead — this is what kept presence stuck on
        // "unknown" before (a zombie peer blocked every re-negotiation attempt).
        window.setTimeout(() => {
          const p = this.peers.get(peerPk)
          if (p && !p.open) {
            this.lastFailure.set(peerPk, Date.now())
            this.dropPeer(peerPk)
          }
        }, 6_000)
      }
      this.emitStatus()
    }
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) void this.signal(peerPk, { step: 'offer', sdp: pc.localDescription.sdp })
      } finally {
        peer.makingOffer = false
      }
    }
    if (!polite) {
      peer.dc = pc.createDataChannel(DC_LABEL, { ordered: true })
      this.wireChannel(peerPk, peer, peer.dc)
    } else {
      pc.ondatachannel = (e) => {
        peer.dc = e.channel
        this.wireChannel(peerPk, peer, e.channel)
      }
    }
    return peer
  }

  private wireChannel(peerPk: string, peer: Peer, dc: RTCDataChannel): void {
    // backpressure: pause chunk pumping above this, resume on the low event
    dc.bufferedAmountLowThreshold = 128 * 1024
    dc.onopen = () => {
      peer.open = true
      this.emitStatus()
      this.opts.onPeerChannel?.(peerPk, true)
    }
    dc.onclose = () => {
      peer.open = false
      this.emitStatus()
      this.opts.onPeerChannel?.(peerPk, false)
      // remove the dead entry: keeping it made `initiate()` a no-op and froze
      // presence on "unknown" until a page reload
      this.dropPeer(peerPk)
    }
    dc.onbufferedamountlow = () => {
      this.opts.onBufferLow?.(peerPk)
    }
    dc.onmessage = (e) => {
      const raw = String(e.data)
      // file-transfer chunk frames are routed raw (they are not envelopes)
      if (raw.includes('tpFile')) {
        this.opts.onRaw?.(peerPk, raw)
        return
      }
      try {
        const env = JSON.parse(raw) as Envelope
        this.onEnvelopeRef(env)
      } catch {
        /* ignore malformed frames */
      }
    }

  }

  private onEnvelopeRef: (env: Envelope) => void

  private dropPeer(peerPk: string): void {
    const peer = this.peers.get(peerPk)
    if (!peer) return
    try {
      peer.pc.close()
    } catch {
      /* ignore */
    }
    this.peers.delete(peerPk)
    this.emitStatus()
  }

  private async signal(peerPk: string, payload: Envelope['signal']): Promise<void> {
    const env: Envelope = {
      id: `sig-${peerPk.slice(0, 12)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      v: 1,
      type: 'signal',
      from: this.myPk,
      to: peerPk,
      ts: Date.now(),
      lamport: 0,
      signal: payload,
    }
    await this.opts.signal(env)
  }

  /** Entry point for `type:'signal'` envelopes coming from the Nostr pipeline. */
  async handleSignal(env: Envelope): Promise<void> {
    const peerPk = env.from
    const sig = env.signal
    if (!sig) return
    if (sig.step === 'bye') {
      this.dropPeer(peerPk)
      return
    }
    let peer = this.peers.get(peerPk)
    if (!peer && (sig.step === 'offer' || sig.step === 'ice')) peer = this.createPeer(peerPk)
    if (!peer) return
    try {
      if (sig.step === 'offer') {
        const offerCollision =
          peer.makingOffer || (peer.pc.signalingState !== 'stable' && peer.pc.signalingState !== 'have-remote-offer')
        if (offerCollision && peer.polite) {
          await peer.pc.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit)
        } else if (offerCollision && !peer.polite) {
          return // ignore glare; our own offer wins
        }
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp })
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
        await peer.pc.setLocalDescription()
        if (peer.pc.localDescription) void this.signal(peerPk, { step: 'answer', sdp: peer.pc.localDescription.sdp })
      } else if (sig.step === 'answer') {
        if (peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp })
          for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {})
        }
      } else if (sig.step === 'ice' && sig.candidate) {
        if (peer.pc.remoteDescription) {
          await peer.pc.addIceCandidate(sig.candidate as RTCIceCandidateInit).catch(() => {})
        } else {
          peer.pendingIce.push(sig.candidate as RTCIceCandidateInit)
        }
      }
    } catch {
      /* negotiation races are non-fatal */
    }
  }

  /** Open a channel to a friend. Safe to call repeatedly. */
  async initiate(peerPk: string): Promise<void> {
    const existing = this.peers.get(peerPk)
    if (existing) {
      if (existing.open) return
      // zombie peer entry: negotiation stalled or died WITHOUT a close event.
      // This was the root cause of "both online but shown not-online": the
      // heartbeat kept calling initiate() which returned early forever. Drop
      // and recreate so the next offer actually goes out.
      const st = existing.pc.connectionState
      if (st === 'new' || st === 'connecting') return // still negotiating — give it time
      this.dropPeer(peerPk)
    }
    // BOTH sides may create the peer: the old "only the impolite side
    // initiates" rule meant that when the impolite peer never opened the chat,
    // the polite one stared at "unknown" even though both were online. Perfect
    // negotiation already handles the offer glare (the polite peer rolls back).
    this.createPeer(peerPk)
  }

  async send(env: Envelope): Promise<SendResult> {
    const peer = this.peers.get(env.to)
    if (!peer?.open || !peer.dc) return { ok: false, error: 'no-channel' }
    try {
      peer.dc.send(JSON.stringify(env))
      return { ok: true }
    } catch {
      return { ok: false, error: 'channel-closed' }
    }
  }

  /** Raw (non-envelope) frame on the peer channel — file-transfer chunks. */
  sendRaw(peerPk: string, raw: string): boolean {
    const peer = this.peers.get(peerPk)
    if (!peer?.open || !peer.dc) return false
    try {
      peer.dc.send(raw)
      return true
    } catch {
      return false
    }
  }

  /** Current bufferedAmount of the peer channel (backpressure signal). */
  bufferedAmount(peerPk: string): number {
    return this.peers.get(peerPk)?.dc?.bufferedAmount ?? Infinity
  }

  connected(peerPk: string): boolean {
    return this.peers.get(peerPk)?.open === true
  }

  /**
   * Fine-grained presence state for the UI:
   *  - `open`: DataChannel is live right now → the peer is ONLINE.
   *  - `connecting`: a peer connection exists but no channel yet.
   *  - `failed`: the last connection attempt failed recently → honestly show
   *    OFFLINE instead of the vague "unknown".
   *  - `none`: never negotiated in this session → genuinely unknown.
   */
  peerState(peerPk: string): 'open' | 'connecting' | 'failed' | 'none' {
    const p = this.peers.get(peerPk)
    if (p?.open) return 'open'
    if (p) return 'connecting'
    const failedAt = this.lastFailure.get(peerPk)
    if (failedAt && Date.now() - failedAt < FAILURE_WINDOW_MS) return 'failed'
    return 'none'
  }

  onReceive(cb: (env: Envelope) => void): () => void {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }

  status(): TransportStatus {
    const any = [...this.peers.values()].some((p) => p.open)
    if (any) return 'connected'
    return this.peers.size ? 'connecting' : 'disconnected'
  }

  stop(): void {
    for (const [pk, peer] of this.peers) {
      if (peer.open && peer.dc) void this.signal(pk, { step: 'bye' }).catch(() => {})
      try {
        peer.pc.close()
      } catch {
        /* ignore */
      }
    }
    this.peers.clear()
    this.cbs.clear()
    this.emitStatus()
  }
}

