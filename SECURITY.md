# Telepatty security model

## Provides

- End-to-end encryption of Nostr message payloads through NIP-59 Gift Wrap and NIP-44. Relays receive encrypted outer events, not application plaintext.
- Cryptographic sender authentication for the sealed Nostr rumor. The received envelope sender must match the authenticated rumor public key.
- Local-first storage, encrypted passphrase backups (PBKDF2-SHA-256 plus AES-256-GCM), an optional local app lock, bounded file transfers, and replay/duplicate handling.
- WebRTC DataChannel transport protected by the browser's DTLS implementation for live messages and files.

## Does not provide

- Perfect forward secrecy for asynchronous Nostr messages. Their NIP-44 encryption derives from long-term identity keys; an attacker who later obtains a recipient identity key and recorded matching wraps may decrypt them.
- Perfect anonymity, untraceability, zero metadata, protection against traffic analysis, a compromised device, malicious browser extensions, or a stolen unlocked browser profile.
- Guaranteed relay retention, delivery, ordering, availability, or removal after expiration. NIP-40 expiration is advisory to relays.
- A free TURN service or network anonymity. TURN-only mode requires a TURN server configured by the user.

## Threat model

| Actor | Can learn / do | Cannot learn from correctly implemented wrapping |
| --- | --- | --- |
| Nostr relay | Client IP, timing, outer event size, recipient `p` tag, relay selection; drop, delay, replay, reorder, or inject invalid events. | Message body, file bytes, sealed sender identity and inner tags. |
| ISP or network observer | Connections to relays/STUN/TURN, timing, volume, and destination infrastructure. | NIP-59 plaintext without endpoint compromise. |
| STUN server | The requesting client's IP and timing. | Message content. |
| TURN operator | Each connecting client's IP, timing and byte volume; it relays encrypted WebRTC traffic. | DataChannel plaintext under normal DTLS operation. |
| Direct WebRTC peer | Their own counterpart's reachable network address and timing may be exposed by direct ICE. | Other conversations or local identity secret. |
| Compromised device or stolen identity key | Local plaintext and keys available to that compromise. A stolen long-term Nostr identity key can endanger recorded historical async messages. | Data that was never present on the compromised endpoint. |

## Operational limits and abuse controls

Incoming friend requests are limited to five per sender per hour and twenty total per hour per client. Authorized peers are limited to 120 protocol envelopes per minute per sender in a browser session. These bounds protect UI/storage work but cannot stop a distributed attacker, who can rotate keys or publish directly to relays. Relay operators must enforce their own event-size, connection, publish-rate, and abuse controls. Messages from non-friends are dropped after authenticated unwrap; a public relay can still spend the recipient's network and decryption budget with valid-looking gift wraps.

Envelope bodies are capped at 32 KiB, whole application envelopes at 64 KiB, SDP at 64 KiB, ICE candidates at 8 KiB, and file offers at 5 MiB. Oversized or malformed outer events are rejected before NIP-59 unwrap where possible.

## Forward secrecy migration

Telepatty does not currently ship an asynchronous Double Ratchet. The official Signal `@signalapp/libsignal-client` distribution targets native Node/Electron platforms, not browser bundling, so adding it to this Nuxt app would not be a supported browser deployment. A future migration needs an audited browser-compatible Signal/X3DH + Double Ratchet implementation, signed/prekey publication and rotation through Nostr, device/session records in IndexedDB, skipped-key bounds, explicit session reset, and a versioned payload that keeps NIP-59 as the transport wrapper. Existing long-term-key messages must remain decryptable as legacy data; they cannot be retroactively given forward secrecy.

## WebRTC modes

- **Direct P2P** is the default. It has the best connectivity and is appropriate when revealing an address to the peer is acceptable.
- **TURN relay only** maps to the browser `iceTransportPolicy: 'relay'`. It avoids direct host and server-reflexive candidate paths, but needs user-supplied TURN credentials and does not hide metadata from that TURN provider. It is not an anonymous mode.
