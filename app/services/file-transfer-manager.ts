/**
 * File-transfer orchestration: glues the pure state machines in
 * `core/file-transfer.ts` to Dexie (files table), the outbox and the WebRTC
 * transport. All decision logic stays in core; this class only wires it.
 *
 * Honest behaviour: without an open direct DataChannel the file message stays
 * pending ("waiting for a direct connection") â€” relays never carry file bytes.
 */
import type { Envelope, FileAck, FileMeta } from '~~/core/protocol'
import type { TelepattyDb, FileRow, MessageKind } from '~~/core/db'
import type { Clock } from '~~/core/clock'
import type { LamportState } from '~~/core/router'
import { nextLamport } from '~~/core/router'
import { newId } from '~~/core/ids'
import {
  FileReceiver,
  FileSender,
  encodeChunkFrame,
  chunkFrameBytes,
  decodeChunkFrame,
  verifyTransfer,
  shouldAckNow,
  DEFAULT_CHUNK_SIZE,
  type SenderChannel,
} from '~~/core/file-transfer'
import { isReceivableSize, sanitizeFileName } from '~~/core/files'
import { messageFromEnvelope, putMessage } from '~~/core/chat-store'
import { emitBus } from '~~/core/bus'

export interface OutboxMessageLike {
  id: string
  chatId: string
  from: string
  to: string
  body: string
  replyTo?: string
  replyExcerpt?: string
  replyFrom?: string
  kind?: MessageKind
  fileMeta?: FileMeta
  ts: number
  lamport: number
}

export interface FileTransferDeps {
  db: TelepattyDb
  clock: Clock
  lamport: LamportState
  /** my public key (hex) */
  myPk: () => string
  /** send a small envelope through the normal router (acks / cancel) */
  send: (env: Envelope) => Promise<boolean>
  /** is the direct DataChannel to this peer open? */
  isDirect: (peerPk: string) => boolean
  /** send one raw chunk frame over the peer channel */
  rawSend: (peerPk: string, raw: string) => boolean
  onChannelOpen: (cb: (peerPk: string, open: boolean) => void) => void
  onBufferLow: (cb: (peerPk: string) => void) => void
  onRawFrame: (cb: (peerPk: string, raw: string) => void) => void
  /** receiver-side auto-download setting (images from friends) */
  autoDownloadImages: () => boolean
  /** is this peer a friend (not just an outgoing-pending invite)? */
  isFriend: (pk: string) => boolean
}

interface SendState {
  chatId: string
  messageId: string
  sender: FileSender
}

interface ReceiveState {
  chatId: string
  messageId: string
  receiver: FileReceiver
  lastAcked: number
  expireAt?: number
}

export function fileEnvelope(base: { from: string; to: string; file: FileMeta; expireAt?: number }, clock: Clock, lamport: LamportState): Envelope {
  return {
    id: newId(),
    v: 1,
    type: 'file',
    from: base.from,
    to: base.to,
    ts: clock.now(),
    lamport: nextLamport(lamport),
    file: base.file,
    expireAt: base.expireAt,
  }
}

export function fileAckEnvelope(base: { from: string; to: string; ack: FileAck }, clock: Clock, lamport: LamportState): Envelope {
  return {
    id: newId(),
    v: 1,
    type: 'file_ack',
    from: base.from,
    to: base.to,
    ts: clock.now(),
    lamport: nextLamport(lamport),
    fileAck: base.ack,
  }
}


export class FileTransferManager {
  private senders = new Map<string, SendState>()
  private receivers = new Map<string, ReceiveState>()
  /** raw bytes held in memory only while a transfer is running */
  private outBytes = new Map<string, Uint8Array>()

  constructor(private deps: FileTransferDeps) {
    deps.onChannelOpen((pk, open) => {
      if (!open) return
      for (const [, s] of this.senders) {
        if (s.chatId === pk) s.sender.resume()
      }
    })
    deps.onBufferLow((pk) => {
      for (const [, s] of this.senders) {
        if (s.chatId === pk) s.sender.pump()
      }
    })
    deps.onRawFrame((pk, raw) => void this.onRawFrame(pk, raw))
  }

