/**
 * Voice-recording lifecycle helpers (pure + unit-testable; the page owns the
 * MediaRecorder, this file owns the ONE rule that is easy to get wrong).
 *
 * Root cause of "the trash button sent my voice anyway": `MediaRecorder.stop()`
 * fires **one last `dataavailable`** (the buffered tail) and only then `onstop`.
 * The cancel path used to clear the chunk buffer and call `stop()` while the
 * handlers were still attached, so that trailing chunk landed back in the buffer
 * and `onstop` assembled + SENT a recording the user had just discarded.
 * Detaching the handlers BEFORE the stop is what actually cancels.
 */

/** The slice of `MediaRecorder` the helpers need (fakeable in tests). */
export interface RecordingLike {
  /** buffered chunks arrive here (`MediaRecorder` `ondataavailable`) */
  ondataavailable: ((e: { data: Blob }) => void) | null
  /** final callback (`MediaRecorder` `onstop`) — this is the send path */
  onstop: (() => void) | null
  /** `'inactive' | 'recording' | 'paused'` */
  state: string
  stop: () => void
}

/**
 * Stop an active recorder. A no-op when it is missing or already `inactive`,
 * because `MediaRecorder.stop()` THROWS on an inactive recorder (it happens for
 * real: `start()` can throw after the object was constructed).
 */
export function stopRecording(rec: RecordingLike | null | undefined): void {
  if (!rec || rec.state === 'inactive') return
  rec.stop()
}

/**
 * Cancel without sending: detach first (no trailing chunk, no `onstop`), then
 * stop the recorder. The caller owns the MediaStream tracks and the buffer.
 */
export function cancelRecording(rec: RecordingLike | null | undefined): void {
  if (!rec) return
  rec.ondataavailable = null
  rec.onstop = null
  stopRecording(rec)
}
