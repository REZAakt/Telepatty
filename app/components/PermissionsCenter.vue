<script setup lang="ts">
/**
 * Permissions Center rows: live state, explanation, gesture-gated action.
 * Every row shows the REAL state (see usePermissions) and — for storage — the
 * actual usage/quota. A "not granted" storage never nags: the browser decides.
 */
const { t } = useI18n()
const toast = useToast()
const perms = usePermissions()

const notifDenied = computed(() => perms.states.value.notifications === 'denied')
const cameraDenied = computed(() => perms.states.value.camera === 'denied')
const storageState = computed(() => perms.states.value['persistent-storage'])
const storagePersisted = computed(() => storageState.value === 'granted')
const storageNotGranted = computed(() => storageState.value === 'not-granted')

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
const usageText = computed(() => {
  const u = perms.usage.value
  if (!u || !u.quota) return ''
  return t('permissions.usage', { used: bytes(u.usage), quota: bytes(u.quota) })
})

const enableNotif = async () => {
  const res = await perms.requestNotifications()
  if (res === 'granted') toast.add({ title: t('permissions.notifications'), color: 'success' })
}

const enableCamera = async () => {
  const res = await perms.requestCamera()
  if (res === 'granted') toast.add({ title: t('permissions.camera'), color: 'success' })
}

const enableStorage = async () => {
  // Real feedback for BOTH outcomes — the browser decides, silence helps nobody.
  const res = await perms.requestPersistentStorage()
  if (res === 'granted') toast.add({ title: t('permissions.storagePersisted'), color: 'success' })
  else if (res === 'not-granted') toast.add({ description: t('permissions.storageNotGranted'), color: 'neutral' })
}

const checkAgain = () => void perms.refresh()

const stateLabel = (s: string) => t(`permissions.state.${s === 'not-granted' ? 'notGranted' : s}`)
const stateColor = (s: string) =>
  s === 'granted' ? 'success' : s === 'denied' ? 'error' : s === 'default' || s === 'not-granted' ? 'warning' : s === 'insecure' ? 'warning' : 'neutral'

/** explicit label keys — no dynamic `permissions.${name}` lookup that can miss */
const rows = computed(() => [
  { name: 'notifications' as const, labelKey: 'permissions.notifications', icon: 'i-lucide-bell', why: t('permissions.notifWhy'), action: enableNotif, supported: perms.states.value.notifications !== 'unsupported' },
  { name: 'camera' as const, labelKey: 'permissions.camera', icon: 'i-lucide-camera', why: t('permissions.cameraWhy'), action: enableCamera, supported: perms.states.value.camera !== 'unsupported' },
  { name: 'persistent-storage' as const, labelKey: 'permissions.storage', icon: 'i-lucide-hard-drive', why: t('permissions.storageWhy'), action: enableStorage, supported: storageState.value !== 'unsupported' },
  {
    name: 'clipboard' as const,
    labelKey: 'permissions.clipboard',
    icon: 'i-lucide-clipboard',
    why: t('permissions.clipboardWhy'),
    action: async () => {
      try {
        await navigator.clipboard.writeText(' ')
        toast.add({ title: t('permissions.clipboard'), color: 'neutral' })
      } catch {
        /* denied — the badge already says so */
      }
    },
    supported: perms.states.value.clipboard !== 'unsupported',
  },
])

onMounted(() => {
  void perms.refresh().then(() => perms.watchAll())
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-for="row in rows" :key="row.name" class="tp-panel p-3 flex items-center gap-3">
      <UIcon :name="row.icon" class="text-xl shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium">{{ t(row.labelKey) }}</p>
        <p class="text-xs text-dimmed">{{ row.why }}</p>
      </div>
      <UBadge :color="stateColor(perms.states.value[row.name])" size="sm" variant="subtle">
        {{ stateLabel(perms.states.value[row.name]) }}
      </UBadge>
      <UButton v-if="row.supported && perms.canRequest(row.name)" size="sm" color="primary" variant="soft" :label="t('permissions.request')" @click="row.action" />
    </div>

    <!-- storage usage (navigator.storage.estimate) -->
    <div v-if="usageText" class="tp-panel p-3 flex items-center gap-3">
      <UIcon name="i-lucide-database" class="text-xl shrink-0" />
      <div class="min-w-0">
        <p class="text-xs">{{ usageText }}</p>
        <p class="text-[10px] text-dimmed">{{ t('permissions.storageWhy') }}</p>
      </div>
    </div>

    <!-- denied guidance: browsers cannot re-prompt from JS -->
    <UAlert v-if="notifDenied" color="error" variant="soft" icon="i-lucide-shield-x" :title="t('permissions.deniedTitle')">
      <template #description>
        <div class="flex flex-col gap-1 text-xs">
          <p>{{ t('permissions.deniedHow') }}</p>
          <p>{{ t('permissions.deniedHowAndroid') }}</p>
          <p>{{ t('permissions.deniedHowIos') }}</p>
        </div>
      </template>
      <template #actions>
        <UButton size="sm" variant="soft" :label="t('common.check')" @click="checkAgain" />
      </template>
    </UAlert>

    <UAlert v-if="cameraDenied" color="error" variant="soft" icon="i-lucide-shield-x" :title="t('permissions.camera')">
      <template #description>
        <p class="text-xs">{{ t('permissions.cameraDeniedHow') }}</p>
      </template>
      <template #actions>
        <UButton size="sm" variant="soft" :label="t('common.check')" @click="checkAgain" />
      </template>
    </UAlert>

    <!-- persistent storage: explain the browser-decided state, never nag -->
    <UAlert v-if="storageNotGranted" color="warning" variant="soft" icon="i-lucide-hard-drive" :description="t('permissions.storageNotGranted')">
      <template #actions>
        <UButton size="sm" variant="soft" :label="t('permissions.request')" @click="enableStorage" />
      </template>
    </UAlert>

    <UAlert v-if="storagePersisted" color="success" variant="soft" icon="i-lucide-database" :description="t('permissions.storagePersisted')" />
  </div>
</template>