  /* ------------------------- send side ------------------------- */

  /**
   * Enqueue a file message: the metadata rides the normal outbox (pending
   * until the peer is reachable), the blob waits locally in the files table
   * and streams when the direct channel opens. `enqueue` is the outbox hook
   * owned by the messenger.
   */
  async send(opts: {
    chatId: string
    caption?: string
    blob: Blob
    name: string
    mime: string
    size: number
    sha256: string
    thumb?: string
    reply?: { id: string; senderPubkey: string; excerpt: string } | undefined
    expireAt?: number
    enqueue: (msg: OutboxMessageLike) => Promise<{ id: string; ts: number; lamport: number }>
  }): Promise<{ id: string; transferId: string }> {
    const myPk = this.deps.myPk()
    const transferId = newId()
    const meta: FileMeta = {
      transferId,
      name: sanitizeFileName(opts.name),
      mime: opts.mime,
      size: opts.size,
      sha256: opts.sha256,
      chunkSize: DEFAULT_CHUNK_SIZE,
      thumb: opts.thumb,
    }
    const kind: MessageKind = opts.mime.startsWith('image/') ? 'image' : opts.mime.startsWith('video/') ? 'video' : 'file'
    const enqueued = await opts.enqueue({
      id: transferId,
      chatId: opts.chatId,
      from: myPk,
      to: opts.chatId,
      body: opts.caption ?? '',
      replyTo: opts.reply?.id,
      replyExcerpt: opts.reply?.excerpt,
      replyFrom: opts.reply?.senderPubkey,
      kind,
      fileMeta: meta,
      ts: this.deps.clock.now(),
      // FIX: file messages used to be enqueued with lamport 0, which sorted
      // them to the very top (oldest) of the [chatId+lamport] ordering — the
      // send looked like "nothing happened" and the sender clock never moved.
      lamport: nextLamport(this.deps.lamport),
    })
    const row = messageFromEnvelope(
      {
        id: enqueued.id,
        v: 1,
        type: 'chat',
        from: myPk,
        to: opts.chatId,
        ts: enqueued.ts,
        lamport: enqueued.lamport,
        body: opts.caption ?? '',
        replyTo: opts.reply,
        file: meta,
        expireAt: opts.expireAt,
      },
      'out',
      opts.expireAt,
    )
    row.fileId = transferId
    await putMessage(this.deps.db, row, { countUnread: false })
    const fileRow: FileRow = {
      id: transferId,
      chatId: opts.chatId,
      messageId: row.id,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      blob: opts.blob,
      direction: 'out',
      createdAt: this.deps.clock.now(),
      expireAt: opts.expireAt,
    }
    try {
      await this.deps.db.files.put(fileRow)
    } catch {
      // quota exhausted: keep the message row, fail the transfer honestly
      emitBus('file-failed', { chatId: opts.chatId, messageId: row.id, reason: 'quota', direction: 'out' })
      throw new Error('quota')
    }
    this.outBytes.set(transferId, new Uint8Array(await opts.blob.arrayBuffer()))
    return { id: row.id, transferId }
  }


  /** Receiver accepted (or resumed): start/continue streaming the bytes. */
  private async startSender(transferId: string, ack: FileAck): Promise<void> {
    const fileRow = await this.deps.db.files.get(transferId)
    if (!fileRow?.messageId) return
    const msg = await this.deps.db.messages.get(fileRow.messageId)
    if (!msg?.fileMeta) return
    const meta: FileMeta = msg.fileMeta
    let bytes = this.outBytes.get(transferId)
    if (!bytes) {
      bytes = new Uint8Array(await fileRow.blob.arrayBuffer())
      this.outBytes.set(transferId, bytes)
    }
    if (this.senders.has(transferId)) {
      this.senders.get(transferId)!.sender.onAck(ack)
      return
    }
    const chatId = fileRow.chatId
    const channel: SenderChannel = {
      sendChunk: (tid, i, chunk) => this.deps.rawSend(chatId, encodeChunkFrame(tid, i, chunk)),
      canSend: () => this.deps.isDirect(chatId),
    }
    const sender = new FileSender({
      meta,
      bytes,
      channel,
      onProgress: (sent, total) => {
        emitBus('file-progress', { chatId, messageId: fileRow.messageId!, progress: sent / total, direction: 'out' })
      },
      onDone: () => {
        this.outBytes.delete(transferId)
        this.senders.delete(transferId)
        emitBus('file-progress', { chatId, messageId: fileRow.messageId!, progress: 1, direction: 'out' })
      },
      onAborted: (reason) => {
        this.senders.delete(transferId)
        emitBus('file-failed', { chatId, messageId: fileRow.messageId!, reason, direction: 'out' })
      },
    })
    this.senders.set(transferId, { chatId, messageId: fileRow.messageId, sender })
    sender.onAck(ack)
  }

