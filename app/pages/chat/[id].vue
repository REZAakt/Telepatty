<script setup lang="ts">
import { markRaw, shallowRef } from 'vue'
import type { ChatMessageRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import { onBus } from '~~/core/bus'
import { PAGE_SIZE, pageMessages } from '~~/core/chat-store'
import { measureAsync } from '~~/core/perf'
import { compareMessages } from '~~/core/receive'
import { DISAPPEARING_OPTIONS } from '~~/core/theme'
import { makeExcerpt, cycleReplyTarget, canStartReplyCycle, type MessageKind } from '~~/core/reply'
import { MAX_FILE_BYTES } from '~~/core/files'
import { zipFiles } from '~~/core/zip'
import { cancelRecording, stopRecording } from '~~/core/voice-recorder'
import { useAutoFocus } from '../../composables/useAutoFocus'
import { useTypeToFocus } from '../../composables/useTypeToFocus'

const route = useRoute()
const router = useRouter()
const chats = useChatsStore()
const contacts = useContactsStore()
const identity = useIdentityStore()
const ui = useUiStore()
const settings = useSettingsStore()
const { t } = useI18n()
const fmt = useFormat()
const toast = useToast()

const chatId = computed(() => String(route.params.id ?? ''))
const friend = computed(() => contacts.friend(chatId.value))
const typing = computed(() => (chats.typing[chatId.value] ?? 0) > Date.now())
const replyTo = ref<ChatMessageRow | null>(null)
const input = ref('')
/**
 * Composer text direction auto-detects from CONTENT, not the app language:
 * typing Persian starts from the right, typing English from the left — even
 * when the app UI language is the opposite. Mixed text follows the first
 * strong-directional character.
 */
const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const LTR_RE = /[A-Za-z\u00C0-\u024F]/
const inputDir = computed<'rtl' | 'ltr'>(() => {
  if (RTL_RE.test(input.value)) return 'rtl'
  if (LTR_RE.test(input.value)) return 'ltr'
  return settings.language === 'fa' ? 'rtl' : 'ltr'
})
const composerEl = ref<HTMLElement | null>(null)
const contactOpen = ref(false)
const timerOpen = ref(false)
const busy = ref(false)
const loadingOlder = ref(false)
const hasMore = ref(false)
const cursor = ref<number | null>(null)
const firstUnreadId = ref<string | null>(null)
const newMessageCount = ref(0)
const messages = shallowRef<ChatMessageRow[]>([])
const busOffs: Array<() => void> = []

const listEl = ref<HTMLElement | null>(null)
const nearBottom = (): boolean => {
  const el = listEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160
}
const scrollToBottom = (smooth = false): void => {
  const el = listEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  newMessageCount.value = 0
}

/* ------------------------- desktop auto-focus ------------------------- */
const { focusNow: focusComposer } = useAutoFocus(() => composerEl.value)
useTypeToFocus(() => composerEl.value)

function refocusIfVisible(): void {
  if (document.visibilityState === 'visible') focusComposer()
}

const messageMap = computed(() => new Map(messages.value.map((m) => [m.id, m])))
const replyPreview = (id?: string): ChatMessageRow | undefined => (id ? messageMap.value.get(id) : undefined)

/** localized label used as the excerpt when a reply quotes an attachment */
function excerptOf(m: ChatMessageRow | null): string {
  if (!m) return ''
  const kind: MessageKind = m.kind ?? 'text'
  const label = kind === 'image' ? t('msg.photo') : kind === 'video' ? t('msg.video') : kind === 'file' ? m.fileMeta?.name ?? t('msg.fileLabel') : undefined
  return makeExcerpt(m.body, label)
}

const grouped = computed(() => {
  const out: { day: string; items: ChatMessageRow[] }[] = []
  for (const m of messages.value) {
    const day = fmt.day(m.ts)
    const last = out.at(-1)
    if (last?.day === day) last.items.push(m)
    else out.push({ day, items: [m] })
  }
  return out
})

async function loadInitial(): Promise<void> {
  const unreadBeforeOpen = chats.unreadFor(chatId.value)
  const page = await measureAsync('chat-open-ready', () => pageMessages(getDb(), chatId.value, { limit: PAGE_SIZE }))
  messages.value = markRaw(page.rows)
  hasMore.value = page.hasMore
  cursor.value = page.cursor
  firstUnreadId.value = unreadBeforeOpen
    ? page.rows.find((m) => m.direction === 'in' && m.state !== 'read')?.id ?? null
    : null
  await chats.markRead(chatId.value)
  ui.updateBadge()
  await nextTick()
  scrollToBottom()
  focusComposer()
}

async function loadOlder(): Promise<void> {
  if (loadingOlder.value || !hasMore.value || cursor.value === null) return
  const el = listEl.value
  const oldHeight = el?.scrollHeight ?? 0
  const oldTop = el?.scrollTop ?? 0
  loadingOlder.value = true
  try {
    const page = await pageMessages(getDb(), chatId.value, { limit: PAGE_SIZE, beforeLamport: cursor.value })
    messages.value = markRaw([...page.rows, ...messages.value].sort(compareMessages).slice(-240))
    hasMore.value = page.hasMore
    cursor.value = page.cursor
    await nextTick()
    if (el) el.scrollTop = el.scrollHeight - oldHeight + oldTop
  } finally {
    loadingOlder.value = false
  }
}

function onListScroll(): void {
  if (listEl.value?.scrollTop === 0) void loadOlder()
}

function upsertWindow(row: ChatMessageRow): void {
  if (row.chatId !== chatId.value) return
  const stick = nearBottom()
  const i = messages.value.findIndex((m) => m.id === row.id)
  const next = i === -1
    ? [...messages.value, row].sort(compareMessages)
    : messages.value.map((m) => (m.id === row.id ? row : m)).sort(compareMessages)
  messages.value = markRaw(next.slice(-240))
  void chats.markRead(chatId.value)
  void nextTick(() => {
    if (stick) scrollToBottom(true)
    else if (i === -1) newMessageCount.value += 1
  })
}

function patchState(payload: { chatId: string; id: string; state: ChatMessageRow['state'] }): void {
  if (payload.chatId !== chatId.value) return
  messages.value = markRaw(messages.value.map((m) => (m.id === payload.id ? { ...m, state: payload.state } : m)))
}

/* ------------------------------ send / reply ------------------------------ */
const send = async () => {
  const body = input.value.trim()
  if (!body || busy.value) return
  input.value = ''
  const reply = replyTo.value
    ? { id: replyTo.value.id, senderPubkey: replyTo.value.direction === 'out' ? identity.pk : replyTo.value.from, excerpt: excerptOf(replyTo.value) }
    : undefined
  replyTo.value = null
  busy.value = true
  try {
    await getMessenger()?.sendChat(chatId.value, body, reply)
    // distinct "sent" sound — clearly different from the incoming tone and from
    // system alerts (Settings → Permissions can mute all sounds)
    useSounds().playSent()
    await nextTick()
    focusComposer()
  } catch (e) {
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  } finally {
    busy.value = false
  }
}

/** Arrow Up in an empty composer: cycle the reply target (Esc cancels). */
const onComposerKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && replyTo.value) {
    e.preventDefault()
    replyTo.value = null
    return
  }
  const target = e.target as HTMLTextAreaElement | null
  if (!target) return
  const composing = e.isComposing || (target as unknown as { composing?: boolean }).composing === true
  if (e.key === 'ArrowUp' && canStartReplyCycle({ value: input.value, selectionStart: target.selectionStart ?? 0, selectionEnd: target.selectionEnd ?? 0, isComposing: composing })) {
    e.preventDefault()
    const next = cycleReplyTarget(messages.value, replyTo.value?.id ?? null, 'up')
    replyTo.value = next ? messageMap.value.get(next) ?? replyTo.value : replyTo.value
  } else if (e.key === 'ArrowDown' && replyTo.value && input.value.length === 0) {
    e.preventDefault()
    const next = cycleReplyTarget(messages.value, replyTo.value.id, 'down')
    replyTo.value = next ? messageMap.value.get(next) ?? null : null
  }
}

