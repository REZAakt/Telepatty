<script setup lang="ts">
import { THEME_PRESETS, ACCENT_OPTIONS } from '~~/core/theme'
import { exportBackup, parseBackup, importBackup } from '~~/core/backup'
import { nsecEncode, hexToBytes } from '~~/core/crypto'
import { getDb } from '~~/core/db'
import { rebuildConversationSummaries } from '~~/core/chat-store'

const route = useRoute()
const router = useRouter()
const identity = useIdentityStore()
const settings = useSettingsStore()
const contactsStore = useContactsStore()
const ui = useUiStore()
const { t, locale } = useI18n()
const appVersion = useRuntimeConfig().public.appVersion as string
const toast = useToast()


const install = useInstall()
const perms = usePermissions()
const theme = useTheme()


const section = computed(() => String(route.params.section ?? 'appearance'))

const colorNames = ['green', 'cyan', 'amber', 'indigo', 'violet', 'rose', 'blue', 'lime']
const neutralNames = ['zinc', 'slate', 'stone', 'gray', 'neutral']
const colorModes = ['dark', 'light', 'system'] as const
const PRESET_SWATCH: Record<string, string> = Object.fromEntries(THEME_PRESETS.map((p) => [p.id, p.accent]))
/** literal fills for the primary-color swatches (Tailwind 500 shades) */
const SWATCH_HEX: Record<string, string> = {
  green: '#22c55e',
  cyan: '#06b6d4',
  amber: '#f59e0b',
  indigo: '#6366f1',
  violet: '#a855f7',
  rose: '#f43f5e',
  blue: '#3b82f6',
  lime: '#84cc16',
}

// appearance
const primary = computed(() => settings.appearance.primary)
const accent = computed(() => settings.appearance.accent ?? '')
const setPrimary = (c: string) => theme.update({ primary: c })
const setNeutral = (c: string) => theme.update({ neutral: c })
const setAccent = (hex: string) => theme.update({ accent: hex || undefined })
const setMode = (m: string) => theme.update({ colorMode: m as 'dark' | 'light' | 'system' })
const swatchStyle = (hex: string) => ({ background: hex })

// language
const setLang = (code: 'en' | 'fa') => {
  settings.update({ language: code })
  locale.value = code
}



// privacy
const lockPass = ref('')
const lockCurrent = ref('')
const lockBusy = ref(false)
const setupLock = async () => {
  if (lockPass.value.length < 8) return
  lockBusy.value = true
  try {
    if (identity.hasLock) {
      const ok = await identity.unlock(lockCurrent.value)
      if (!ok) {
        toast.add({ title: t('lock.wrong'), color: 'error' })
        return
      }
    }
    await identity.setLock(lockPass.value)
    toast.add({ title: t('settings.privacy.appLockSetup'), color: 'success' })
    lockPass.value = ''
    lockCurrent.value = ''
  } finally {
    lockBusy.value = false
  }
}
const removeLock = async () => {
  const ok = await identity.unlock(lockCurrent.value)
  if (!ok) {
    toast.add({ title: t('lock.wrong'), color: 'error' })
    return
  }
  await identity.removeLock()
}

// relays
const newRelay = ref('')
const addRelay = () => {
  const url = newRelay.value.trim()
  if (!/^wss?:\/\/.+/.test(url) || settings.relays.includes(url)) return
  settings.update({ relays: [...settings.relays, url] })
  newRelay.value = ''
}
const removeRelay = (url: string) => {
  settings.update({ relays: settings.relays.filter((r) => r !== url) })
  void settings.probeRelays()
}
const healthOf = (url: string) => settings.health[url]
const probingAll = computed(() => settings.relays.some((r) => settings.probing[r]))

