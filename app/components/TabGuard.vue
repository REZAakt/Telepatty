<script setup lang="ts">
/**
 * Forced multi-tab guard overlay (requirement #10).
 *
 * When a SECOND tab of the same account opens, the Web Lock `telepatty-main`
 * is already held by the first tab (see `plugins/init.client.ts`), so this tab
 * gets `ui.isMainTab = false` and this full-screen overlay BLOCKS the whole
 * page underneath — no interaction, no read-only half-mode.
 *
 * Self-healing: the boot plugin polls the lock every few seconds. The moment
 * the other tab is closed (its lock is released automatically), this tab
 * acquires the lock, takes over as the main tab (starts the transports) and
 * this overlay disappears. Refreshing re-runs the same boot check, so a
 * refreshed tab is correctly blocked or unblocked.
 */
const { t } = useI18n()
const ui = useUiStore()
const panel = ref<HTMLElement | null>(null)

// keyboard hard-block: nothing underneath can be reached while we are open
function onKey(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  panel.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 select-none cursor-not-allowed"
    style="background: color-mix(in srgb, var(--tp-bg) 92%, transparent); backdrop-filter: blur(6px)"
    role="alertdialog"
    aria-modal="true"
    :aria-label="t('tabs.blockTitle')"
    @pointerdown.stop.prevent
    @click.stop.prevent
    @wheel.stop.prevent
  >
    <div
      ref="panel"
      class="tp-panel p-6 flex flex-col items-center gap-3 max-w-sm text-center outline-none"
      tabindex="-1"
    >
      <UIcon name="i-lucide-monitor" class="text-3xl text-(--tp-accent)" />
      <p class="font-semibold">{{ t('tabs.blockTitle') }}</p>
      <p class="text-xs text-dimmed">{{ t('tabs.blockBody') }}</p>
      <p class="tp-mono text-[10px] text-dimmed inline-flex items-center gap-1">
        <UIcon name="i-lucide-loader-circle" class="animate-spin size-3" />
        {{ t('tabs.checking') }}
      </p>
    </div>
  </div>
</template>
