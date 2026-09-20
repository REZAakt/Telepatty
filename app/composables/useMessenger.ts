import { getMessenger, createMessenger, type Messenger } from '../services/messenger'

export { getMessenger, createMessenger }
export type { Messenger }

/** Access the singleton messenger service (null before first start). */
export function useMessenger(): Messenger | null {
  return getMessenger()
}
