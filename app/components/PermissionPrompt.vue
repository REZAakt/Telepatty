<script setup lang="ts">
/**
 * The ONE reusable permission prompt. Renders whenever some flow called
 * `usePermissionPrompt().suggest(name)` from a user gesture and the permission
 * is still undecided (or persistent storage is not granted yet). Dismissals
 * are remembered for days (see the composable) — no nagging.
 */
import { computed } from 'vue'
import { usePermissionPrompt } from '../composables/usePermissionPrompt'
import type { PermName } from '../composables/usePermissions'

const { t } = useI18n()
const prompt = usePermissionPrompt()

const COPY: Record<Exclude<PermName, 'clipboard'>, { icon: string; title: string; body: string }> = {
  camera: { icon: 'i-lucide-camera', title: 'prompt.cameraTitle', body: 'prompt.cameraBody' },
  notifications: { icon: 'i-lucide-bell', title: 'prompt.notifTitle', body: 'prompt.notifBody' },
  'persistent-storage': { icon: 'i-lucide-hard-drive', title: 'prompt.storageTitle', body: 'prompt.storageBody' },
}

const meta = computed(() => {
  const perm = prompt.state.perm
  return perm && perm !== 'clipboard' ? COPY[perm] : null
})
</script>

<template>
  <div
    v-if="prompt.state.open && meta"
    role="dialog"
    aria-live="polite"
    class="fixed inset-x-3 bottom-20 md:inset-x-auto md:end-4 md:bottom-4 z-40 max-w-sm tp-panel p-3 flex flex-col gap-2 shadow-lg"
  >
    <div class="flex items-start gap-2 min-w-0">
      <UIcon :name="meta.icon" class="text-xl text-primary shrink-0 mt-0.5" />
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ t(meta.title) }}</p>
        <p class="text-xs text-dimmed">{{ t(meta.body) }}</p>
      </div>
      <UButton icon="i-lucide-x" variant="ghost" size="xs" class="shrink-0" :aria-label="t('common.close')" @click="prompt.dismiss()" />
    </div>
    <div class="flex gap-2 justify-end">
      <UButton size="sm" variant="ghost" :label="t('prompt.notNow')" @click="prompt.dismiss()" />
      <UButton size="sm" color="primary" :label="t('prompt.enable')" @click="prompt.accept()" />
    </div>
  </div>
</template>