/** Jump to the quoted message, loading older pages until it is in the window. */
const highlightId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null
async function jumpToReply(id: string | undefined): Promise<void> {
  if (!id) return
  let tries = 0
  while (!messageMap.value.has(id) && hasMore.value && tries < 20) {
    await loadOlder()
    tries += 1
  }
  const el = document.getElementById(`msg-${id}`)
  if (!el) {
    toast.add({ title: t('msg.replyUnavailable'), color: 'neutral' })
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  highlightId.value = id
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => (highlightId.value = null), 1600)
}

/* ------------------------------ files: attach ----------------------------- */
/**
 * True while the attach/voice flow is actually usable: messenger + WebRTC +
 * files pipelines exist, ICE is configured and the direct DataChannel to this
 * peer is open (file bytes never ride relays). `directConnected` is REACTIVE —
 * it reads `ui.directPeers`, which the transport updates on every channel
 * open/close/bye.
 *
 * It only drives the button TITLES: the buttons stay ENABLED so that a click
 * can say WHY the action cannot run right now (a dead button explains nothing).
 */
const canSendFiles = computed(() => {
  const m = getMessenger()
  return !!m?.webrtc && settings.iceServers.length > 0 && !!m?.files && directConnected.value
})

/**
 * Live gate for the two live-only actions (attach + voice). Says the honest
 * reason — nothing configured vs the other person is not reachable RIGHT NOW —
 * and re-checks at click time, so a stale flag can never lie to the user.
 */
