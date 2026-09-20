import { v7 as uuidV7 } from 'uuid'

/** Globally unique, time-ordered message id (UUID v7). */
export function newId(): string {
  return uuidV7()
}
