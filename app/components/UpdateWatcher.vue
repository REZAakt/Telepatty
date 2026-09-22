<script setup lang="ts">
/** Registers the service worker with prompt (never auto-reload while typing).
 *  Skipped in dev (`nuxt dev` runs without a service worker by design). */
const needRefresh = ref(false)
const offlineReady = ref(false)
let updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null

onMounted(async () => {
  if (!import.meta.client || import.meta.dev || !('serviceWorker' in navigator)) return

  try {
    const { registerSW } = await import('virtual:pwa-register')
    updateFn = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        needRefresh.value = true
        useUiStore().updateReady = true
        // hand the updater to the shared composable state so Settings → Install
        // (and the app-level toast) apply the very same update
        useInstall().registerUpdate(updateFn)
      },
      onOfflineReady: () => {
        offlineReady.value = true
      },
    }) ?? null
  } catch {
    /* dev without SW */
  }
})

</script>

<template>
  <span v-if="false" />
</template>
