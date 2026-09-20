<script setup lang="ts">
import type { ChatMessageRow } from '~~/core/db'

const props = defineProps<{ msg: ChatMessageRow; name?: string }>()
const emit = defineEmits<{ (e: 'reply'): void; (e: 'copy'): void; (e: 'delete'): void; (e: 'retry'): void }>()

const settings = useSettingsStore()
const { t } = useI18n()
const fmt = useFormat()

const mine = computed(() => props.msg.direction === 'out')

const items = computed(() => [
  [
    { icon: 'i-lucide-reply', label: t('msg.reply'), onSelect: () => emit('reply') },
    { icon: 'i-lucide-copy', label: t('msg.copyText'), onSelect: () => emit('copy') },
    { icon: 'i-lucide-trash-2', label: t('msg.deleteForMe'), onSelect: () => emit('delete') },
  ],
])
</script>

<template>
  <div class="group flex flex-col" :class="mine ? 'items-end' : 'items-start'">
    <div
      class="max-w-[85%] px-3 py-1.5 relative"
      :class="[
        settings.appearance.bubbleStyle === 'classic' ? 'tp-panel' : 'rounded-(--ui-radius) bg-elevated/50',
        mine ? 'border-(--tp-accent)/40 rounded-se-sm' : 'rounded-ss-sm',
      ]"
      dir="auto"
    >
      <p v-if="!mine && name" class="tp-mono text-[10px] text-(--tp-accent) mb-0.5">{{ name }}</p>
      <p class="whitespace-pre-wrap break-words text-(--tp-font-size)">{{ msg.body }}</p>
      <div class="flex items-center gap-1 justify-end mt-0.5">
        <span v-if="msg.expireAt" class="tp-mono text-[10px] text-dimmed" :title="t('msg.expireApplied')">
          <UIcon name="i-lucide-timer" class="size-3" />
        </span>
        <span class="tp-mono text-[10px] text-dimmed">{{ fmt.time(msg.ts) }}</span>
        <StatusTicks v-if="mine" :msg="msg" />
      </div>
      <div v-if="msg.state === 'failed'" class="flex justify-end mt-1">
        <UButton size="xs" color="error" variant="soft" :label="t('common.retry')" icon="i-lucide-refresh-cw" @click="$emit('retry')" />

      </div>
    </div>
    <div class="opacity-0 group-hover:opacity-100 transition-opacity">
      <UDropdownMenu :items="items">
        <UButton size="xs" variant="ghost" icon="i-lucide-more-horizontal" :aria-label="t('common.edit')" />
      </UDropdownMenu>

    </div>
  </div>
</template>
