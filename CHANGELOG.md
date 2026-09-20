# Changelog

## 0.1.0 — initial release

- Identity: browser keypair, nsec backup/restore, optional passphrase app lock (AES-GCM + PBKDF2), 60-day session re-lock.
- Friends: invite link (hash-fragment) / QR / friend code, friend requests with rate limiting, fingerprints, block/unblock, rename/pin/mute/archive.
- Messaging: NIP-59 gift-wrapped envelopes over Nostr (NIP-40 expiration), WebRTC DataChannel fast path with Nostr signaling, outbox with exponential backoff, delivery/read receipts, Lamport ordering, disappearing messages.
- PWA: installable, offline app shell, prompt-based updates, mobile install banner + iOS sheet, single-tab lock.
- Permissions Center, encrypted backups (v2 schema, tested migration), chat export, fa/en i18n with RTL and Jalali dates.
