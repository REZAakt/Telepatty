import 'fake-indexeddb/auto'
import { TelepattyDb, type ChatMessageRow } from '../core/db'
import { importSeed } from '../core/chat-store'

const conversations = Number(process.env.TELEPATTY_SEED_CHATS ?? 50)
const perConversation = Number(process.env.TELEPATTY_SEED_MESSAGES_PER_CHAT ?? 1000)
const total = conversations * perConversation
const now = Date.now()
const db = new TelepattyDb(process.env.TELEPATTY_SEED_DB ?? 'telepatty')
const me = '0'.repeat(64)

function pk(n: number): string {
  return n.toString(16).padStart(64, '0').slice(-64)
}

function message(chat: string, c: number, i: number): ChatMessageRow {
  const direction = i % 3 === 0 ? 'in' : 'out'
  return {
    id: `seed-${c}-${i}`,
    chatId: chat,
    from: direction === 'in' ? chat : me,
    to: direction === 'in' ? me : chat,
    body: `Seed message ${i + 1} in conversation ${c + 1}`,
    ts: now - (total - (c * perConversation + i)) * 1000,
    lamport: i + 1,
    state: direction === 'in' && i % 7 === 0 ? 'delivered' : 'read',
    createdAt: now,
    attempts: 0,
    nextAttemptAt: 0,
    direction,
  }
}

await db.open()
await db.transaction('rw', db.messages, db.conversations, db.processedEvents, db.syncState, async () => {
  await db.messages.clear()
  await db.conversations.clear()
  await db.processedEvents.clear()
  await db.syncState.clear()
})

const chatIds = Array.from({ length: conversations }, (_, i) => pk(i + 1))
const messages: ChatMessageRow[] = []
for (let c = 0; c < conversations; c++) {
  for (let i = 0; i < perConversation; i++) messages.push(message(chatIds[c]!, c, i))
}

await importSeed(db, { chatIds, messages }, {
  chunk: 1000,
  onProgress(done, n) {
    if (done === n || done % 10_000 === 0) console.log(`seeded ${done}/${n}`)
  },
})
console.log(`Seeded ${conversations} conversations and ${messages.length} messages into IndexedDB "${db.name}".`)
db.close()
