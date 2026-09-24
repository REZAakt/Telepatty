import type { FileRow } from '~~/core/db'
import { getDb } from '~~/core/db'
import { onBus } from '~~/core/bus'
import { looksLikeImage } from '~~/core/files'

/**
 * Object URL (+ mime/size/name and the content-sniff verdict) for a stored file
 * blob. Created lazily, revoked on change/unmount (blob URLs leak if not
 * revoked). Returns null while loading / when missing.
 *
 * A bubble can legitimately be announced BEFORE its bytes are written (the
 * transfer pipeline stores the message row and the blob row separately), and the
 * lookup only ever ran when `fileId` CHANGED — so the single attempt happened too
 * early and the bubble stayed empty until a full reload (the sender's own
 * attachment was the visible symptom). The lookup is therefore also re-run on the
 * `file-stored` bus event, which makes the order irrelevant.
 */
export function useFileUrl(fileId: () => string | undefined) {
  const url = ref<string | null>(null)
  const mime = ref('')
  const size = ref(0)
  const name = ref('')
  /** content-sniff verdict of the stored bytes (an "image" may be anything) */
  const isImage = ref(false)

  async function resolve(id: string | undefined): Promise<void> {
    if (url.value) URL.revokeObjectURL(url.value)
    url.value = null
    mime.value = ''
    size.value = 0
    name.value = ''
    isImage.value = false
    if (!id) return
    try {
      const row: FileRow | undefined = await getDb().files.get(id)
      if (!row?.blob) return
      url.value = URL.createObjectURL(row.blob)
      mime.value = row.mime
      size.value = row.size
      name.value = row.name
      const head = new Uint8Array(await row.blob.slice(0, 16).arrayBuffer())
      isImage.value = looksLikeImage(head, row.mime)
    } catch {
      url.value = null
    }
  }

  watch(fileId, (id) => void resolve(id), { immediate: true })

  const offStored = onBus('file-stored', (p) => {
    if (p.fileId === fileId()) void resolve(p.fileId)
  })

  onBeforeUnmount(() => {
    offStored()
    if (url.value) URL.revokeObjectURL(url.value)
  })

  return { url, mime, size, name, isImage }
}
