<script setup lang="ts">
import type { ChatMessageRow } from '~~/core/db'

const props = defineProps<{ msg: Pick<ChatMessageRow, 'state' | 'direction'> }>()
const { t } = useI18n()

const title = computed(() => t(`msg.${props.msg.state}`))
</script>

<template>
  <span class="tp-mono inline-flex items-center" :title="title" :aria-label="title">
    <UIcon v-if="msg.state === 'pending'" name="i-lucide-clock" class="size-3.5 opacity-60" />
    <UIcon v-else-if="msg.state === 'sent'" name="i-lucide-check" class="size-3.5 opacity-70" />
    <UIcon v-else-if="msg.state === 'delivered'" name="i-lucide-check-check" class="size-3.5 opacity-70" />
    <UIcon v-else-if="msg.state === 'read'" name="i-lucide-check-check" class="size-3.5 text-(--tp-accent)" />
    <UIcon v-else-if="msg.state === 'failed'" name="i-lucide-alert-circle" class="size-3.5 text-error" />
  </span>
</template>
