<script setup lang="ts">
/** Permissions Center rows: live state, explanation, gesture-gated action. */
const { t } = useI18n()
const toast = useToast()
const perms = usePermissions()

const notifDenied = computed(() => perms.states.value.notifications === 'denied')
const storagePersisted = computed(() => perms.states.value['persistent-storage'] === 'granted')

const enableNotif = async () => {
  const res = await perms.requestNotifications()
  if (res === 'granted') toast.add({ title: t('permissions.notifications'), color: 'success' })
}

const enableCamera = async () => {
  const res = await perms.requestCamera()
  if (res === 'granted') toast.add({ title: t('permissions.camera'), color: 'success' })
}

const enableStorage = async () => {
  const res = await perms.requestPersistentStorage()
  if (res === 'granted') toast.add({ title: t('permissions.storagePersisted'), color: 'success' })
}

const checkAgain = () => void perms.refresh()

const stateLabel = (s: string) => t(`permissions.state.${s === 'default' ? 'default' : s}`)
const stateColor = (s: string) => (s === 'granted' ? 'success' : s === 'denied' ? 'error' : s === 'default' ? 'warning' : 'neutral')

const rows = computed(() => [
  { name: 'notifications' as const, icon: 'i-lucide-bell', why: t('permissions.notifWhy'), action: enableNotif, supported: perms.states.value.notifications !== 'unsupported' },
  { name: 'camera' as const, icon: 'i-lucide-camera', why: t('permissions.cameraWhy'), action: enableCamera, supported: perms.states.value.camera !== 'unsupported' },
  { name: 'persistent-storage' as const, icon: 'i-lucide-hard-drive', why: t('permissions.storageWhy'), action: enableStorage, supported: perms.states.value['persistent-storage'] !== 'unsupported' },
  { name: 'clipboard' as const, icon: 'i-lucide-clipboard', why: t('permissions.clipboardWhy'), action: async () => { try { await navigator.clipboard.writeText(' '); toast.add({ title: t('permissions.clipboard'), color: 'neutral' }) } catch { /* denied */ } }, supported: perms.states.value.clipboard !== 'unsupported' },
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
        <p class="text-sm font-medium">{{ t(`permissions.${row.name}`) }}</p>
        <p class="text-xs text-dimmed">{{ row.why }}</p>
      </div>
      <UBadge :color="stateColor(perms.states.value[row.name])" size="sm" variant="subtle">
        {{ stateLabel(perms.states.value[row.name]) }}
      </UBadge>
      <UButton v-if="row.supported && perms.states.value[row.name] !== 'granted'" size="sm" color="primary" variant="soft" :label="t('permissions.request')" @click="row.action" />
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

    <UAlert v-if="storagePersisted" color="success" variant="soft" icon="i-lucide-database" :description="t('permissions.storagePersisted')" />
  </div>
</template>
