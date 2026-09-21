<script setup lang="ts">
/**
 * Mobile install banner. iOS Safari cannot be prompted programmatically
 * (no beforeinstallprompt), so there the CTA opens a localized
 * "Share → Add to Home Screen" instruction sheet. Dismissal is remembered
 * (snooze + strike count in localStorage); never shown when already installed
 * / running standalone.
 */
const { t } = useI18n()
const install = useInstall()

const open = computed(() => install.shouldShowBanner.value)
const iosOpen = ref(false)

const doInstall = async () => {
  if (install.isIOS.value) {
    // iOS: no programmatic prompt — show the manual Add-to-Home-Screen steps
    iosOpen.value = true
    return
  }
  await install.promptInstall()
  install.dismiss()
}
const later = () => {
  install.dismiss()
}
</script>

<template>
  <div v-if="open" class="fixed inset-x-3 bottom-16 md:hidden z-40 tp-panel p-3 flex items-center gap-3 shadow-lg">
    <UIcon name="i-lucide-download" class="text-primary text-xl shrink-0" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-sm">{{ t('install.bannerTitle') }}</p>
      <p class="text-xs text-dimmed truncate">{{ install.isIOS.value ? t('install.bannerBodyIos') : t('install.bannerBody') }}</p>
    </div>
    <UButton size="sm" color="primary" :label="t('install.cta')" @click="doInstall" />
    <UButton size="sm" variant="ghost" color="neutral" :label="t('install.later')" @click="later" />
  </div>

  <!-- iOS manual install steps (same localized sheet as Settings → Install) -->
  <UModal v-model:open="iosOpen" :title="t('install.iosTitle')">
    <template #body>
      <ol class="flex flex-col gap-2 text-sm">
        <li class="tp-panel p-2">1. {{ t('install.iosStep1') }}</li>
        <li class="tp-panel p-2">2. {{ t('install.iosStep2') }}</li>
        <li class="tp-panel p-2">3. {{ t('install.iosStep3') }}</li>
      </ol>
    </template>
  </UModal>
</template>
