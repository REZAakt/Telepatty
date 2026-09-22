<script setup lang="ts">
const { t } = useI18n()
const identity = useIdentityStore()

const sections = computed(() => [
  { key: 'appearance', icon: 'i-lucide-palette', show: true },
  { key: 'language', icon: 'i-lucide-languages', show: true },
  { key: 'privacy', icon: 'i-lucide-shield', show: true },
  { key: 'relays', icon: 'i-lucide-server', show: true },
  { key: 'connection', icon: 'i-lucide-network', show: true },
  { key: 'backup', icon: 'i-lucide-database-backup', show: true },
  { key: 'permissions', icon: 'i-lucide-key-round', show: true },
  { key: 'install', icon: 'i-lucide-download', show: true },
  { key: 'blocked', icon: 'i-lucide-ban', show: true },
  { key: 'about', icon: 'i-lucide-info', show: true },
  { key: 'danger', icon: 'i-lucide-alert-octagon', show: true },
])

/** iOS-style grouping: main preferences, data & app, then the danger zone. */
const groups = computed(() => [
  sections.value.slice(0, 3),
  sections.value.slice(3, 6),
  sections.value.slice(6, 9),
  sections.value.slice(9, 11),
])
</script>

<template>
  <div class="flex-1 overflow-y-auto overscroll-contain">
    <div class="max-w-2xl w-full mx-auto p-3 flex flex-col gap-4">
      <!-- profile header -->
      <div class="tp-panel p-4 flex items-center gap-3">
        <Avatar :pk="identity.pk" :name="identity.displayName" :size="56" />
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">{{ identity.displayName || 'Telepatty' }}</p>
          <p class="tp-mono text-xs text-dimmed truncate" dir="ltr">{{ identity.pk.slice(0, 24) }}…</p>
        </div>
      </div>

      <!-- grouped sections (iOS style rows) -->
      <div v-for="(group, gi) in groups" :key="gi" class="tp-panel overflow-hidden">
        <UButton
          v-for="s in group"
          :key="s.key"
          :to="`/settings/${s.key}`"
          variant="ghost"
          color="neutral"
          block
          class="rounded-none px-3 py-3 justify-start gap-3 border-b border-(--tp-border) last:border-b-0 hover:bg-elevated/40"
          :class="s.key === 'danger' ? 'text-error' : ''"
          :ui="{ leadingIcon: 'size-5 shrink-0', label: 'text-sm font-medium truncate', trailingIcon: 'size-4 shrink-0 text-dimmed rtl:rotate-180' }"
          :icon="s.icon"
          :label="t(`settings.sections.${s.key}`)"
          trailing-icon="i-lucide-chevron-right"
          trailing
        />
      </div>
    </div>
  </div>
</template>
