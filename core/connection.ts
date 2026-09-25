import type { TransportStatus } from './router'

/**
 * The header chip's whole vocabulary — there are exactly three things the user
 * is ever told about the connection, and each state is also the suffix of its
 * i18n key (`chats.online` / `chats.connecting` / `chats.offline`).
 */
export type ConnectionState = 'online' | 'connecting' | 'offline'

/** i18n key the chip renders for a state. */
export const CONNECTION_LABEL_KEY: Record<ConnectionState, string> = {
  online: 'chats.online',
  connecting: 'chats.connecting',
  offline: 'chats.offline',
}

/** Nuxt UI badge colour for a state. */
export const CONNECTION_BADGE_COLOR: Record<ConnectionState, 'success' | 'warning' | 'neutral'> = {
  online: 'success',
  connecting: 'warning',
  offline: 'neutral',
}

/**
 * The ONE decision behind the header chip.
 *
 * The browser's own verdict wins (`navigator.onLine === false` is offline
 * whatever the sockets think — a phone in a tunnel is not "connecting", it has
 * no network at all), then the transport's: a live relay socket means online,
 * and an attempt that is still in flight means **connecting** — never
 * "offline". "Offline" is reserved for a transport that has really given up,
 * which is why the cold start used to read as a broken app: `transportStatus`
 * stays `disconnected` until the first relay socket is up, and that first
 * second now says «در حال اتصال» instead of claiming to be offline.
 */
export function connectionState(browserOnline: boolean, transport: TransportStatus): ConnectionState {
  if (!browserOnline) return 'offline'
  if (transport === 'connected') return 'online'
  if (transport === 'connecting') return 'connecting'
  return 'offline'
}