  /* ----------------------- receive side ------------------------ */

  /** A chat envelope carrying file metadata just arrived (normal receive path). */
  async onIncomingFileMessage(env: Envelope): Promise<void> {
    const meta = env.file
    if (!meta) return
    // auto-download images from friends; everything else is tap-to-download
    const auto = this.deps.autoDownloadImages() && this.deps.isFriend(env.from)
    if (auto || this.deps.isDirect(env.from)) {
      await this.deps.send(
        fileAckEnvelope({ from: this.deps.myPk(), to: env.from, ack: { transferId: meta.transferId, accept: true } }, this.deps.clock, this.deps.lamport),
      )
    }
    // chunks may start arriving before the ack round-trip completes
    this.receivers.set(meta.transferId, {
      chatId: env.from,
      messageId: env.id,
      receiver: new FileReceiver(meta),
      lastAcked: -1,
      expireAt: env.expireAt,
    })
  }

  /** Incoming `file` metadata envelope (dedicated type; E2EE like chat). */
  async onFileOffer(env: Envelope): Promise<void> {
    const meta = env.file
    if (!meta || !isReceivableSize(meta)) return
    const existing = await this.deps.db.messages.get(env.id)
    if (existing) return
    const row = messageFromEnvelope(env, 'in', env.expireAt)
    row.state = 'delivered'
    await putMessage(this.deps.db, row, { countUnread: true })
    await this.onIncomingFileMessage(env)
  }

  /** Incoming ack for one of our outgoing transfers. */
  onFileAck(env: Envelope): void {
    const ack = env.fileAck
    if (!ack) return
    const state = this.senders.get(ack.transferId)
    if (state) {
      state.sender.onAck(ack)
      return
    }
    if (ack.accept) void this.startSender(ack.transferId, ack)
  }

  /** Peer cancelled the transfer. */
  onFileCancel(env: Envelope): void {
    const transferId = env.fileAck?.transferId
    if (!transferId) return
    const send = this.senders.get(transferId)
    if (send) {
      send.sender.cancel()
      this.senders.delete(transferId)
      emitBus('file-failed', { chatId: send.chatId, messageId: send.messageId, reason: 'cancelled', direction: 'out' })
    }
    this.receivers.delete(transferId)
  }


  /** Raw chunk frame from the DataChannel. */
  private async onRawFrame(peerPk: string, raw: string): Promise<void> {
    const frame = decodeChunkFrame(raw)
    if (!frame) return
    let recv = this.receivers.get(frame.transferId)
    if (!recv) {
      // chunks arrived without ack bookkeeping — rebuild from the message row
      const msg = await this.deps.db.messages.get(frame.transferId)
      if (!msg?.fileMeta) return
      recv = {
        chatId: msg.chatId,
        messageId: msg.id,
        receiver: new FileReceiver({ ...msg.fileMeta }),
        lastAcked: -1,
        expireAt: msg.expireAt,
      }
      this.receivers.set(frame.transferId, recv)
    }
    const verdict = recv.receiver.onChunk(frame.i, chunkFrameBytes(frame))
    if ('rejected' in verdict) {
      await this.deps.send(
        fileAckEnvelope({ from: this.deps.myPk(), to: peerPk, ack: { transferId: frame.transferId, ok: false, error: verdict.rejected } }, this.deps.clock, this.deps.lamport),
      )
      this.receivers.delete(frame.transferId)
      emitBus('file-failed', { chatId: recv.chatId, messageId: recv.messageId, reason: verdict.rejected, direction: 'in' })
      return
    }
    if (!verdict.complete) {
      emitBus('file-progress', { chatId: recv.chatId, messageId: recv.messageId, progress: recv.receiver.progress, direction: 'in' })
      if (shouldAckNow(recv.lastAcked, recv.receiver.contiguousIndex, recv.receiver.total)) {
        recv.lastAcked = recv.receiver.contiguousIndex
        await this.deps.send(
          fileAckEnvelope({ from: this.deps.myPk(), to: peerPk, ack: { transferId: frame.transferId, resumeFrom: recv.receiver.contiguousIndex } }, this.deps.clock, this.deps.lamport),
        )
      }
      return
    }
    await this.completeReceive(peerPk, frame.transferId, verdict.bytes)
  }

