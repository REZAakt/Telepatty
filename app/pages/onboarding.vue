<script setup lang="ts">
import { nsecEncode, decodeKey, hexToBytes } from '~~/core/crypto'
import { getDb } from '~~/core/db'

const identity = useIdentityStore()
const install = useInstall()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()

type Step = 'identity' | 'name' | 'backup' | 'privacy'
const step = ref<Step>('identity')
const name = ref('')
const phone = ref('')
const nsecShown = ref('')
const backupChecked = ref(false)
const wantLock = ref(false)
const pass = ref('')
const pass2 = ref('')
const busy = ref(false)
const restoreMode = ref(false)
const restoreNsec = ref('')

const isIOS = computed(() => install.isIOS.value)

const create = async () => {
  busy.value = true
  try {
    const lockPass = wantLock.value && pass.value ? pass.value : undefined
    if (restoreMode.value) {
      if (!decodeKey(restoreNsec.value)) {
        toast.add({ title: t('onboarding.restoreInvalid'), color: 'error' })
        return
      }
      const ok = await identity.restore(restoreNsec.value, name.value, lockPass)
      if (!ok) {
        toast.add({ title: t('onboarding.restoreInvalid'), color: 'error' })
        return
      }
      nsecShown.value = restoreNsec.value
    } else {
      await identity.create(name.value, phone.value, lockPass)
      nsecShown.value = nsecEncode(hexToBytes(identity.skHex))
    }

    step.value = 'backup'
  } finally {
    busy.value = false
  }
}

const passValid = computed(() => !wantLock.value || (pass.value.length >= 8 && pass.value === pass2.value))

const finish = async () => {
  const pending = await getDb().settings.get('pendingInvite')
  await getDb().settings.delete('pendingInvite')
  useTheme().apply()
  await router.replace('/')
  if (pending) {
    const v = pending.value as { pk: string }
    void router.push(`/add?k=${v.pk}`)
  }
  // request persistent storage after the first successful setup step
  const perms = usePermissions()
  void perms.requestPersistentStorage()
}

const lockErr = computed(() =>
  wantLock.value ? (pass.value.length < 8 && pass.value ? t('onboarding.lockTooShort') : pass.value && pass.value !== pass2.value ? t('onboarding.lockMismatch') : '') : '',
)

const copyNsec = async () => {
  await navigator.clipboard?.writeText(nsecShown.value).catch(() => {})
  toast.add({ title: t('common.copied'), color: 'neutral' })
}
</script>


<template>
  <div class="flex-1 overflow-y-auto p-4 flex justify-center">
    <div class="max-w-md w-full flex flex-col gap-4 py-6">
      <div class="flex items-center gap-2">
        <span class="tp-accent-text text-xl font-mono font-bold">▮▮</span>
        <h1 class="text-lg font-bold">Telepatty</h1>
      </div>

      <!-- STEP: identity -->
      <template v-if="step === 'identity'">
        <h2 class="text-xl font-bold">{{ t('onboarding.welcome') }}</h2>
        <p class="text-sm text-dimmed">{{ t('onboarding.intro') }}</p>

        <UAlert v-if="isIOS" color="warning" variant="soft" icon="i-lucide-info" :description="t('onboarding.iosStorage')" />

        <div class="flex gap-2">
          <UButton :label="t('onboarding.create')" color="primary" @click="step = 'name'" />
          <UButton :label="t('onboarding.restore')" variant="soft" @click="restoreMode = true; step = 'name'" />
        </div>
      </template>

      <!-- STEP: name (+ optional lock) -->
      <template v-else-if="step === 'name'">
        <h2 class="text-lg font-bold">{{ t('onboarding.nameLabel') }}</h2>
        <div class="flex flex-col gap-3">
          <UFormField :label="t('onboarding.nameLabel')" :hint="t('common.optional')">
            <UInput v-model="name" maxlength="64" class="w-full" v-autofocus-desktop />
          </UFormField>
          <UFormField v-if="!restoreMode" :label="t('onboarding.phoneLabel')" :description="t('onboarding.phoneHint')">
            <UInput v-model="phone" maxlength="32" class="w-full" />
          </UFormField>
          <UFormField v-else :label="t('onboarding.restorePaste')">
            <UTextarea v-model="restoreNsec" :rows="2" class="w-full font-mono" />

          </UFormField>

          <USwitch v-model="wantLock" :label="t('onboarding.lockTitle')" :description="t('onboarding.lockHint')" />
          <template v-if="wantLock">
            <UInput v-model="pass" type="password" :placeholder="t('onboarding.lockPass')" />
            <UInput v-model="pass2" type="password" :placeholder="t('onboarding.lockPassConfirm')" />
            <p v-if="lockErr" class="text-xs text-error">{{ lockErr }}</p>
          </template>

          <UButton
            :label="restoreMode ? t('onboarding.restore') : t('onboarding.create')"
            color="primary"
            block
            :loading="busy"
            :disabled="busy || (restoreMode && !restoreNsec.trim()) || !passValid"
            @click="create"
          />
          <UButton :label="t('common.back')" variant="ghost" block @click="step = 'identity'" />
        </div>
      </template>

      <!-- STEP: backup -->
      <template v-else-if="step === 'backup'">
        <h2 class="text-lg font-bold">{{ t('onboarding.backupTitle') }}</h2>
        <UAlert color="error" variant="soft" icon="i-lucide-triangle-alert" :description="t('onboarding.backupWarn')" />
        <div class="tp-panel p-3">
          <p class="tp-mono text-xs break-all select-all" dir="ltr">{{ nsecShown }}</p>
        </div>
        <UButton icon="i-lucide-copy" :label="t('common.copy')" variant="soft" class="self-start" @click="copyNsec" />

        <USwitch v-model="backupChecked" :label="t('onboarding.backupDone')" />
        <UButton :label="t('common.done')" color="primary" block :disabled="!backupChecked" @click="step = 'privacy'" />
      </template>

      <!-- STEP: privacy -->
      <template v-else>
        <h2 class="text-lg font-bold">{{ t('onboarding.privacyTitle') }}</h2>
        <UAlert color="neutral" variant="soft" icon="i-lucide-eye" :description="t('onboarding.privacyBody')" />
        <UButton :label="t('onboarding.finish')" color="primary" block @click="finish" />
      </template>
    </div>
  </div>
</template>

