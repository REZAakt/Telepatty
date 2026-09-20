import { describe, expect, it } from 'vitest'
import {
  FileReceiver,
  FileSender,
  chunkFrameBytes,
  decodeChunkFrame,
  encodeChunkFrame,
  isFileFrame,
  verifyTransfer,
  shouldAckNow,
  type SenderChannel,
} from './file-transfer'
import { sha256Hex } from './files'
import type { FileMeta } from './protocol'

const CHUNK = 1024

function makeMeta(size: number, sha256 = '0'.repeat(64)): FileMeta {
  return { transferId: 't1', name: 'test.bin', mime: 'application/octet-stream', size, sha256, chunkSize: CHUNK }
}

function linkedChannels(opts: { drop?: boolean } = {}) {
  const aToB: string[] = []
  const senderChannel: SenderChannel = {
    canSend: () => true,
    sendChunk: (tid, i, bytes) => {
      if (opts.drop) return false
      aToB.push(encodeChunkFrame(tid, i, bytes))
      return true
    },
  }
  return { senderChannel, aToB }
}

describe('chunk framing', () => {
  it('round-trips a chunk (index + bytes intact)', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251])
    const raw = encodeChunkFrame('t1', 7, bytes)
    expect(isFileFrame(raw)).toBe(true)
    const frame = decodeChunkFrame(raw)
    expect(frame?.transferId).toBe('t1')
    expect(frame?.i).toBe(7)
    expect([...chunkFrameBytes(frame!)]).toEqual([...bytes])
  })

  it('ignores non-file lines (envelopes pass through untouched)', () => {
    expect(isFileFrame('{"id":"x","type":"chat"}')).toBe(false)
    expect(decodeChunkFrame('{"id":"x"}')).toBe(null)
    expect(decodeChunkFrame('not json')).toBe(null)
  })
})

describe('transfer: chunking + reassembly + integrity', () => {
  it('streams a small file and verifies size + sha256', async () => {
    const bytes = new Uint8Array(3500).map((_, i) => i % 251)
    const meta = makeMeta(bytes.length, await sha256Hex(bytes))
    const { senderChannel, aToB } = linkedChannels()
    const receiver = new FileReceiver(meta)
    const sender = new FileSender({ meta, bytes, channel: senderChannel })
    sender.pump()
    expect(sender.sentCount).toBe(Math.ceil(3500 / CHUNK))
    expect(aToB.length).toBe(sender.sentCount)

    let done: Uint8Array | undefined
    for (const raw of aToB) {
      const frame = decodeChunkFrame(raw)!
      const verdict = receiver.onChunk(frame.i, chunkFrameBytes(frame))
      if (verdict.complete) done = verdict.bytes
    }
    expect(done).toBeDefined()
    expect(await verifyTransfer(done!, meta)).toEqual({ ok: true })
    expect([...done!]).toEqual([...bytes])
  })

  it('rejects a corrupted transfer (hash mismatch)', async () => {
    const bytes = new Uint8Array(2000).fill(9)
    const meta = makeMeta(bytes.length, await sha256Hex(bytes))
    const { senderChannel, aToB } = linkedChannels()
    const receiver = new FileReceiver(meta)
    new FileSender({ meta, bytes, channel: senderChannel }).pump()

    let assembled: Uint8Array | undefined
    for (let idx = 0; idx < aToB.length; idx++) {
      const frame = decodeChunkFrame(aToB[idx])!
      let payload = chunkFrameBytes(frame)
      if (idx === 0) payload = payload.map((b) => (b === 9 ? 8 : b)) // flip one byte
      const verdict = receiver.onChunk(frame.i, payload)
      if (verdict.complete) assembled = verdict.bytes
    }
    expect(assembled).toBeDefined()
    expect(await verifyTransfer(assembled!, meta)).toEqual({ ok: false, reason: 'hash' })
  })

  it('rejects a size mismatch', async () => {
    const bytes = new Uint8Array(1000).fill(1)
    const meta = makeMeta(999, await sha256Hex(bytes))
    expect(await verifyTransfer(bytes, meta)).toEqual({ ok: false, reason: 'size' })
  })
})


describe('backpressure', () => {
  it('stops pumping when the channel refuses and resumes on drain', () => {
    const bytes = new Uint8Array(3 * CHUNK)
    const meta = makeMeta(bytes.length)
    let allow = 1 // channel accepts exactly one chunk, then the buffer is full
    const sender = new FileSender({
      meta,
      bytes,
      channel: {
        canSend: () => true,
        sendChunk: () => allow-- > 0,
      },
    })
    sender.pump()
    expect(sender.sentCount).toBe(1)
    allow = 99 // drained → resume pumping
    sender.pump()
    expect(sender.sentCount).toBe(3)
  })

  it('canSend=false pauses without losing the index', () => {
    const bytes = new Uint8Array(4 * CHUNK)
    const meta = makeMeta(bytes.length)
    let open = false
    const sender = new FileSender({
      meta,
      bytes,
      channel: { canSend: () => open, sendChunk: () => true },
    })
    sender.pump()
    expect(sender.sentCount).toBe(0)
    open = true
    sender.pump()
    expect(sender.sentCount).toBe(4)
  })
})