const blockLiveAction = (): boolean => {
  const m = getMessenger()
  if (!m?.webrtc || !m?.files || settings.iceServers.length === 0) {
    toast.add({ title: t('files.disabledTitle'), description: t('files.disabledNoIce'), color: 'warning' })
    return true
  }
  if (!m.webrtc.connected(chatId.value)) {
    toast.add({ title: t('files.bothOnlineRequired'), color: 'warning' })
    return true
  }
  return false
}
const fileInput = ref<HTMLInputElement | null>(null)
const staged = ref<{ file: File; preview?: string }[]>([])
const stageCaption = ref('')
const stageOpen = ref(false)
const sendingFiles = ref(false)
/** live transfer state per message id (drives the bubbles) */
const transfers = ref<Record<string, { progress: number; state: 'waiting' | 'transferring' | 'failed' }>>({})
const lightboxSrc = ref<string | null>(null)
/** refocus the composer after any dialog/sheet/lightbox closes (desktop only) */
watch([contactOpen, timerOpen, stageOpen, lightboxSrc], (_next, prev) => {
  const [pc, ptm, pst, plb] = prev
  if ((pc && !contactOpen.value) || (ptm && !timerOpen.value) || (pst && !stageOpen.value) || (plb && !lightboxSrc.value)) focusComposer()
})

async function addFiles(files: File[]): Promise<void> {
  // paste + drag&drop land here directly (no file dialog), so same gate
  if (blockLiveAction()) return
  if (!files.length) return
  // hard 5 MB cap — checked on selection, BEFORE the user types any caption
  const oversized = files.filter((f) => f.size > MAX_FILE_BYTES)
  const usable = files.filter((f) => f.size <= MAX_FILE_BYTES)
  if (oversized.length) {
    toast.add({ title: t('files.tooBig', { max: t('files.maxLabel') }), description: oversized.map((f) => f.name).join(', '), color: 'error' })
  }
  if (!usable.length) return

  // multiple selection → zip them client-side into ONE file (total still ≤ 5 MB;
  // STORE method, so the archive can never exceed the input total)
  let toStage: File[] = usable
  if (usable.length > 1) {
    const total = usable.reduce((n, f) => n + f.size, 0)
    if (total > MAX_FILE_BYTES) {
      toast.add({ title: t('files.tooBig', { max: t('files.maxLabel') }), description: t('files.zipTooBig'), color: 'error' })
      return
    }
    const blob = await zipFiles(usable)
    toStage = [new File([blob], `telepatty-files-${new Date().toISOString().slice(0, 10)}.zip`, { type: 'application/zip' })]
  }

  staged.value = toStage.map((f) => ({ file: f, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }))
  stageCaption.value = ''
  stageOpen.value = true
}

const pickFiles = (): void => {
  // clicking while the peer is offline must SAY SO (the old `:disabled` produced
  // a dead button with no explanation): file bytes only move over the direct
  // DataChannel, so this can never work without both sides online
  if (blockLiveAction()) return
  fileInput.value?.click()
}

const onFilePick = (e: Event): void => {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void addFiles(files)
}

const onPaste = (e: ClipboardEvent): void => {
  const files = [...(e.clipboardData?.files ?? [])]
  if (files.length) {
    e.preventDefault()
    void addFiles(files)
  }
}

const dragDepth = ref(0)
function onDragEnter(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) dragDepth.value += 1
}
function onDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}
function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent): void {
  dragDepth.value = 0
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) {
    e.preventDefault()
    void addFiles(files)
  }
}

