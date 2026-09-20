import type { FileRow } from '~~/core/db'
import { getDb } from '~~/core/db'

/**
 * Object URL for a stored file blob. Created lazily, revoked on change/unmount
 * (blob URLs leak if not revoked). Returns null while loading / when missing.
 */
export function useFileUrl(fileId: () => string | undefined) {
  const url = ref<string | null>(null)
  const mime = ref('')
  const size = ref(0)
  const name = ref('')

  watch(
    fileId,
    async (id) => {
      if (url.value) {
        URL.revokeObjectURL(url.value)
        url.value = null
      }
      if (!id) return
      try {
        const row: FileRow | undefined = await getDb().files.get(id)
        if (row && row.blob) {
          url.value = URL.createObjectURL(row.blob)
          mime.value = row.mime
          size.value = row.size
          name.value = row.name
        }
      } catch {
        url.value = null
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (url.value) URL.revokeObjectURL(url.value)
  })

  return { url, mime, size, name }
}
