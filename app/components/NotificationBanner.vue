<script setup lang="ts">
const { t } = useI18n()
const perms = usePermissions()

const show = ref(false)

onMounted(async () => {
  await perms.refresh()
  show.value = perms.states.value.notifications === 'default' && !perms.notifSnoozed()
})

const enable = async () => {
  await perms.requestNotifications()
  show.value = false
}
const notNow = () => {
  perms.snoozeNotif()
  show.value = false
}
</script>

<template>
  <div v-if="show" class="fixed inset-x-3 top-16 z-40 tp-panel p-3 flex items-center gap-3 shadow-lg max-w-md mx-auto">
    <UIcon name="i-lucide-bell" class="text-primary text-xl shrink-0" />
    <p class="flex-1 text-xs">{{ t('permissions.banner') }}</p>
    <UButton size="sm" color="primary" :label="t('common.yes')" @click="enable" />
    <UButton size="sm" variant="ghost" color="neutral" :label="t('permissions.notNow')" @click="notNow" />
  </div>
</template>