describe('resume after disconnect', () => {
  it('continues from the receiver\u2019s last confirmed chunk', () => {
    const bytes = new Uint8Array(6 * CHUNK)
    const meta = makeMeta(bytes.length)
    const sender = new FileSender({
      meta,
      bytes,
      channel: { canSend: () => true, sendChunk: () => true },
    })
    sender.pump()
    expect(sender.sentCount).toBe(6)
    // "disconnect": the peer only confirmed chunks 0..2
    sender.onAck({ transferId: 't1', resumeFrom: 2 })
    sender.resume()
    expect(sender.confirmedCount).toBe(2)
    expect(sender.sentCount).toBe(6) // re-streamed from index 3, nothing lost
  })

  it('final ok ack completes the transfer exactly once', () => {
    const bytes = new Uint8Array(CHUNK)
    const meta = makeMeta(bytes.length)
    let done = 0
    const sender = new FileSender({
      meta,
      bytes,
      channel: { canSend: () => true, sendChunk: () => true },
      onDone: () => {
        done += 1
      },
    })
    sender.pump()
    sender.onAck({ transferId: 't1', ok: true })
    sender.onAck({ transferId: 't1', ok: true })
    expect(done).toBe(1)
  })

  it('peer error ack aborts the sender and stops pumping', () => {
    const bytes = new Uint8Array(CHUNK)
    const meta = makeMeta(bytes.length)
    let aborted = ''
    const sender = new FileSender({
      meta,
      bytes,
      channel: { canSend: () => true, sendChunk: () => true },
      onAborted: (r) => {
        aborted = r
      },
    })
    sender.pump()
    sender.onAck({ transferId: 't1', error: 'hash' })
    expect(sender.isCancelled).toBe(true)
    expect(aborted).toBe('hash')
    sender.pump()
    expect(sender.sentCount).toBe(1)
  })

  it('ignores acks for other transfers', () => {
    const bytes = new Uint8Array(CHUNK)
    const meta = makeMeta(bytes.length)
    let done = 0
    const sender = new FileSender({
      meta,
      bytes,
      channel: { canSend: () => true, sendChunk: () => true },
      onDone: () => {
        done += 1
      },
    })
    sender.onAck({ transferId: 'other', ok: true })
    expect(done).toBe(0)
  })
})

describe('receiver guards', () => {
  it('rejects out-of-range indices', () => {
    const receiver = new FileReceiver(makeMeta(CHUNK))
    expect(receiver.onChunk(5, new Uint8Array(10))).toEqual({ complete: false, rejected: 'index' })
  })

  it('rejects oversized chunks (sender lying about chunkSize)', () => {
    const receiver = new FileReceiver(makeMeta(2 * CHUNK))
    expect(receiver.onChunk(0, new Uint8Array(CHUNK + 1))).toEqual({ complete: false, rejected: 'size' })
  })

  it('duplicate chunks are idempotent', () => {
    const receiver = new FileReceiver(makeMeta(2 * CHUNK))
    const chunk = new Uint8Array(CHUNK).fill(7)
    receiver.onChunk(0, chunk)
    expect(receiver.onChunk(0, chunk)).toEqual({ complete: false, contiguous: 0 })
    expect(receiver.receivedCount).toBe(1)
    const finished = receiver.onChunk(1, chunk)
    expect(finished.complete).toBe(true)
    // after completion further chunks are ignored
    expect(receiver.onChunk(1, chunk)).toEqual({ complete: false, contiguous: 1 })
  })

  it('out-of-order chunks complete once the gap fills', () => {
    const receiver = new FileReceiver(makeMeta(3 * CHUNK))
    const chunk = new Uint8Array(CHUNK).fill(3)
    expect(receiver.onChunk(2, chunk)).toMatchObject({ contiguous: -1 })
    expect(receiver.onChunk(0, chunk)).toMatchObject({ contiguous: 0 })
    expect(receiver.onChunk(1, chunk).complete).toBe(true)
  })
})

describe('ack cadence', () => {
  it('acks at the cadence boundary or at the end', () => {
    expect(shouldAckNow(-1, 15, 100)).toBe(true)
    expect(shouldAckNow(15, 16, 100)).toBe(false)
    expect(shouldAckNow(15, 99, 100)).toBe(true)
  })
})