const statusLabel = (url: string): string => {
  if (settings.probing[url]) return t('settings.relays.testing')
  const h = healthOf(url)
  if (!h) return t('settings.relays.untested')
  if (h.ok) return t('settings.relays.connected') + (h.latency !== undefined ? ` · ${h.latency}ms` : '')
  const reason = h.reason === 'closed' && h.closeCode !== undefined
    ? t('settings.relays.reason.closed', { code: h.closeCode })
    : h.reason
      ? t(`settings.relays.reason.${h.reason}`)
      : ''
  return reason ? `${t('settings.relays.unreachable')} · ${reason}` : t('settings.relays.unreachable')
}

/** Turning message notifications ON is the natural moment to ask (once). */
const onNotifToggle = (v: boolean | undefined) => {
  settings.update({ notifMessages: Boolean(v) })
  if (v) void usePermissionPrompt().suggest('notifications')
}
const statusClass = (url: string): string => {
  if (settings.probing[url]) return 'text-warning'
  const h = healthOf(url)
  if (!h) return 'text-dimmed'
  return h.ok ? 'text-success' : 'text-error'
}
const statusIcon = (url: string): string => {
  if (settings.probing[url]) return 'i-lucide-loader-circle'
  const h = healthOf(url)
  if (!h) return 'i-lucide-circle-help'
  return h.ok ? 'i-lucide-wifi' : 'i-lucide-wifi-off'
}
const statusIconSpin = (url: string): Record<string, string> => (settings.probing[url] ? { animation: 'spin 1s linear infinite' } : {})


