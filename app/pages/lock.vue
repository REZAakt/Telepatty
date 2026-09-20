<script setup lang="ts">
const identity = useIdentityStore()
const router = useRouter()
const { t } = useI18n()

const pass = ref('')
const busy = ref(false)
const wrong = ref(false)

const ui = useUiStore()
const expired = ref(false)

onMounted(() => {
  expired.value = !!identity.sessionExpiresAt && identity.sessionExpiresAt < Date.now()
})

const unlock = async () => {
  if (!pass.value) return
  busy.value = true
  wrong.value = false
  try {
    const ok = await identity.unlock(pass.value)
    if (ok) {
      const { getMessenger, createMessenger } = await import('../services/messenger')
      if (!getMessenger()) await createMessenger().start()
      useTheme().apply()
      await router.replace(ui.pendingInvite ? '/add' : '/')
    } else {
      wrong.value = true
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="tp-panel p-6 max-w-sm w-full flex flex-col gap-4 text-center">
      <UIcon name="i-lucide-lock-keyhole" class="text-4xl text-(--tp-accent) self-center" />
      <h1 class="text-lg font-bold">{{ t('lock.title') }}</h1>
      <p class="text-xs text-dimmed">{{ expired ? t('lock.expired') : t('lock.hint') }}</p>
      <form class="flex flex-col gap-2" @submit.prevent="unlock">
        <UInput v-model="pass" type="password" :placeholder="t('onboarding.lockPass')" autofocus :disabled="busy" />
        <p v-if="wrong" class="text-xs text-error">{{ t('lock.wrong') }}</p>
        <UButton type="submit" :label="t('lock.unlock')" color="primary" block :loading="busy" :disabled="busy || !pass" />
      </form>
    </div>
  </div>
</template>
