<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * Full-screen image lightbox. Closes on Esc / click-outside / close button;
 * keyboard accessible (focus lands on the close button, focus order stays sane).
 */
const { t } = useI18n()
const props = defineProps<{ src: string; alt?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const closeBtn = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  closeBtn.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div
    class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="alt ?? 'image'"
    @click.self="emit('close')"
  >
    <UButton
      ref="closeBtn"
      icon="i-lucide-x"
      color="neutral"
      variant="soft"
      class="absolute top-3 end-3"
      :aria-label="t('common.close')"
      @click="emit('close')"
    />
    <img :src="src" :alt="alt ?? ''" class="max-h-full max-w-full object-contain rounded-md">
  </div>
</template>