// backup
const backupPass = ref('')
const includeFiles = ref(false)
const importMode = ref<'merge' | 'replace'>('merge')
const importBusy = ref(false)
const storageInfo = ref<{ usage?: number; quota?: number; persisted?: boolean }>({})
const exportNow = async () => {
  if (backupPass.value.length < 8) {
    toast.add({ title: t('onboarding.lockTooShort'), color: 'error' })
    return
  }
  try {
    const file = await exportBackup(getDb(), backupPass.value, { includeFiles: includeFiles.value })
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `telepatty-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.add({ title: t('common.done'), color: 'success' })
  } catch (e) {
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  }
}
const importFile = ref<HTMLInputElement | null>(null)
const importPick = () => importFile.value?.click()
const importNow = async (ev: Event) => {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (backupPass.value.length < 8) {
    toast.add({ title: t('onboarding.lockTooShort'), color: 'error' })
    return
  }
  importBusy.value = true
  try {
    const text = await file.text()
    const res = await parseBackup(JSON.parse(text), backupPass.value)
    if (!res.ok) {
      toast.add({
        title: res.reason === 'bad-passphrase' ? t('settings.backup.wrongPass') : res.reason === 'newer-schema' ? t('settings.backup.newerSchema') : t('settings.backup.invalid'),
        color: 'error',
      })
      return
    }
    await importBackup(getDb(), res.data, importMode.value)
    toast.add({ title: t('settings.backup.success'), color: 'success' })
    await settings.load()
    await contactsReload()
  } catch {
    toast.add({ title: t('settings.backup.invalid'), color: 'error' })
  } finally {
    importBusy.value = false
  }
}
const contactsReload = async () => {
  const contacts = useContactsStore()
  const chats = useChatsStore()
  await contacts.load()
  await chats.load()
}

// storage
onMounted(async () => {
  if (section.value !== 'backup' && section.value !== 'permissions') return
  try {
    const est = await navigator.storage?.estimate?.()
    storageInfo.value = { usage: est?.usage, quota: est?.quota, persisted: await navigator.storage?.persisted?.() }
    void loadFilesInfo()
  } catch {
    /* ignore */
  }
  await perms.refresh()
})

// relays: probe after the settings store is hydrated (guarded — no double-run)
const relaysProbed = ref(false)
watch(
  [section, () => settings.loaded],
  ([sec, loaded]) => {
    if (sec === 'relays' && loaded && !relaysProbed.value) {
      relaysProbed.value = true
      void settings.probeRelays()
    }
  },
  { immediate: true },
)


const filesInfo = ref<{ count: number; bytes: number }>({ count: 0, bytes: 0 })
const filesBusy = ref(false)
const loadFilesInfo = async () => {
  const rows = await getDb().files.toArray()
  filesInfo.value = { count: rows.length, bytes: rows.reduce((n, f) => n + (f.size || 0), 0) }
}
const deleteAllFiles = async () => {
  if (!confirm(t('settings.files.deleteConfirm'))) return
  filesBusy.value = true
  try {
    await getDb().files.clear()
    filesInfo.value = { count: 0, bytes: 0 }
    toast.add({ title: t('settings.files.deleted'), color: 'success' })
  } finally {
    filesBusy.value = false
  }
}

const msgCount = ref(0)
const rebuildBusy = ref(false)
const rebuildProgress = ref('')
onMounted(async () => {
  msgCount.value = await getDb().messages.count()
})
const rebuildSummaries = async () => {
  rebuildBusy.value = true
  rebuildProgress.value = ''
  try {
    const result = await rebuildConversationSummaries(getDb(), {
      onProgress: (done) => {
        rebuildProgress.value = String(done)
      },
    })
    msgCount.value = await getDb().messages.count()
    toast.add({ title: t('settings.storageUsage.rebuildDone', { n: result.conversations }), color: 'success' })
  } catch (e) {
    toast.add({ title: t('errors.generic', { e: String(e) }), color: 'error' })
  } finally {
    rebuildBusy.value = false
  }
}

const fmtBytes = (n?: number) => (n === undefined ? '—' : `${(n / 1_048_576).toFixed(1)} MB`)

// danger
const wipe = async () => {
  if (!confirm(t('settings.danger.deleteAllConfirm'))) return
  await identity.wipe()
  location.reload()
}

// install
const iosOpen = ref(false)
const doInstall = async () => {
  if (install.isIOS.value) {
    iosOpen.value = true
    return
  }
  await install.promptInstall()
}

const nsec = computed(() => (identity.skHex ? nsecEncode(hexToBytes(identity.skHex)) : ''))
const showNsec = ref(false)

const goBack = () => void router.replace('/settings')

const copyTheme = async () => {
  await navigator.clipboard?.writeText(theme.exportTheme()).catch(() => {})
  toast.add({ title: t('common.copied'), color: 'neutral' })
}

const importThemePrompt = () => {
  const json = prompt(t('settings.appearance.import'))
  if (json && !theme.importTheme(json)) toast.add({ title: t('settings.appearance.importInvalid'), color: 'error' })
}
</script>

<template>
  <div class="flex-1 overflow-y-auto overscroll-contain">
    <div class="max-w-2xl w-full mx-auto p-3 flex flex-col gap-4">
      <div class="flex items-center gap-2 sticky top-0 z-10 bg-(--tp-bg) py-1 -my-1">
        <UButton icon="i-lucide-arrow-left" variant="ghost" size="sm" :aria-label="t('nav.back')" class="rtl:rotate-180" @click="goBack" />
        <h1 class="text-lg font-bold truncate">{{ t(`settings.sections.${section}`) }}</h1>
      </div>

    <!-- APPEARANCE -->
    <div v-if="section === 'appearance'" class="flex flex-col gap-4">
      <div class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0 text-sm">{{ t('settings.appearance.colorMode') }}</div>
          <USelect
            :model-value="settings.appearance.colorMode"
            :items="colorModes.map((m) => ({ label: t(`settings.appearance.${m}`), value: m }))"
            class="w-36 max-w-[55%]"
            size="sm"
            @update:model-value="setMode(String($event))"
          />
        </div>
        <USwitch :model-value="settings.appearance.texture" :label="t('settings.appearance.texture')" class="px-3 py-2.5 justify-between" @update:model-value="theme.update({ texture: $event })" />
        <USwitch :model-value="settings.appearance.reducedMotion" :label="t('settings.appearance.reducedMotion')" class="px-3 py-2.5 justify-between" @update:model-value="theme.update({ reducedMotion: $event })" />
      </div>

      <div class="tp-panel p-3 flex flex-col gap-4">
        <div class="flex flex-col gap-2 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.appearance.presets') }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="p in theme.presets"
              :key="p.id"
              size="sm"
              :variant="settings.appearance.presetId === p.id ? 'soft' : 'outline'"
              :color="settings.appearance.presetId === p.id ? 'primary' : 'neutral'"
              :label="p.label"
              @click="theme.applyPreset(p.id)"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.appearance.primary') }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="c in colorNames"
              :key="c"
              class="size-7 rounded-full border-2 transition-transform"
              :class="primary === c ? 'border-(--tp-accent) scale-110' : 'border-(--tp-border)'"
              :style="swatchStyle(SWATCH_HEX[c] ?? 'transparent')"
              :aria-label="c"
              @click="setPrimary(c)"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.appearance.neutral') }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton v-for="c in neutralNames" :key="c" size="xs" :variant="settings.appearance.neutral === c ? 'soft' : 'ghost'" :label="c" @click="setNeutral(c)" />
          </div>
        </div>

        <div class="flex flex-col gap-2 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.appearance.accent') }}</p>
          <p class="text-xs text-dimmed">{{ t('settings.appearance.accentHint') }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="o in ACCENT_OPTIONS"
              :key="o.value"
              class="size-7 rounded-full border-2 transition-transform"
              :class="accent === o.value ? 'border-(--tp-accent) scale-110' : 'border-(--tp-border)'"
              :style="swatchStyle(o.value || PRESET_SWATCH[settings.appearance.presetId] || 'var(--ui-primary)')"
              :aria-label="o.value ? o.label : t('settings.appearance.accentDefault')"
              :title="o.value ? o.label : t('settings.appearance.accentDefault')"
              @click="setAccent(o.value)"
            />
          </div>
        </div>
      </div>

      <div class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
        <div class="px-3 py-3 flex flex-col gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex-1 min-w-0 text-sm">{{ t('settings.appearance.radius') }}</div>
            <span class="tp-mono text-xs text-dimmed shrink-0" dir="ltr">{{ settings.appearance.radius }}</span>
          </div>
          <input type="range" min="0" max="1.5" step="0.125" :value="settings.appearance.radius" class="w-full accent-(--tp-accent)" @input="theme.update({ radius: Number(($event.target as HTMLInputElement).value) })">
        </div>
        <div class="px-3 py-3 flex flex-col gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex-1 min-w-0 text-sm">{{ t('settings.appearance.fontSize') }}</div>
            <span class="tp-mono text-xs text-dimmed shrink-0" dir="ltr">{{ settings.appearance.fontSize }}px</span>
          </div>
          <input type="range" min="13" max="18" step="1" :value="settings.appearance.fontSize" class="w-full accent-(--tp-accent)" @input="theme.update({ fontSize: Number(($event.target as HTMLInputElement).value) })">
        </div>
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0 text-sm">{{ t('settings.appearance.density') }}</div>
          <USelect
            :model-value="settings.appearance.density"
            :items="[{ label: t('settings.appearance.compact'), value: 'compact' }, { label: t('settings.appearance.comfortable'), value: 'comfortable' }]"
            class="w-36 max-w-[55%]"
            size="sm"
            @update:model-value="theme.update({ density: $event as 'compact' | 'comfortable' })"
          />
        </div>
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0 text-sm">{{ t('settings.appearance.bubbleStyle') }}</div>
          <USelect
            :model-value="settings.appearance.bubbleStyle"
            :items="[{ label: t('settings.appearance.classic'), value: 'classic' }, { label: t('settings.appearance.flat'), value: 'flat' }]"
            class="w-36 max-w-[55%]"
            size="sm"
            @update:model-value="theme.update({ bubbleStyle: $event as 'classic' | 'flat' })"
          />
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton :label="t('settings.appearance.reset')" variant="soft" icon="i-lucide-rotate-ccw" size="sm" @click="theme.reset()" />
        <UButton :label="t('settings.appearance.export')" variant="ghost" icon="i-lucide-download" size="sm" @click="copyTheme" />
        <UButton :label="t('settings.appearance.import')" variant="ghost" icon="i-lucide-upload" size="sm" @click="importThemePrompt" />
      </div>
    </div>

    <!-- LANGUAGE -->
    <div v-else-if="section === 'language'" class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
      <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
        <div class="flex-1 min-w-0 text-sm">{{ t('settings.language.title') }}</div>
        <USelect
          :model-value="settings.language"
          :items="[{ label: t('settings.language.en'), value: 'en' }, { label: t('settings.language.fa'), value: 'fa' }]"
          class="w-36 max-w-[55%]"
          size="sm"
          @update:model-value="setLang($event as 'en' | 'fa')"
        />
      </div>
      <div class="px-3 py-2.5 flex items-center gap-3 min-w-0 flex-wrap">
        <div class="flex-1 min-w-full sm:min-w-0 text-sm">{{ t('settings.language.calendar') }}</div>
        <URadioGroup
          :model-value="settings.jalali ? 'jalali' : 'gregorian'"
          :items="[
            { label: t('settings.language.jalali'), value: 'jalali' },
            { label: t('settings.language.gregorian'), value: 'gregorian' },
          ]"
          orientation="horizontal"
          size="sm"
          @update:model-value="settings.update({ jalali: $event === 'jalali' })"
        />
      </div>
      <div class="px-3 py-2.5 flex items-center gap-3 min-w-0 flex-wrap">
        <div class="flex-1 min-w-full sm:min-w-0 text-sm">{{ t('settings.language.digits') }}</div>
        <URadioGroup
          :model-value="settings.persianDigits ? 'persian' : 'latin'"
          :items="[
            { label: t('settings.language.persianDigits'), value: 'persian' },
            { label: t('settings.language.latinDigits'), value: 'latin' },
          ]"
          orientation="horizontal"
          size="sm"
          @update:model-value="settings.update({ persianDigits: $event === 'persian' })"
        />
      </div>
    </div>

    <!-- PRIVACY -->
    <div v-else-if="section === 'privacy'" class="flex flex-col gap-4">
      <div class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm">{{ t('settings.privacy.readReceipts') }}</p>
            <p class="text-xs text-dimmed">{{ t('settings.privacy.readReceiptsHint') }}</p>
          </div>
          <USwitch :model-value="settings.readReceipts" class="shrink-0" @update:model-value="settings.update({ readReceipts: $event })" />
        </div>
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm">{{ t('settings.privacy.retentionTitle') }}</p>
            <p class="text-xs text-dimmed">{{ t('settings.privacy.retentionNote') }}</p>
          </div>
        </div>
        <div class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <div class="flex-1 min-w-0">
            <p class="text-sm">{{ t('settings.privacy.session') }}</p>
            <p class="text-xs text-dimmed">{{ t('settings.privacy.sessionHint') }}</p>
          </div>
        </div>
      </div>

      <div class="tp-panel p-3 flex flex-col gap-2">
        <p class="font-medium text-sm">{{ t('settings.privacy.appLock') }}</p>
        <p class="text-xs text-dimmed">{{ identity.hasLock ? t('settings.privacy.appLockChange') : t('settings.privacy.appLockSetup') }}</p>
        <UInput v-if="identity.hasLock" v-model="lockCurrent" type="password" :placeholder="t('settings.privacy.currentPass')" class="w-full" />
        <UInput v-model="lockPass" type="password" :placeholder="t('onboarding.lockPass')" class="w-full" />
        <div class="flex flex-wrap gap-2">
          <UButton :label="t('common.save')" color="primary" size="sm" :loading="lockBusy" :disabled="lockPass.length < 8" @click="setupLock" />
          <UButton v-if="identity.hasLock" :label="t('settings.privacy.appLockRemove')" variant="ghost" color="error" size="sm" @click="removeLock" />
        </div>
      </div>

      <div class="tp-panel p-3 flex flex-col gap-2">
        <p class="font-medium text-sm">{{ t('onboarding.backupTitle') }}</p>
        <p class="text-xs text-dimmed">{{ t('onboarding.backupWarn') }}</p>
        <USwitch v-model="showNsec" :label="t('onboarding.restorePaste')" class="justify-between" />
        <p v-if="showNsec" class="tp-mono text-xs break-all tp-panel p-2" dir="ltr">{{ nsec }}</p>
      </div>
    </div>

    <!-- RELAYS -->
    <div v-else-if="section === 'relays'" class="flex flex-col gap-3">
      <UAlert color="neutral" variant="soft" icon="i-lucide-server" :description="t('settings.relays.hint')" />
      <div class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
        <div v-for="url in settings.relays" :key="url" class="px-3 py-2.5 flex items-center gap-2 min-w-0">
          <UIcon :name="statusIcon(url)" :class="[statusClass(url), settings.probing[url] ? 'animate-spin' : '']" class="shrink-0" />
          <span class="tp-mono text-xs flex-1 min-w-0 truncate" dir="ltr">{{ url }}</span>
          <span class="tp-mono text-[10px] whitespace-nowrap hidden sm:inline" :class="statusClass(url)">{{ statusLabel(url) }}</span>
          <UButton icon="i-lucide-refresh-cw" size="xs" variant="ghost" :loading="!!settings.probing[url]" :aria-label="t('settings.relays.testAgain')" @click="() => void settings.probeRelay(url)" />
          <UButton icon="i-lucide-x" size="xs" variant="ghost" :aria-label="t('settings.relays.remove')" @click="removeRelay(url)" />
        </div>
        <div v-if="!settings.relays.length" class="px-3 py-6 text-center text-sm text-dimmed">{{ t('settings.relays.add') }}</div>
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <UInput v-model="newRelay" :placeholder="t('settings.relays.add')" class="flex-1 w-full" dir="ltr" @keydown.enter="addRelay" />
        <UButton :label="t('common.save')" class="shrink-0" @click="addRelay" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton :label="t('settings.relays.testAgain')" icon="i-lucide-refresh-cw" variant="soft" size="sm" :loading="probingAll" @click="() => void settings.probeRelays(true)" />
        <UButton :label="t('settings.relays.resetDefault')" icon="i-lucide-rotate-ccw" variant="soft" size="sm" :disabled="probingAll" @click="settings.resetRelays()" />
      </div>
      <div class="tp-panel overflow-hidden">
        <USwitch :model-value="settings.requireMinRelays" :label="t('settings.relays.minHint')" class="px-3 py-2.5 justify-between" @update:model-value="settings.update({ requireMinRelays: $event })" />
      </div>
    </div>

    <!-- CONNECTION -->
    <div v-else-if="section === 'connection'" class="flex flex-col gap-3">
      <div class="tp-panel p-3">
        <p class="text-sm font-medium mb-1">{{ t('settings.connection.ice') }}</p>
        <p class="text-xs text-dimmed mb-2">{{ t('settings.connection.iceHint') }}</p>
        <UTextarea v-model="settings.iceServersText" :rows="3" class="w-full font-mono" dir="ltr" @blur="settings.persist()" />
      </div>
    </div>

    <!-- BACKUP -->
    <div v-else-if="section === 'backup'" class="flex flex-col gap-3">
      <UAlert color="warning" variant="soft" icon="i-lucide-triangle-alert" :description="t('settings.backup.warn')" />
      <div class="tp-panel p-3 flex flex-col gap-2">
        <UInput v-model="backupPass" type="password" :placeholder="t('settings.backup.pass')" class="w-full" v-autofocus-desktop />
        <USwitch v-model="includeFiles" :label="t('settings.backup.includeFiles')" :description="t('settings.backup.includeFilesHint')" />
        <div class="flex flex-wrap gap-2">
          <UButton :label="t('settings.backup.export')" color="primary" icon="i-lucide-download" size="sm" @click="exportNow" />
          <UButton :label="t('settings.backup.import')" variant="soft" icon="i-lucide-upload" size="sm" :loading="importBusy" @click="importPick" />
          <input ref="importFile" type="file" accept="application/json" class="hidden" @change="importNow">
        </div>
        <div class="flex items-center gap-3 min-w-0 pt-1">
          <div class="flex-1 min-w-0 text-sm">{{ t('settings.backup.importMode') }}</div>
          <USelect v-model="importMode" :items="[{ label: t('settings.backup.merge'), value: 'merge' }, { label: t('settings.backup.replace'), value: 'replace' }]" class="w-36 max-w-[55%]" size="sm" />
        </div>
      </div>
      <div class="tp-panel p-3 tp-mono text-xs text-dimmed flex flex-col gap-1">
        <p>{{ t('settings.storageUsage.used', { used: fmtBytes(storageInfo.usage), quota: fmtBytes(storageInfo.quota) }) }}</p>
        <p>{{ t('settings.storageUsage.messages', { n: msgCount }) }}</p>
        <p>{{ t('settings.files.usage', { n: filesInfo.count, size: fmtBytes(filesInfo.bytes || undefined) }) }}</p>
      </div>
      <div class="tp-panel overflow-hidden">
        <USwitch :model-value="settings.autoDownloadImages" :label="t('settings.files.autoDownload')" class="px-3 py-2.5 justify-between" @update:model-value="settings.update({ autoDownloadImages: $event })" />
      </div>
      <div class="tp-panel p-3 flex items-center gap-3 min-w-0">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.files.title') }}</p>
          <p class="text-xs text-dimmed">{{ t('settings.files.deleteHint') }}</p>
        </div>
        <UButton size="sm" color="error" variant="soft" icon="i-lucide-trash-2" :label="t('settings.files.delete')" :loading="filesBusy" :disabled="!filesInfo.count" @click="deleteAllFiles" />
      </div>
      <div class="tp-panel p-3 flex items-center gap-3 min-w-0">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">{{ t('settings.storageUsage.rebuild') }}</p>
          <p class="text-xs text-dimmed">{{ rebuildProgress ? t('settings.storageUsage.rebuildProgress', { n: rebuildProgress }) : t('settings.storageUsage.rebuildHint') }}</p>
        </div>
        <UButton size="sm" icon="i-lucide-database-backup" :label="t('common.check')" :loading="rebuildBusy" @click="rebuildSummaries" />
      </div>
    </div>

    <!-- PERMISSIONS -->
    <div v-else-if="section === 'permissions'" class="flex flex-col gap-3">
      <PermissionsCenter />
      <div class="tp-panel overflow-hidden">
        <USwitch
          :model-value="settings.notifMessages"
          :label="t('permissions.messageNotifications')"
          class="px-3 py-2.5 justify-between"
          @update:model-value="onNotifToggle"
        />
        <USwitch :model-value="settings.notifHideContent" :label="t('permissions.hideContent')" class="px-3 py-2.5 justify-between border-t border-(--tp-border)" @update:model-value="settings.update({ notifHideContent: $event })" />
      </div>
      <UAlert color="neutral" variant="soft" icon="i-lucide-bell-off" :description="t('permissions.noPush')" />
    </div>

    <!-- INSTALL -->
    <div v-else-if="section === 'install'" class="flex flex-col gap-3">
      <div class="tp-panel p-3 flex items-center gap-3 min-w-0">
        <UIcon name="i-lucide-download" class="text-xl shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="truncate">{{ install.installed.value ? t('install.stateInstalled') : install.supported.value ? t('install.stateAvailable') : t('install.stateUnsupported') }}</p>
          <p class="text-xs text-dimmed">{{ install.isIOS.value ? t('install.iosNote') : t('install.desktopNote') }}</p>
        </div>
        <UButton v-if="!install.installed.value && install.supported.value" :label="t('common.install')" color="primary" size="sm" class="shrink-0" @click="doInstall" />
      </div>
      <!-- PWA update: only once the service worker reports a waiting build -->
      <div v-if="ui.updateReady" class="tp-panel p-3 flex items-center gap-3 min-w-0 border-(--tp-accent)/50">
        <UIcon name="i-lucide-refresh-cw" class="text-xl shrink-0 text-(--tp-accent)" />
        <div class="flex-1 min-w-0">
          <p class="truncate">{{ t('notifications.updateReady') }}</p>
          <p class="text-xs text-dimmed">{{ t('notifications.updateBody') }}</p>
        </div>
        <UButton :label="t('update.now')" color="primary" size="sm" class="shrink-0" @click="void install.applyUpdate()" />
      </div>
      <UModal v-model:open="iosOpen" :title="t('install.iosTitle')">
        <template #body>
          <ol class="flex flex-col gap-2 text-sm">
            <li class="tp-panel p-2">1. {{ t('install.iosStep1') }}</li>
            <li class="tp-panel p-2">2. {{ t('install.iosStep2') }}</li>
            <li class="tp-panel p-2">3. {{ t('install.iosStep3') }}</li>
          </ol>
        </template>
      </UModal>
    </div>

    <!-- BLOCKED -->
    <div v-else-if="section === 'blocked'" class="flex flex-col gap-2">
      <div class="tp-panel overflow-hidden divide-y divide-(--tp-border)">
        <div v-if="!contactsStore.blocks.length" class="text-center text-sm text-dimmed py-10">{{ t('settings.blocked.empty') }}</div>
        <div v-for="b in contactsStore.blocks" :key="b.pk" class="px-3 py-2.5 flex items-center gap-3 min-w-0">
          <Avatar :pk="b.pk" :size="36" />
          <span class="tp-mono text-xs flex-1 min-w-0 truncate" dir="ltr">{{ b.pk.slice(0, 20) }}…</span>
          <UButton size="xs" :label="t('chats.unblock')" variant="soft" class="shrink-0" @click="contactsStore.unblock(b.pk)" />
        </div>
      </div>
    </div>

    <!-- ABOUT -->
    <div v-else-if="section === 'about'" class="flex flex-col gap-3">
      <div class="tp-panel p-3 tp-mono text-xs flex flex-col gap-1">
        <p>{{ t('settings.about.version') }}: <span dir="ltr">{{ appVersion }}</span></p>
      </div>
      <a
        href="https://rezaakbarpour.ir"
        target="_blank"
        rel="noopener"
        class="tp-panel p-3 flex items-center gap-3 group"
      >
        <UIcon name="i-lucide-globe" class="text-xl text-(--tp-accent) shrink-0" />
        <span class="flex-1 min-w-0">
          <span class="block text-sm">{{ t('settings.about.site') }}</span>
          <span class="block text-xs text-dimmed" dir="ltr">rezaakbarpour.ir</span>
        </span>
        <UIcon name="i-lucide-external-link" class="text-dimmed group-hover:text-(--tp-accent) transition-colors rtl:-scale-x-100" />
      </a>
    </div>

    <!-- DANGER -->
    <div v-else-if="section === 'danger'" class="flex flex-col gap-3">
      <UAlert color="error" variant="soft" icon="i-lucide-alert-octagon" :description="t('settings.danger.deleteAllConfirm')" />
      <UButton :label="t('settings.danger.deleteAll')" color="error" block icon="i-lucide-trash-2" @click="wipe" />
    </div>
    </div>
  </div>
</template>

