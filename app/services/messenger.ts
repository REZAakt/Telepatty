import type { Envelope } from '~~/core/protocol'
import { PROTOCOL_VERSION } from '~~/core/protocol'

import { MessageRouter, nextLamport, observeLamport, receiptEnvelope, type LamportState } from '~~/core/router'
import { NostrTransport } from '~~/core/nostr-transport'
import { WebRtcTransport } from '~~/core/webrtc-transport'
import { Outbox, toEnvelope } from '~~/core/outbox'
import { validateIncoming } from '~~/core/receive'
import { RequestRateLimiter } from '~~/core/invites'
import { SystemClock, type Clock } from '~~/core/clock'
import { purgeExpired } from '~~/core/purge'
import { getDb } from '~~/core/db'
import {
  messageFromEnvelope,
  putMessage,
  putMessageState,
  markChatRead,
  isEventProcessed,
  markEventsProcessed,
  newestSyncCheckpoint,
  pruneProcessedEvents,
  saveSyncState,
  SYNC_SAFETY_WINDOW_MS,
  type WriteOpts,
} from '~~/core/chat-store'
import { useIdentityStore } from '../stores/identity'
import { useContactsStore } from '../stores/contacts'
import { useChatsStore } from '../stores/chats'
import { useSettingsStore } from '../stores/settings'
import { FileTransferManager } from './file-transfer-manager'
import { assertSendableSize, makeThumbnail, resizeImageBlob, sha256Hex } from '~~/core/files'
import type { FileMeta, ReplyRef } from '~~/core/protocol'


let instance: Messenger | null = null

export function getMessenger(): Messenger | null {
  return instance
}

/** Global singleton orchestrating transports, outbox, receive pipeline, receipts. */
export class Messenger {
  router = new MessageRouter((env) => {
    // signaling always via nostr; live chat via webrtc when the peer channel is open
    if (env.type !== 'signal' && this.webrtc?.connected(env.to)) return this.webrtc
    return this.nostr ?? undefined
  })

  nostr: NostrTransport | null = null
  webrtc: WebRtcTransport | null = null
  outbox: Outbox | null = null
  files: FileTransferManager | null = null
  clock: Clock = new SystemClock()
  lamport: LamportState = { last: 0 }
  rateLimiter = new RequestRateLimiter()
  purgeTimer: ReturnType<typeof setInterval> | null = null
  private unsubReceive: (() => void)[] = []
  /** file-transfer event fan-out (registered by FileTransferManager on start) */
  private fileChannelCbs: ((pk: string, open: boolean) => void)[] = []
  private fileBufferCbs: ((pk: string) => void)[] = []
  private fileFrameCbs: ((pk: string, raw: string) => void)[] = []


