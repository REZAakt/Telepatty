<script setup lang="ts">
/**
 * Install guide. iOS Safari cannot be prompted programmatically (no
 * `beforeinstallprompt`), so there the guide walks through Share → Add to Home
 * Screen; Chromium/Android gets the same guide plus a real "Install now" button
 * that fires the captured prompt. It opens BY ITSELF on a phone that has not
 * installed the app yet (the reported «اول باید صفحهٔ نصب رو نمایش بده»), and
 * collapses to a compact chip if the user closes it — dismissal is remembered
 * (snooze + strike count in localStorage), and it never shows once installed.
 */
const { t } = useI18n()
const install = useInstall()
const appIcon = useAppIcon()

/** the layout only mounts this while the guide is applicable */
const open = computed(() => install.shouldShowBanner.value)
const guideOpen = ref(false)

const platformLabel = computed(() =>
  install.isIOS.value ? t('install.iosTitle') : install.isAndroid.value ? t('install.androidTitle') : t('install.otherTitle'),
)

/** Platform-specific, plain-language steps — one list per phone family. */
const steps = computed(() => {
  if (install.isIOS.value) return [t('install.iosStep1'), t('install.iosStep2'), t('install.iosStep3')]
  if (install.isAndroid.value) return [t('install.androidStep1'), t('install.androidStep2'), t('install.androidStep3')]
  return [t('install.otherStep1'), t('install.otherStep2')]
})

const installNow = async () => {
  const outcome = await install.promptInstall()
  // nothing to prompt (iOS/Firefox): the steps above ARE the install path
  if (outcome !== 'unsupported') install.dismiss()
  guideOpen.value = false
}
const later = () => {
  install.dismiss()
  guideOpen.value = false
}

// open the guide the moment it becomes applicable (a phone without the app)
watch(open, (v) => { if (v) guideOpen.value = true }, { immediate: true })
</script>

<template>
  <!-- compact re-open chip: the guide was closed but is still applicable -->
  <div v-if="open && !guideOpen" class="fixed inset-x-3 bottom-16 md:hidden z-40">
    <UButton
      block
      icon="i-lucide-download"
      color="primary"
      :label="t('install.reopen')"
      @click="guideOpen = true"
    />
  </div>

  <UModal v-model:open="guideOpen" :title="t('install.guideTitle')">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <img :src="appIcon" alt="" class="size-11 rounded-xl shrink-0" />
          <div class="min-w-0">
            <p class="font-bold leading-tight">Telepatty</p>
            <p class="text-xs text-dimmed truncate">{{ platformLabel }}</p>
          </div>
        </div>

        <p class="text-sm">{{ t('install.guideIntro') }}</p>

        <div class="flex flex-col gap-2">
          <div v-for="(step, i) in steps" :key="i" class="tp-panel p-3 flex items-start gap-3">
            <span
              class="shrink-0 size-6 rounded-full grid place-items-center text-xs font-bold bg-(--tp-accent)/15 text-(--tp-accent)"
            >{{ i + 1 }}</span>
            <p class="text-sm leading-snug">{{ step }}</p>
          </div>
        </div>

        <UAlert
          v-if="install.isIOS.value"
          color="neutral"
          variant="soft"
          icon="i-lucide-info"
          :description="t('install.iosNote')"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton
          v-if="install.canPrompt.value"
          :label="t('install.cta')"
          icon="i-lucide-download"
          color="primary"
          class="flex-1 justify-center"
          @click="installNow"
        />
        <UButton
          :label="t('install.later')"
          variant="ghost"
          color="neutral"
          :class="install.canPrompt.value ? '' : 'flex-1 justify-center'"
          @click="later"
        />
      </div>
    </template>
  </UModal>
</template>
