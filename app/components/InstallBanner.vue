<script setup lang="ts">
const { t } = useI18n()
const install = useInstall()

const open = ref(true)

const doInstall = async () => {
  await install.promptInstall()
  open.value = false
}
const later = () => {
  install.dismiss()
  open.value = false
}
</script>

<template>
  <div v-if="open" class="fixed inset-x-3 bottom-16 md:hidden z-40 tp-panel p-3 flex items-center gap-3 shadow-lg">
    <UIcon name="i-lucide-download" class="text-primary text-xl shrink-0" />
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-sm">{{ t('install.bannerTitle') }}</p>
      <p class="text-xs text-dimmed truncate">{{ t('install.bannerBody') }}</p>
    </div>
    <UButton size="sm" color="primary" :label="t('install.cta')" @click="doInstall" />
    <UButton size="sm" variant="ghost" color="neutral" :label="t('install.later')" @click="later" />
  </div>
</template>
