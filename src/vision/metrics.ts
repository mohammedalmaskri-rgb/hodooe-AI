// Rolling performance metrics for the live scan (all measured, never estimated).

export class RollingMetrics {
  private times: number[] = [];
  private frameStamps: number[] = [];
  private totalFrames = 0;
  private totalMs = 0;

  constructor(private window = 120) {}

  /** Record one processed frame: processing duration (ms) and completion time (ms). */
  add(processingMs: number, now: number) {
    this.times.push(processingMs);
    if (this.times.length > this.window) this.times.shift();
    this.frameStamps.push(now);
    while (this.frameStamps.length && now - this.frameStamps[0] > 1000) this.frameStamps.shift();
    this.totalFrames++;
    this.totalMs += processingMs;
  }

  /** Processed frames during the last second. */
  fps(now: number): number {
    while (this.frameStamps.length && now - this.frameStamps[0] > 1000) this.frameStamps.shift();
    return this.frameStamps.length;
  }

  avgMs(): number {
    return this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 0;
  }

  p95Ms(): number {
    if (!this.times.length) return 0;
    const s = [...this.times].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  }

  get frames() {
    return this.totalFrames;
  }

  sessionAvgMs(): number {
    return this.totalFrames ? this.totalMs / this.totalFrames : 0;
  }

  reset() {
    this.times = [];
    this.frameStamps = [];
    this.totalFrames = 0;
    this.totalMs = 0;
  }
}
