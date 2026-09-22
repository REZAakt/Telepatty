<script setup lang="ts">
import { en, fa_ir } from '@nuxt/ui/locale'

const { t } = useI18n()
const ui = useUiStore()
const install = useInstall()
const toast = useToast()
const { attach } = useInviteHash()
const { dir } = useHtmlDir()

// Nuxt UI internals (popovers, toasts, selects) follow this locale — including
// its `dir` — so they mirror together with the app.
const uiLocale = computed(() => (dir.value === 'rtl' ? fa_ir : en))
const toastPosition = computed(() => (dir.value === 'rtl' ? 'top-left' : 'top-right'))

onMounted(() => {
  attach()
})

useHead(() => ({ title: t('app.name') }))

watch(
  () => ui.updateReady,
  (ready) => {
    if (!ready) return
    // a system alert (distinct from the message in/out tones)
    void useSounds().playAlert()
    toast.add({
      title: t('update.banner'),
      description: t('notifications.updateBody'),
      color: 'primary',
      actions: [
        // single update path: useInstall holds the updater UpdateWatcher registered
        { label: t('update.now'), onClick: () => void install.applyUpdate() },
        { label: t('update.dismiss'), onClick: () => void 0 },
      ],
    })
  },
)
</script>


<template>
  <UApp :locale="uiLocale" :toaster="{ position: toastPosition }">
    <NuxtLoadingIndicator color="var(--tp-accent)" :height="2" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