  async start(): Promise<void> {
    const id = useIdentityStore()
    const settings = useSettingsStore()
    if (!id.skBytes || this.nostr) return
    const db = getDb()
    await pruneProcessedEvents(db)
    const checkpoint = await newestSyncCheckpoint(db, id.pk)
    const sinceMs = checkpoint ? Math.max(0, checkpoint - SYNC_SAFETY_WINDOW_MS) : this.clock.now() - SYNC_SAFETY_WINDOW_MS

    this.nostr = new NostrTransport({
      relays: settings.relays,
      identity: { sk: id.skBytes, pk: id.pk },
      clock: this.clock,
      minAccepts: settings.minRelays,
      since: Math.floor(sinceMs / 1000),
      isWrapProcessed: (wrapId) => isEventProcessed(db, wrapId),
      markWrapProcessed: async (wrapId, createdAt, outcome) => {
        await markEventsProcessed(db, [wrapId], outcome)
        await Promise.all(settings.relays.map((relay) =>
          saveSyncState(db, { relay, recipientPk: id.pk, lastEventAt: createdAt * 1000, eose: false }),
        ))
      },
      onStatus: (status) => {
        // per-relay health comes from dedicated REQ→EOSE probes (settings page);
        // pool status only drives the global header chip
        useUiStoreSafe().transportStatus = status
      },

    })
    this.webrtc = new WebRtcTransport(id.pk, {
      iceServers: settings.iceServers,
      signal: async (env) => {
        // signals ride the nostr slow path; single relay acceptance is enough
        const wrap = this.nostr!.send(env)
        return wrap
      },
      onEnvelope: (env) => void this.handleEnvelope(env),
      // file-transfer plumbing — the manager registers itself right below
      onRaw: (pk, raw) => this.fileFrameCbs.forEach((cb) => cb(pk, raw)),
      onPeerChannel: (pk, open) => this.fileChannelCbs.forEach((cb) => cb(pk, open)),
      onBufferLow: (pk) => this.fileBufferCbs.forEach((cb) => cb(pk)),
      onStatus: (status, peers) => {
        useUiStoreSafe().directPeers = peers
        useUiStoreSafe().webrtcStatus = status
      },
    })

    const self = this
    this.files = new FileTransferManager({
      db,
      clock: this.clock,
      lamport: this.lamport,
      myPk: () => id.pk,
      send: (env) => self.sendRaw(env),
      isDirect: (pk) => self.webrtc?.connected(pk) ?? false,
      rawSend: (pk, raw) => self.webrtc?.sendRaw(pk, raw) ?? false,
      onChannelOpen: (cb) => self.fileChannelCbs.push(cb),
      onBufferLow: (cb) => self.fileBufferCbs.push(cb),
      onRawFrame: (cb) => self.fileFrameCbs.push(cb),
      autoDownloadImages: () => useSettingsStore().autoDownloadImages,
      isFriend: (pk) => useContactsStore().friendPks.has(pk),
    })

    this.outbox = new Outbox({
      clock: this.clock,
      send: async (msg) => {
        const env = toEnvelope(msg)
        const res = await self.router.send(env)
        return res.ok
      },
      onStateChange: () => {},
      save: async (msg) => {
        await putMessage(db, msg, { countUnread: false })
      },
      remove: async (id) => {
        const m = await db.messages.get(id)
        if (m && (m.state === 'delivered' || m.state === 'read')) await db.messages.put(m)
      },
      get: async (id) => (await db.messages.get(id)) as import('~~/core/outbox').Message | undefined,
      due: async (now) =>
        (await db.messages.where('state').equals('pending').toArray()).filter((m) => m.nextAttemptAt <= now) as import('~~/core/outbox').Message[],
      nextAttemptAt: async () => {
        const pend = await db.messages.where('state').equals('pending').toArray()
        if (!pend.length) return null
        return Math.min(...pend.map((m) => m.nextAttemptAt))
      },
    })

    this.router.register(this.nostr)
    this.router.register(this.webrtc)
    this.unsubReceive.push(this.router.onReceive((env) => void this.handleEnvelope(env)))

    this.nostr.connect()
    void this.outbox.process()
    await purgeExpired(db, this.clock)
    this.purgeTimer = setInterval(() => void purgeExpired(getDb(), this.clock), 60_000)

    // lamport bootstrap: max across stored messages (lamport is indexed since v3)
    const lam = await db.messages.orderBy('lamport').last()
    this.lamport.last = lam?.lamport ?? 0

  }

  stop(): void {
    for (const un of this.unsubReceive) un()
    this.unsubReceive = []
    this.nostr?.stop()
    this.webrtc?.stop()
    if (this.purgeTimer) clearInterval(this.purgeTimer)
    this.purgeTimer = null
    this.outbox?.stop()
    this.nostr = null
    this.webrtc = null
    this.outbox = null
    this.files = null
    this.fileChannelCbs = []
    this.fileBufferCbs = []
    this.fileFrameCbs = []
  }

  async reconnect(): Promise<void> {
    this.nostr?.reconnect()
  }

  async sendChat(chatId: string, body: string, reply?: { id: string; senderPubkey: string; excerpt: string }): Promise<void> {
    const id = useIdentityStore()
    const contacts = useContactsStore()
    const chats = useChatsStore()
    const settings = useSettingsStore()
    if (!id.skBytes || !this.outbox) return
    const friend = contacts.friend(chatId)
    const expireAfter = friend?.expireAfter
    const expireAt = expireAfter ? Date.now() + expireAfter * 1000 : undefined
    const msg = await this.outbox.enqueue({
      chatId,
      from: id.pk,
      to: chatId,
      body,
      replyTo: reply?.id,
      replyExcerpt: reply?.excerpt,
      replyFrom: reply?.senderPubkey,
      kind: 'text',
      ts: this.clock.now(),
      lamport: nextLamport(this.lamport),
      expireAt,
        })
    await putMessage(getDb(), msg, { countUnread: false })
  }