const sendStaged = async (sendOriginal = false) => {
  const m = getMessenger()
  if (!m || sendingFiles.value) return
  sendingFiles.value = true
  try {
    for (const s of staged.value) {
      const messageId = await m.sendFileMessage(chatId.value, s.file, {
        name: s.file.name || t('msg.fileLabel'),
        mime: s.file.type || 'application/octet-stream',
        caption: staged.value.length === 1 ? stageCaption.value : undefined,
        sendOriginal,
      })
      // seed the waiting state so the bubble shows honest feedback from the
      // first frame ("waiting for a direct connection" → progress → done/failed)
      if (messageId) transfers.value = { ...transfers.value, [messageId]: { progress: 0, state: 'waiting' } }
    }
    staged.value.forEach((s) => s.preview && URL.revokeObjectURL(s.preview))
    staged.value = []
    stageCaption.value = ''
    stageOpen.value = false
    await nextTick()
    focusComposer()
  } catch (e) {
    const reason = e instanceof Error && e.message === 'quota' ? t('errors.storageFull') : t('files.tooBig', { max: t('files.maxLabel') })
    toast.add({ title: reason, color: 'error' })
  } finally {
    sendingFiles.value = false
  }
}

/* ------------------------------ voice messages ---------------------------- */
/**
 * Voice notes ride the SAME live-only path as files: the bytes move over the
 * direct DataChannel only, so recording+sending requires both peers to be
 * online at the same time (relays cannot store recordings). Recorded audio is
 * sent as a `file` message with an audio mime — the bubble renders a player.
 */
const recording = ref(false)
const recSeconds = ref(0)
let recorder: MediaRecorder | null = null
let recChunks: Blob[] = []
let recStream: MediaStream | null = null
let recTimer: ReturnType<typeof setInterval> | null = null

const recClock = (s: number): string =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const startVoice = async (): Promise<void> => {
  if (recording.value || busy.value) return
  // voice is live-only too: explain WHY instead of showing a dead mic button
  if (blockLiveAction()) return
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    toast.add({ title: t('errors.micDenied'), color: 'error' })
    return
  }
  try {
    recChunks = []
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    recorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = (e) => {
      if (e.data.size) recChunks.push(e.data)
    }
    recorder.onstop = onVoiceRecorded
    recorder.start()
    recording.value = true
    recSeconds.value = 0
    recTimer = setInterval(() => {
      recSeconds.value += 1
    }, 1000)
  } catch (e) {
    cancelVoice()
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  }
}

/** stop WITHOUT sending (trash button): handlers off first, nothing enqueued */
const cancelVoice = (): void => {
  if (recTimer) clearInterval(recTimer)
  recTimer = null
  recChunks = []
  const rec = recorder
  recorder = null
  recording.value = false
  // Detach BEFORE stop: `MediaRecorder.stop()` fires one last `dataavailable`
  // (+ `onstop`), so stopping with the handlers attached refilled the buffer and
  // SENT the recording the user had just discarded. `cancelRecording` drops both
  // handlers first, so the send path is unreachable (core/voice-recorder.ts).
  cancelRecording(rec)
  recStream?.getTracks().forEach((t) => t.stop())
  recStream = null
}

/** stop and send (send button): assemble + reuse the file pipeline */
const stopVoice = (): void => {
  if (recTimer) clearInterval(recTimer)
  recTimer = null
  stopRecording(recorder) // no-op when it is already inactive (stop() would throw)
}

const onVoiceRecorded = async (): Promise<void> => {
  const chunks = recChunks
  const stream = recStream
  recChunks = []
  recStream = null
  recording.value = false
  stream?.getTracks().forEach((t) => t.stop())
  const blob = new Blob(chunks, { type: 'audio/webm' })
  recorder = null
  if (!blob.size) return
  if (blob.size > MAX_FILE_BYTES) {
    toast.add({ title: t('files.tooBig', { max: t('files.maxLabel') }), color: 'error' })
    return
  }
  const m = getMessenger()
  if (!m) return
  try {
    const messageId = await m.sendFileMessage(chatId.value, blob, {
      name: `voice-${new Date().toISOString().slice(0, 10)}.webm`,
      mime: 'audio/webm',
    })
    if (messageId) transfers.value = { ...transfers.value, [messageId]: { progress: 0, state: 'waiting' } }
  } catch (e) {
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  }
}

/* ------------------------------ misc actions ------------------------------ */
const retry = async (m: ChatMessageRow) => {
  await getMessenger()?.outbox?.retryFailed(m.id)
  await getMessenger()?.outbox?.process()
  if (m.kind && m.kind !== 'text') delete transfers.value[m.id]
}

