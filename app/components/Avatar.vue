<script setup lang="ts">
import { computed } from 'vue'

/** Deterministic identicon from a public key: 5×5 mirrored neon blocks. */
const props = defineProps<{ pk: string; name?: string; size?: number }>()


const cells = computed(() => {
  const pk = props.pk || '00'
  const out: boolean[][] = []
  let h = 0
  for (let i = 0; i < 15; i++) {
    h = (h * 31 + parseInt(pk[i % pk.length] ?? '0', 16)) | 0
  }
  for (let r = 0; r < 5; r++) {
    const row: boolean[] = []
    for (let c = 0; c < 3; c++) {
      h = (h * 1103515245 + 12345) | 0
      row.push(((h >>> 16) & 1) === 1)
    }
    out.push([...row, !!row[1], !!row[0]])
  }

  return out
})

const hue = computed(() => {
  const pk = props.pk || '00'
  return parseInt(pk.slice(0, 4), 16) % 360
})
</script>

<template>
  <div
    class="shrink-0 rounded-(--ui-radius) overflow-hidden border border-(--tp-border) grid grid-cols-5 grid-rows-5 bg-(--tp-panel)"
    :style="{ width: `${size ?? 40}px`, height: `${size ?? 40}px` }"
    role="img"
    :aria-label="name ?? 'avatar'"
  >
    <div
      v-for="(row, r) in cells"
      :key="r"
      class="contents"
    >
      <div
        v-for="(on, c) in row"
        :key="`${r}-${c}`"
        class="w-full h-full"
        :style="on ? { background: `hsl(${hue} 80% 45%)` } : {}"
      />
    </div>
  </div>
</template>
