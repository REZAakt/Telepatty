# Decisions

Short log of implementation decisions made without asking (per project rules).

1. **Nuxt 4.5 SPA** (`ssr: false`, `nuxt generate`, `nitro.preset: 'static'`); base path via `TELEPATTY_BASE_URL` env (default `/`). SPA fallback `404.html` written by a `nitro:build:public-assets` hook (plus workflow copy as belt-and-braces).
2. **Nuxt UI v4** + Tailwind 4. Runtime theme = `useAppConfig().ui.colors` + CSS variables (`--ui-radius`, `--tp-*`); 4 presets (Matrix, Cyber blue, Amber terminal, Stealth gray).
3. **i18n v10** with `strategy: 'no_prefix'`, fa/en JSON in `i18n/locales`, RTL via `useLocaleHead`.
4. **Invites use the URL fragment** (`https://host/base#/add?k=<npub>&n=<name>&r=<relays>&v=1`) so no server (incl. GitHub Pages) ever sees friend data. The hash is captured client-side and rewritten to `/add?...`.
5. **Nostr only in Phase 1-3 messaging**: NIP-59 gift wrap (`createRumor` kind 14 → seal kind 13 → wrap kind 1059), JSON envelope as rumor content. NIP-40 `expiration` tag added to the wrap for relays honoring expiry. Receipts (delivered/read) are envelopes of `type: 'receipt'`.
6. **WebRTC (Phase 4) is a custom minimal layer, not Trystero**: signaling envelopes ride the Nostr transport (ephemeral-ish wrapped kind 14 rumors, `type: 'signal'`), DataChannel carries envelopes directly. Perfect-negotiation-lite (smaller pubkey initiates). Trystero would add its own swarm-keyed rooms; custom keeps one pipeline and one dedupe path.
7. **Envelope state machine**: `pending → sent → delivered → read` (+`failed`), ACK = signed receipt envelope; outbox keeps entries until delivered receipt; exponential backoff capped at 5 min, 8 attempts then `failed` with manual retry. Everything persists in Dexie (survives reload).
8. **Ordering** = per-conversation Lamport counter (bootstrapped from stored max), tie-broken by sender ts then id — clock skew safe.
9. **Dexie schema v2** with explicit `version(1)/version(2).upgrade()` (v2 backfills `expireAt` from legacy per-chat timers); covered by a migration test. Backups embed `schemaVersion`; import refuses newer versions.
10. **App lock** = PBKDF2 (310k, SHA-256) + AES-GCM over the hex secret key in IndexedDB; raw key never touches localStorage. 60-day session, re-lock on expiry/restart.
11. **Install UX**: `beforeinstallprompt` captured and triggered from our own button; mobile-only banner after onboarding/first use; iOS gets an illustrated sheet; 3-dismiss stop + 5-day snooze; desktop gets only a Settings entry (no banner by design).
12. **Permissions**: never requested without a gesture; notifications banner snoozes 4 days ("Not now"); denied state shows browser-specific re-enable instructions + "Check again".
13. **Notifications** = local only via `registration.showNotification`; badge via `setAppBadge`; no push claim anywhere in UI.
14. **QR**: generation via `qrcode` (small dep, canvas); scanning via native `BarcodeDetector` when available with paste-code fallback everywhere else (no heavy WASM scanner in v1).
15. **Single-tab lock** via Web Locks (`telepatty-main`, held for page lifetime); secondary tabs are read-only and don't run transports.
16. **CSP** via meta tag (GitHub Pages can't set headers): `script-src 'self' 'unsafe-inline'` (Nuxt payload), `connect-src wss: ws:` for relays/WebRTC, no third-party hosts; fonts self-hosted at build time via @nuxt/fonts (Vazirmatn + JetBrains Mono).
17. **Versioning**: `appVersion` = package version + git short sha, baked via `runtimeConfig.public.appVersion` (and Vite `define`); shown in Settings → About next to protocol version.
18. **Default relays**: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net`, `wss://relay.nostr.band`, `wss://nostr.oxtr.dev` — user-editable, min-3 accepted by default.
19. **Vitest 5** with `happy-dom` + `fake-indexeddb`; `import.meta.client` statically true in tests via vitest `define` so composables are testable under a DOM.
20. **Typecheck**: `pnpm typecheck` (vue-tsc 3 + TS 5.9) is wired into CI. The first full pass surfaced ~45 issues (strict index-access, Nuxt UI prop sizes, component generics); all identified issues were fixed in source. The local vue-tsc run could not complete inside the dev session's process limits — CI verifies the final zero-error state. The production build (`nuxt generate`) is fully green.