const copy = async (m: ChatMessageRow) => {
  await navigator.clipboard?.writeText(m.body).catch(() => {})
  toast.add({ title: t('common.copied'), color: 'neutral' })
}

const onExpiry = async (seconds: number) => {
  await contacts.setDisappearing(chatId.value, seconds)
  timerOpen.value = false
}

const disappearLabel = computed(() => {
  const secs = (friend.value?.expireAfter ?? 0)
  if (!secs) return t('chats.expireOff')
  const o = DISAPPEARING_OPTIONS.find((x) => x.value === secs)
  return o?.label ?? String(secs)
})

const exportChat = (json: boolean) => {
  const rows = messages.value.map((m) => ({
    ts: new Date(m.ts).toISOString(),
    from: m.direction === 'out' ? 'me' : friend.value?.nickname || friend.value?.name || m.from,
    body: m.body || (m.kind === 'image' ? t('msg.photo') : m.kind === 'video' ? t('msg.video') : m.fileMeta?.name || t('msg.fileLabel')),
  }))
  const text = json ? JSON.stringify(rows, null, 2) : rows.map((r) => `[${r.ts}] ${r.from}: ${r.body}`).join('\n')
  const blob = new Blob([text], { type: json ? 'application/json' : 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `telepatty-chat-${chatId.value.slice(0, 8)}.${json ? 'json' : 'txt'}`
  a.click()
  URL.revokeObjectURL(a.href)
}

const deleteChat = async () => {
  if (!confirm(t('chats.deleteChatConfirm'))) return
  await chats.removeConvo(chatId.value)
  toast.add({ title: t('chats.localOnly'), color: 'neutral' })
  void router.replace('/')
}

const clearHistory = async () => {
  if (!confirm(t('chats.clearConfirm'))) return
  await chats.clearHistory(chatId.value)
  messages.value = markRaw([])
}

/**
 * Presence, REACTIVELY: `ui.directPeers` is maintained by the WebRTC transport
 * (its `onStatus` fires on every DataChannel open/close/bye/drop), so this
 * computed re-evaluates the moment the channel state changes.
 */
const directConnected = computed(() => ui.directPeers.includes(chatId.value))
/**
 * Fine-grained presence label. ROOT CAUSE of the "unknown vs. offline" bug:
 * the old label had only two states (connected → online, everything else →
 * "unknown"), and the transport kept zombie peer entries alive after a dead
 * connection, so a genuinely-offline peer sat in "connecting" forever. The
 * transport now exposes `peerState()` — failed connections age out into an
 * honest "offline" after ~45 s, while a never-tried peer is truly "unknown".
 * The 5 s heartbeat below re-evaluates it continuously.
 */
const peerPresence = ref<'open' | 'connecting' | 'failed' | 'none'>('none')
function refreshPresence(): void {
  const m = getMessenger()
  if (!m?.webrtc) return
  peerPresence.value = m.webrtc.peerState(chatId.value)
}
const peerStatusLabel = computed(() => {
  if (directConnected.value || peerPresence.value === 'open') return t('chats.online')
  if (peerPresence.value === 'failed') return t('chats.offline')
  return t('chats.presenceUnknown')
})

/** Presence heartbeat: while the chat is open (and visible), re-check the live
 *  channel state every few seconds and re-attempt negotiation when it is gone.
 *  A stale "unknown" therefore self-heals without a page reload. */
const PRESENCE_TICK_MS = 5_000
let presenceTimer: ReturnType<typeof setInterval> | null = null
function presenceCheck(): void {
  if (document.hidden) return
  const m = getMessenger()
  if (!m?.webrtc) return
  refreshPresence()
  // read the LIVE channel state (never a cached flag)…
  if (!m.webrtc.connected(chatId.value)) {
    // …and actively re-establish it (both sides now try; the transport drops
    // zombie peers so the offer actually goes out again)
    void m.webrtc.initiate(chatId.value)
  }
}

async function refreshMessage(id: string): Promise<void> {
  const row = await getDb().messages.get(id)
  if (!row) return
  messages.value = markRaw(messages.value.map((m) => (m.id === row.id ? row : m)))
}

const replyBarExcerpt = computed(() => excerptOf(replyTo.value))
const replyBarName = computed(() => {
  const r = replyTo.value
  if (!r) return ''
  return r.direction === 'out' ? t('chats.you') : contacts.displayName(r.from)
})

const transferOf = (m: ChatMessageRow) => transfers.value[m.id]
const onDownload = (m: ChatMessageRow) => void getMessenger()?.requestFileDownload(m.id)
const onCancelFile = (m: ChatMessageRow) => void getMessenger()?.cancelFileTransfer(m.id)

onMounted(() => {
  if (!friend.value) {
    toast.add({ title: t('friends.invalidInvite'), color: 'error' })
    void router.replace('/')
    return
  }
  chats.openChat(chatId.value)
  busOffs.push(
    onBus('message', upsertWindow),
    onBus('message-state', patchState),
    onBus('message-removed', (payload) => {
      if (payload.chatId === chatId.value) messages.value = markRaw(messages.value.filter((m) => m.id !== payload.id))
    }),
    onBus('read', (payload) => {
      if (payload.chatId !== chatId.value) return
      const set = new Set(payload.ids)
      messages.value = markRaw(messages.value.map((m) => (set.has(m.id) ? { ...m, state: 'read' } : m)))
    }),
    // file-transfer progress, straight from the pipeline
    onBus('file-done', (p: { chatId: string; messageId: string; direction?: string }) => {
      if (p.chatId !== chatId.value) return
      const next = { ...transfers.value }
      delete next[p.messageId]
      transfers.value = next
      void refreshMessage(p.messageId)
      // success state (sender side): the transfer finished and was verified
      if (p.direction === 'out') toast.add({ title: t('files.sent'), color: 'success' })
    }),
    onBus('file-progress', (p: { chatId: string; messageId: string; progress: number; direction?: string }) => {
      if (p.chatId !== chatId.value) return
      // SENDER completion: the sender's own bubble used to stay stuck on the
      // progress line forever, because the final progress=1 event only updated
      // `transfers` while the message row (and its fileId) was never refreshed
      // — the bubble kept rendering "no file" until a manual reload.
      if (p.progress >= 1) {
        void refreshMessage(p.messageId)
        const next = { ...transfers.value }
        delete next[p.messageId]
        transfers.value = next
        return
      }
      transfers.value = { ...transfers.value, [p.messageId]: { progress: p.progress, state: 'transferring' } }
    }),
    onBus('file-failed', (p: { chatId: string; messageId: string; reason: string }) => {
      if (p.chatId !== chatId.value) return
      transfers.value = { ...transfers.value, [p.messageId]: { progress: 0, state: 'failed' } }
      toast.add({ title: t('files.failed'), description: p.reason, color: 'error' })
    }),
  )
  void loadInitial()
  void getMessenger()?.webrtc?.initiate(chatId.value)
  presenceCheck()
  presenceTimer = setInterval(presenceCheck, PRESENCE_TICK_MS)
  document.addEventListener('visibilitychange', presenceCheck)
  window.addEventListener('focus', refocusIfVisible)
  document.addEventListener('visibilitychange', refocusIfVisible)
})

onBeforeUnmount(() => {
  chats.closeChat(chatId.value)
  cancelVoice()
  for (const off of busOffs) off()
  messages.value = markRaw([])
  if (presenceTimer) clearInterval(presenceTimer)
  presenceTimer = null
  document.removeEventListener('visibilitychange', presenceCheck)
  window.removeEventListener('focus', refocusIfVisible)
  document.removeEventListener('visibilitychange', refocusIfVisible)
})

/* tab title: the PEER's name — «نام مخاطب — Telepatty» (chat list until it loads) */
usePageTitle(() => contacts.displayName(chatId.value) || t('chats.title'))
</script>

<template>
  <div
    class="flex-1 flex flex-col min-h-0 relative"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="dragDepth > 0" class="absolute inset-0 z-40 border-2 border-dashed border-(--tp-accent) bg-(--tp-accent)/5 flex items-center justify-center pointer-events-none">
      <p class="tp-mono text-sm text-(--tp-accent)">{{ t('files.dropHere') }}</p>
    </div>

    <div class="flex items-center gap-2 p-2 border-b border-(--tp-border)">
      <UButton icon="i-lucide-arrow-left" to="/" variant="ghost" size="sm" :aria-label="t('nav.back')" class="rtl:rotate-180" />
      <button class="flex items-center gap-2 min-w-0" @click="contactOpen = true">
        <Avatar :pk="chatId" :name="contacts.displayName(chatId)" :size="36" />
        <div class="min-w-0 text-start">
          <p class="font-semibold truncate text-sm">{{ contacts.displayName(chatId) }}</p>
          <p class="tp-mono text-xs text-dimmed">{{ typing ? t('chats.typing') : peerStatusLabel }}</p>
        </div>
      </button>
      <UBadge v-if="disappearLabel !== t('chats.expireOff')" size="sm" variant="subtle" class="tp-mono">
        {{ disappearLabel }}
      </UBadge>
      <div class="flex-1" />
      <UButton icon="i-lucide-more-vertical" variant="ghost" size="sm" aria-label="menu" @click="contactOpen = true" />
    </div>

    <div
      ref="listEl"
      class="flex-1 overflow-y-auto min-h-0 px-3 py-2 flex flex-col"
      @scroll="onListScroll"
      @click.self="focusComposer"
    >
      <UButton v-if="hasMore" :loading="loadingOlder" variant="ghost" size="xs" icon="i-lucide-arrow-up" class="self-center" @click="loadOlder" />
      <template v-for="g in grouped" :key="g.day">
        <div class="text-center my-2">
          <span class="tp-mono text-xs text-dimmed tp-panel px-2 py-1">{{ g.day }}</span>
        </div>
        <template v-for="m in g.items" :key="m.id">
          <div v-if="m.id === firstUnreadId" class="text-center my-2">
            <span class="tp-mono text-[10px] text-(--tp-accent) tp-panel px-2 py-1">{{ t('msg.unreadDivider') }}</span>
          </div>
          <div :id="`msg-${m.id}`" class="py-0.5 rounded-lg transition-colors duration-700" :class="m.id === highlightId ? 'bg-(--tp-accent)/15' : ''">
            <MessageBubble
              :msg="m"
              :name="contacts.displayName(m.direction === 'out' ? identity.pk : m.from)"
              :reply="replyPreview(m.replyTo)"
              :transfer="transferOf(m)"
              @reply="replyTo = m"
              @copy="copy(m)"
              @delete="chats.removeMessage(chatId, m.id)"
              @retry="retry(m)"
              @jump="jumpToReply(m.replyTo)"
              @open-image="(src: string) => (lightboxSrc = src)"
              @download="onDownload(m)"
              @cancel-file="onCancelFile(m)"
            />
          </div>
        </template>
      </template>
      <div v-if="typing" class="tp-mono text-xs text-(--tp-accent) ps-2">{{ t('chats.typing') }}</div>
    </div>

    <div class="relative shrink-0">
      <UButton
        v-if="newMessageCount"
        class="absolute -top-11 end-3 shadow"
        size="xs"
        color="primary"
        icon="i-lucide-arrow-down"
        :label="String(newMessageCount)"
        @click="scrollToBottom(true)"
      />
      <div v-if="friend" class="p-2 border-t border-(--tp-border) flex flex-col gap-1">
        <!-- reply bar: sender + excerpt + cancel -->
        <div v-if="replyTo" class="flex items-center gap-2 text-xs tp-panel p-1.5">
          <UIcon name="i-lucide-reply" />
          <span class="tp-mono text-[10px] text-(--tp-accent) shrink-0">{{ replyBarName }}</span>
          <span class="truncate flex-1">{{ replyBarExcerpt }}</span>
          <UButton icon="i-lucide-x" size="xs" variant="ghost" :aria-label="t('common.cancel')" @click="replyTo = null" />
        </div>
        <div v-if="contacts.blockedPks.has(chatId)" class="text-center text-xs text-error tp-mono py-2">{{ t('chats.blockedNotice') }}</div>
        <div v-else class="flex items-end gap-1">
          <UButton
            icon="i-lucide-paperclip"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :title="canSendFiles ? t('files.attach') : t('files.bothOnlineRequired')"
            :aria-label="t('files.attach')"
            @click="pickFiles"
          />
          <!-- voice recording: replaces the composer while active -->
          <div v-if="recording" class="flex items-center gap-2 flex-1 min-w-0 tp-panel px-2 py-1.5">
            <span class="size-2 rounded-full bg-error animate-pulse shrink-0" aria-hidden="true" />
            <span class="tp-mono text-xs shrink-0">{{ recClock(recSeconds) }}</span>
            <span class="flex-1 min-w-0 text-xs text-dimmed truncate">{{ t('msg.recording') }}</span>
            <UButton icon="i-lucide-trash-2" size="xs" variant="ghost" color="error" :aria-label="t('common.delete')" @click="cancelVoice" />
            <UButton icon="i-lucide-send" size="xs" color="primary" :aria-label="t('common.send')" @click="stopVoice" />
          </div>
          <form v-else ref="composerEl" class="flex items-end gap-2 flex-1 min-w-0" @submit.prevent="send">
            <UTextarea
              v-model="input"
              :placeholder="t('msg.placeholder')"
              autoresize
              :rows="1"
              :maxrows="6"
              class="flex-1 min-w-0"
              :maxlength="8000"
              :dir="inputDir"
              @keydown.enter.exact.prevent="send"
              @keydown="onComposerKeydown"
              @paste="onPaste"
            />
            <!-- mic: never disabled — voice is live-only, so the CLICK explains
                 that the other person has to be online right now -->
            <UButton
              v-if="!input.trim()"
              icon="i-lucide-mic"
              variant="ghost"
              size="sm"
              class="shrink-0"
              :title="canSendFiles ? t('msg.voice') : t('files.bothOnlineRequired')"
              :aria-label="t('msg.voice')"
              @click="startVoice"
            />
            <!-- RTL: the paper plane is MIRRORED (not rotated) — rotating a diagonal
                 glyph 180° would point it down-left instead of up-left -->
            <UButton v-if="input.trim()" type="submit" icon="i-lucide-send" :disabled="busy" :loading="busy" aria-label="send" class="rtl:-scale-x-100" />
          </form>
        </div>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onFilePick">
      </div>
    </div>

    <!-- staged files preview + caption -->
    <UModal v-model:open="stageOpen" :title="t('files.previewTitle')">
      <template #body>
        <div class="flex flex-col gap-2">
          <div v-for="s in staged" :key="s.file.name + s.file.size" class="tp-panel p-2 flex items-center gap-3">
            <img v-if="s.preview" :src="s.preview" :alt="s.file.name" class="size-14 rounded object-cover">
            <UIcon v-else :name="s.file.type.startsWith('video/') ? 'i-lucide-film' : 'i-lucide-file'" class="text-2xl" />
            <div class="min-w-0 flex-1">
              <p class="text-sm truncate">{{ s.file.name }}</p>
              <p class="tp-mono text-[10px] text-dimmed">{{ fmt.digits(`${(s.file.size / (1024 * 1024)).toFixed(2)} MB`) }}</p>
            </div>
            <UButton icon="i-lucide-x" size="xs" variant="ghost" :aria-label="t('common.delete')" @click="staged = staged.filter((x) => x !== s)" />
          </div>
          <p class="text-[10px] text-dimmed tp-mono">{{ t('files.maxHint') }}</p>
          <UTextarea v-model="stageCaption" :placeholder="t('msg.placeholder')" autoresize :rows="1" :maxrows="4" />
          <p v-if="staged.some((s) => s.file.type.startsWith('image/'))" class="text-[10px] text-dimmed">{{ t('files.reencodeNote') }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton :label="t('common.send')" color="primary" class="flex-1" :loading="sendingFiles" @click="sendStaged(false)" />
          <UButton
            v-if="staged.length === 1 && staged[0]?.file.type.startsWith('image/')"
            :label="t('files.sendOriginal')"
            variant="soft"
            :title="t('files.originalNote')"
            @click="sendStaged(true)"
          />
          <UButton :label="t('common.cancel')" variant="ghost" @click="stageOpen = false" />
        </div>
      </template>
    </UModal>

    <Lightbox v-if="lightboxSrc" :items="[{ src: lightboxSrc }]" :index="0" @close="lightboxSrc = null" />

    <USlideover v-model:open="contactOpen" :title="contacts.displayName(chatId)">
      <template #body>
        <ContactActions
          :chat-id="chatId"
          @close="contactOpen = false"
          @export-text="exportChat(false)"
          @export-json="exportChat(true)"
          @delete-chat="deleteChat"
          @clear-history="clearHistory"
        />
      </template>
    </USlideover>

    <UModal v-model:open="timerOpen" :title="t('chats.disappearingTitle')">
      <template #body>
        <p class="text-xs text-dimmed mb-2">{{ t('settings.relays.hint') }}</p>
        <div class="flex flex-col gap-1">
          <UButton
            v-for="o in DISAPPEARING_OPTIONS"
            :key="o.value"
            :label="o.label === 'off' ? t('chats.expireOff') : o.label"
            :variant="Number(friend?.expireAfter ?? 0) === o.value ? 'soft' : 'ghost'"
            :color="Number(friend?.expireAfter ?? 0) === o.value ? 'primary' : 'neutral'"
            class="justify-start"
            @click="onExpiry(o.value)"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