  /** Verify + store the assembled bytes, then ACK the result. */
  private async completeReceive(peerPk: string, transferId: string, assembled: Uint8Array): Promise<void> {
    const recv = this.receivers.get(transferId)
    if (!recv) return
    const result = await verifyTransfer(assembled, recv.receiver.meta)
    if (!result.ok) {
      await this.deps.send(
        fileAckEnvelope({ from: this.deps.myPk(), to: peerPk, ack: { transferId, ok: false, error: result.reason } }, this.deps.clock, this.deps.lamport),
      )
      this.receivers.delete(transferId)
      emitBus('file-failed', { chatId: recv.chatId, messageId: recv.messageId, reason: result.reason, direction: 'in' })
      return
    }
    const meta = recv.receiver.meta
    const blob = new Blob([assembled as BlobPart], { type: meta.mime || 'application/octet-stream' })
    const fileRow: FileRow = {
      id: transferId,
      chatId: recv.chatId,
      messageId: recv.messageId,
      name: sanitizeFileName(meta.name),
      mime: meta.mime,
      size: meta.size,
      blob,
      direction: 'in',
      createdAt: this.deps.clock.now(),
      expireAt: recv.expireAt,
    }
    try {
      await this.deps.db.files.put(fileRow)
      const msg = await this.deps.db.messages.get(recv.messageId)
      if (msg) {
        msg.fileId = transferId
        await this.deps.db.messages.put(msg)
      }
    } catch {
      emitBus('file-failed', { chatId: recv.chatId, messageId: recv.messageId, reason: 'quota', direction: 'in' })
      return
    }
    this.receivers.delete(transferId)
    await this.deps.send(
      fileAckEnvelope({ from: this.deps.myPk(), to: peerPk, ack: { transferId, ok: true } }, this.deps.clock, this.deps.lamport),
    )
    emitBus('file-done', { chatId: recv.chatId, messageId: recv.messageId, fileId: transferId, direction: 'in' })
  }

  /** Tap-to-download on the receiver side (non-auto images / other files). */
  async requestDownload(messageId: string): Promise<void> {
    const msg = await this.deps.db.messages.get(messageId)
    if (!msg?.fileMeta) return
    await this.deps.send(
      fileAckEnvelope({ from: this.deps.myPk(), to: msg.chatId, ack: { transferId: msg.fileMeta.transferId, accept: true } }, this.deps.clock, this.deps.lamport),
    )
  }

  /** Sender-side cancel (button on the bubble). */
  async cancel(messageId: string): Promise<void> {
    const msg = await this.deps.db.messages.get(messageId)
    if (!msg?.fileMeta) return
    const transferId = msg.fileMeta.transferId
    this.senders.get(transferId)?.sender.cancel()
    this.senders.delete(transferId)
    this.outBytes.delete(transferId)
    await this.deps.send(
      fileAckEnvelope({ from: this.deps.myPk(), to: msg.chatId, ack: { transferId, error: 'cancelled' } }, this.deps.clock, this.deps.lamport),
    )
    emitBus('file-failed', { chatId: msg.chatId, messageId, reason: 'cancelled', direction: 'out' })
  }
}

