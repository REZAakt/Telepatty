<script setup lang="ts">
const { t } = useI18n()
const head = useLocaleHead()
const ui = useUiStore()
const toast = useToast()
const { attach } = useInviteHash()

useHead(() => ({
  htmlAttrs: { lang: head.value.htmlAttrs?.lang ?? 'en', dir: head.value.htmlAttrs?.dir ?? 'ltr' },
  title: t('app.name'),
}))

onMounted(() => {
  attach()
})

watch(
  () => ui.updateReady,
  (ready) => {
    if (!ready) return
    toast.add({
      title: t('update.banner'),
      description: t('notifications.updateBody'),
      color: 'primary',
      actions: [
        { label: t('update.now'), onClick: () => window.dispatchEvent(new CustomEvent('tp:sw-update')) },
        { label: t('update.dismiss'), onClick: () => void 0 },
      ],
    })
  },
)
</script>


<template>
  <UApp :toaster="{ position: 'top-right' }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

