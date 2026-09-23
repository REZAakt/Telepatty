<script setup lang="ts">
const ui = useUiStore()
const identity = useIdentityStore()
const chats = useChatsStore()
const { t } = useI18n()
const install = useInstall()
const appVersion = useRuntimeConfig().public.appVersion as string
const appIcon = useAppIcon()

// Telegram-like sidebar: toggle + drag-resize, remembered across sessions
const sidebarOpen = useLocalStorage('tp.sidebarOpen', true)
const sidebarWidth = useLocalStorage('tp.sidebarWidth', 256)
const resizing = ref(false)

const onResizeStart = (e: PointerEvent) => {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  const rtl = document.documentElement.dir === 'rtl'
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    sidebarWidth.value = Math.min(440, Math.max(200, Math.round(startWidth + (rtl ? -dx : dx))))
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// Header chip: ONLY "online" / "offline". HOW the transport is carried (direct
// vs relay, queueing) is an implementation detail the user never asked for.
// Online = the browser has a network AND the relay socket is up.
const connOnline = computed(() => ui.online && ui.transportStatus === 'connected')
const connLabel = computed(() => (connOnline.value ? t('chats.online') : t('chats.offline')))
const connColor = computed(() =>
  connOnline.value ? 'success' : ui.transportStatus === 'connecting' ? 'warning' : 'neutral',
)

const nav = [
  { to: '/', icon: 'i-lucide-message-square', label: 'nav.chats' },
  { to: '/rooznameh', icon: 'i-lucide-newspaper', label: 'nav.rooznameh' },
  { to: '/friends', icon: 'i-lucide-users', label: 'nav.friends' },
  { to: '/settings', icon: 'i-lucide-settings', label: 'nav.settings' },
]

// on phones an open chat owns the whole screen: the bottom nav would sit on top of
// the composer, so it slides away (Telegram does the same)
const route = useRoute()
const inChat = computed(() => route.path.startsWith('/chat/'))

</script>

<template>
  <div class="h-dvh overflow-hidden flex flex-col" :class="{ 'tp-resizing': resizing }">
    <!-- header -->
    <header class="sticky top-0 z-30 tp-panel border-x-0 border-t-0 rounded-none flex items-center gap-2 px-3 h-13 shrink-0">
      <UButton
        :icon="sidebarOpen ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
        variant="ghost"
        size="sm"
        class="hidden md:inline-flex rtl:rotate-180"
        :aria-label="t('common.menu')"
        @click="sidebarOpen = !sidebarOpen"
      />
      <NuxtLink to="/" class="flex items-center gap-2 font-bold tracking-wide" aria-label="Telepatty">
        <img :src="appIcon" alt="" width="24" height="24" class="size-6 shrink-0">
        <span>Telepatty</span>
      </NuxtLink>
      <UBadge :color="connColor" variant="subtle" size="sm" class="tp-mono">
        {{ connLabel }}
      </UBadge>
      <div class="flex-1" />
      <UBadge v-if="chats.totalUnread" color="error" size="sm">{{ chats.totalUnread }}</UBadge>
      <UButton
        v-if="identity.hasLock && !identity.locked"
        icon="i-lucide-lock"
        variant="ghost"
        size="sm"
        :aria-label="t('lock.title')"
        @click="identity.lockNow()"
      />
      <NuxtLink to="/settings"><UButton icon="i-lucide-settings" variant="ghost" size="sm" :aria-label="t('nav.settings')" /></NuxtLink>
    </header>

    <div class="flex flex-1 min-h-0">
      <!-- desktop sidebar (collapsible + drag-resizable like Telegram) -->
      <nav
        v-show="sidebarOpen"
        class="hidden md:flex shrink-0 relative flex-col gap-1 p-3 border-e border-(--tp-border)"
        :style="{ width: `${sidebarWidth}px` }"
        aria-label="main"
      >
        <UButton
          v-for="n in nav"
          :key="n.to"
          :to="n.to"
          :icon="n.icon"
          :label="t(n.label)"
          :variant="$route.path === n.to ? 'soft' : 'ghost'"
          :color="$route.path === n.to ? 'primary' : 'neutral'"
          class="justify-start"
          block
        />
        <div class="flex-1" />
        <div class="tp-mono text-[10px] text-dimmed px-2">{{ appVersion }}</div>
        <!-- drag handle -->
        <div
          class="absolute top-0 bottom-0 end-0 w-1.5 cursor-col-resize touch-none hover:bg-(--tp-accent)/20 transition-colors"
          :aria-label="t('common.resize')"
          @pointerdown="onResizeStart"
        />
      </nav>

      <main class="flex-1 min-w-0 flex flex-col min-h-0">
        <slot />
      </main>
    </div>

    <!-- mobile bottom nav -->
    <nav v-if="!inChat" class="md:hidden shrink-0 tp-panel border-x-0 border-b-0 rounded-none grid grid-cols-4 h-14 pb-[env(safe-area-inset-bottom)]" aria-label="mobile">
      <UButton
        v-for="n in nav"
        :key="n.to"
        :to="n.to"
        :icon="n.icon"
        :label="t(n.label)"
        variant="ghost"
        size="sm"
        class="justify-center"
        :color="$route.path === n.to ? 'primary' : 'neutral'"
      />
    </nav>

    <ClientOnly>
      <InstallBanner v-if="install.shouldShowBanner.value" />
      <NotificationBanner />
      <UpdateWatcher />
      <!-- the single reusable, dismissible permission prompt (friends/onboarding/settings call suggest()) -->
      <PermissionPrompt />
      <!-- forced multi-tab guard: full-screen block when another tab holds the account -->
      <TabGuard v-if="!ui.isMainTab" />
    </ClientOnly>
  </div>
</template>
