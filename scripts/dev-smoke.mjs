// Requests every app SFC from the running Vite dev server (?import) to force
// transforms, surfacing any compile error without a browser.
const base = 'http://localhost:3000/'
const files = [
  'app/app.vue',
  'app/layouts/default.vue',
  'app/components/Avatar.vue',
  'app/components/ContactActions.vue',
  'app/components/InstallBanner.vue',
  'app/components/MessageBubble.vue',
  'app/components/NotificationBanner.vue',
  'app/components/PermissionsCenter.vue',
  'app/components/QrCode.vue',
  'app/components/QrScanner.vue',
  'app/components/StatusTicks.vue',
  'app/components/UpdateWatcher.vue',
  'app/pages/index.vue',
  'app/pages/add.vue',
  'app/pages/friends.vue',
  'app/pages/lock.vue',
  'app/pages/onboarding.vue',
  'app/pages/chat/[id].vue',
  'app/pages/settings/index.vue',
  'app/pages/settings/[section].vue',
  'app/stores/ui.ts',
  'app/stores/chats.ts',
  'app/services/messenger.ts',
]
let bad = 0
for (const f of files) {
  try {
    const res = await fetch(base + f + '?import', { headers: { accept: '*/*' } })
    if (res.status !== 200) {
      bad++
      const text = await res.text()
      console.log(`FAIL ${res.status} ${f}\n${text.slice(0, 400)}`)
    } else {
      console.log(`ok   ${f}`)
    }
  } catch (e) {
    bad++
    console.log(`ERR  ${f}: ${e}`)
  }
}
console.log(bad === 0 ? 'ALL_MODULES_OK' : `${bad} FAILURES`)
