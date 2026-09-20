/**
 * Optional encrypted-blob-server path (e.g. Blossom-compatible servers).
 *
 * OFF BY DEFAULT and feature-flagged (`BLOB_STORE_ENABLED = false`): the
 * current Blossom spec has NOT been verified against this codebase yet, so no
 * adapter ships — only the interface, so a future implementation cannot drift
 * from the message pipeline (see DECISIONS.md for the honest-claims policy).
 *
 * Design contract for any future adapter:
 * - The CLIENT encrypts the file with a random AES-GCM key; the server only
 *   ever stores ciphertext.
 * - The descriptor (`url` + sha256 + key material) travels INSIDE the normal
 *   E2EE envelope, so relay operators never see it.
 * - What the blob server CAN still see: your IP, upload/download timing and
 *   the ciphertext size. Retention and size limits are the server operator's
 *   policy — never assume permanence.
 * - Same hard 5 MB per-file cap applies.
 */
export const BLOB_STORE_ENABLED = false

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  mime: string
  name: string
  /** base64 AES-GCM key + iv for the ciphertext (client-generated) */
  key: string
  iv: string
}

export interface BlobStore {
  /** Upload ciphertext; resolve with a resolvable descriptor. */
  put(ciphertext: Blob, meta: { name: string; mime: string; sha256: string }): Promise<BlobDescriptor>
  /** Fetch ciphertext by descriptor; caller decrypts with the envelope's key. */
  get(desc: BlobDescriptor): Promise<Blob>
  /** Best-effort delete (server may refuse; retention is its policy). */
  remove(desc: Pick<BlobDescriptor, 'url' | 'sha256'>): Promise<boolean>
}