  /**
   * Send a file: enforce the 5 MB cap, downscale+re-encode images (strips
   * EXIF/GPS) unless the user explicitly sends the original, hash the bytes,
   * then hand off to the FileTransferManager (metadata via outbox, bytes via
   * the direct DataChannel only).
   */
  async sendFileMessage(
    chatId: string,
    file: File | Blob,
    opts: { name: string; mime: string; caption?: string; sendOriginal?: boolean; reply?: ReplyRef } = { name: 'file', mime: 'application/octet-stream' },
  ): Promise<string | null> {
    const id = useIdentityStore()
    const contacts = useContactsStore()
    const settings = useSettingsStore()
    if (!id.skBytes || !this.outbox || !this.files) return null
    assertSendableSize(file.size)
    const isImage = opts.mime.startsWith('image/')
    let blob = file
    if (isImage && !opts.sendOriginal) {
      // canvas re-encode strips EXIF/GPS and shrinks long side to <=1600px
      const prepared = await resizeImageBlob(file)
      blob = prepared.blob
      assertSendableSize(blob.size)
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    const thumb = isImage ? await makeThumbnail(blob) : undefined
    const friend = contacts.friend(chatId)
    const expireAfter = friend?.expireAfter
    const expireAt = expireAfter ? Date.now() + expireAfter * 1000 : undefined
    const res = await this.files.send({
      chatId,
      caption: opts.caption,
      blob,
      name: opts.name,
      mime: isImage && !opts.sendOriginal ? 'image/webp' : opts.mime,
      size: blob.size,
      sha256,
      thumb,
      reply: opts.reply,
      expireAt,
      enqueue: (m) => this.outbox!.enqueue(m),
    })
    return res.id
  }

  /** Receiver side: user tapped "download" on a non-auto attachment. */
  async requestFileDownload(messageId: string): Promise<void> {
    await this.files?.requestDownload(messageId)
  }

  /** Sender side: cancel a running/waiting transfer. */
  async cancelFileTransfer(messageId: string): Promise<void> {
    await this.files?.cancel(messageId)
  }

  /** Send a raw envelope via the router (signals, receipts, friend requests). */
  async sendRaw(env: Envelope): Promise<boolean> {
    const res = await this.router.send(env)
    return res.ok
  }


  async sendFriendRequest(toPk: string, name?: string): Promise<void> {
    const id = useIdentityStore()
    if (!id.skBytes) return
    await this.sendRaw({
      id: crypto.randomUUID(),
      v: PROTOCOL_VERSION,
      type: 'friend_request',
      from: id.pk,
      to: toPk,
      ts: Date.now(),
      lamport: nextLamport(this.lamport),
      name: name?.slice(0, 64),
    })
  }

  async sendFriendAccept(toPk: string, name?: string): Promise<void> {
    const id = useIdentityStore()
    if (!id.skBytes) return
    await this.sendRaw({
      id: crypto.randomUUID(),
      v: PROTOCOL_VERSION,
      type: 'friend_accept',
      from: id.pk,
      to: toPk,
      ts: Date.now(),
      lamport: nextLamport(this.lamport),
      name: name?.slice(0, 64),
    })
  }

  async sendFriendDecline(toPk: string): Promise<void> {
    const id = useIdentityStore()
    if (!id.skBytes) return
    await this.sendRaw({
      id: crypto.randomUUID(),
      v: PROTOCOL_VERSION,
      type: 'friend_decline',
      from: id.pk,
      to: toPk,
      ts: Date.now(),
      lamport: nextLamport(this.lamport),
    })
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.webrtc?.connected(chatId)) return // typing only over WebRTC
    const id = useIdentityStore()
    await this.sendRaw({
      id: crypto.randomUUID(),
      v: PROTOCOL_VERSION,
      type: 'typing',
      from: id.pk,
      to: chatId,
      ts: Date.now(),
      lamport: nextLamport(this.lamport),
    })
  }

