/** Injectable clock so tests are deterministic. */
export interface Clock {
  now(): number
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }
}

export class FakeClock implements Clock {
  private t: number
  constructor(start = 1_700_000_000_000) {
    this.t = start
  }
  now(): number {
    return this.t
  }
  advance(ms: number): void {
    this.t += ms
  }
}
