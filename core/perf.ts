/** Dev-only performance marks, printed once per label in the console. */

const reported = new Set<string>()

function enabled(): boolean {
  return import.meta.dev === true
}

export function mark(name: string): void {
  if (!enabled() || typeof performance === 'undefined') return
  try {
    performance.mark(name)
  } catch {
    /* mark names are cheap; ignore */
  }
}

/** Measure a mark against now (or another mark) and log it once. */
export function measure(name: string, startMark: string): number | undefined {
  if (!enabled() || typeof performance === 'undefined') return undefined
  let ms: number | undefined
  try {
    performance.mark(`${name}:end`)
    const entry = performance.measure(name, startMark, `${name}:end`)
    ms = Math.round(entry.duration * 100) / 100
  } catch {
    return undefined
  }
  if (!reported.has(name)) {
    reported.add(name)
    console.info(`[telepatty:perf] ${name} ${ms}ms`)
  }
  return ms
}

/** Measure an async block: `await measureAsync('chat-open-ready', () => load())`. */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = `${name}:start`
  mark(start)
  try {
    return await fn()
  } finally {
    measure(name, start)
  }
}