  /** Central receive pipeline: validate → dedupe → dispatch by type. */
  async handleEnvelope(env: Envelope): Promise<void> {
    const id = useIdentityStore()
    const contacts = useContactsStore()
    const chats = useChatsStore()
    const db = getDb()
    if (!id.pk) return

    const verdict = validateIncoming(env, id.pk, {
      friends: contacts.friendPks,
      outgoingPending: contacts.outgoingPending,
      blocked: contacts.blockedPks,
      rateLimiter: this.rateLimiter,
      now: Date.now(),
    })
    if (!verdict.allow) return

    // idempotent receive
    if (await db.messages.get(env.id)) {
      if (env.type === 'receipt') void this.applyReceipt(env)
      return
    }
    observeLamport(this.lamport, env.lamport)

    switch (env.type) {
            case 'chat': {
        // a message from someone we invited but hadn't marked as friend yet
        // means their accept never reached us (or arrived out of order) — heal
        await this.finalizeFriendship(env)
        const msg = messageFromEnvelope(env, 'in', env.expireAt)
        msg.state = 'delivered'
        const friend = contacts.friend(env.from)
        const muted = !!friend?.mutedUntil && friend.mutedUntil > Date.now()
        const opts: WriteOpts = {
          countUnread: true,
          openChatId: chats.openChatId,
          muted,
        }
        await putMessage(db, msg, opts)
        void this.sendRaw(receiptEnvelope({ from: id.pk, to: env.from, refId: env.id, read: false }, this.clock, this.lamport))
        if (env.file) void this.files?.onIncomingFileMessage(env)
        useUiStoreSafe().notifyIncoming(env)
        break
      }
      case 'receipt':
        await this.applyReceipt(env)
        break
      case 'typing':
        chats.setTyping(env.from, Date.now() + 5_000)
        break
      case 'file':
        await this.files?.onFileOffer(env)
        break
      case 'file_ack':
        this.files?.onFileAck(env)
        break
      case 'file_cancel':
        this.files?.onFileCancel(env)
        break
      case 'friend_request': {
        // heal: we are already friends, but the peer still sees the request as
        // pending (their side missed our accept) — accept again, no new row
        if (contacts.friendPks.has(env.from)) {
          await this.sendFriendAccept(env.from, id.displayName)
          break
        }
        const alreadyOut = contacts.outgoingPending.has(env.from)
        await contacts.addRequest(env.from, env.name, 'in')
        if (alreadyOut) {
          await contacts.ensureFriend(env.from, env.name)
          await contacts.removeRequest(env.from)
          await this.sendFriendAccept(env.from, id.displayName)
          useUiStoreSafe().notifyFriendAccepted(env)
        } else {
          useUiStoreSafe().notifyFriendRequest(env)
        }
        break
      }
      case 'friend_accept': {
        const wasPending = contacts.outgoingPending.has(env.from) && !contacts.friendPks.has(env.from)
        await contacts.ensureFriend(env.from, env.name)
        await contacts.removeRequest(env.from)
        if (wasPending) useUiStoreSafe().notifyFriendAccepted(env)
        break
      }
      case 'friend_decline': {
        await contacts.removeRequest(env.from)
        break
      }
      case 'signal':
        await this.webrtc?.handleSignal(env)
        break
      default:
        break
    }
  }

  /** Promote a pending-outgoing sender to a friend: only someone whose invite
   *  we answered can reach us this way, and their traffic proves acceptance. */
  private async finalizeFriendship(env: Envelope): Promise<void> {
    const contacts = useContactsStore()
    if (contacts.friendPks.has(env.from)) return
    if (!contacts.outgoingPending.has(env.from)) return
    await contacts.ensureFriend(env.from, env.name)
    await contacts.removeRequest(env.from)
    useUiStoreSafe().notifyFriendAccepted(env)
  }

  private async applyReceipt(env: Envelope): Promise<void> {
    if (!env.refId) return
    const db = getDb()
    const msg = await db.messages.get(env.refId)
    if (!msg || msg.direction !== 'out') return
    if (env.receipt === 'delivered' && (msg.state === 'sent' || msg.state === 'pending')) {
      await putMessageState(db, msg.id, 'delivered')
    } else if (env.receipt === 'read') {
      await putMessageState(db, msg.id, 'read', { readAt: env.ts })
    }
  }

  /** Drain unread for a chat and reply with one read receipt per flipped message. */
  async sendReadReceipts(chatId: string): Promise<void> {
    const id = useIdentityStore()
    if (!id.skBytes || !useSettingsStore().readReceipts) return
    const db = getDb()
    const ids = await markChatRead(db, chatId)
    for (const refId of ids) {
      void this.sendRaw(receiptEnvelope({ from: id.pk, to: chatId, refId, read: true }, this.clock, this.lamport))
    }
  }
}

interface UiStoreLike {
  transportStatus: string
  webrtcStatus: string
  directPeers: string[]
  notifyIncoming(env: Envelope): void
  notifyFriendRequest(env: Envelope): void
  notifyFriendAccepted(env: Envelope): void
}

let uiStoreRef: UiStoreLike | null = null

/** Late-bound ui store (avoids circular imports at module load). */
export function setUiStoreRef(s: UiStoreLike | null): void {
  uiStoreRef = s
}

function useUiStoreSafe(): UiStoreLike {
  if (uiStoreRef) return uiStoreRef
  return {
    transportStatus: 'disconnected',
    webrtcStatus: 'disconnected',
    directPeers: [] as string[],
    notifyIncoming: (_e: Envelope) => {},
    notifyFriendRequest: (_e: Envelope) => {},
    notifyFriendAccepted: (_e: Envelope) => {},
  }
}

export function createMessenger(): Messenger {
  instance = new Messenger()
  return instance
}


