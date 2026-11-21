import type SignalStore from '../store/SignalStore';

// The next check is due `interval` after the last one, give or take this share of it
const JITTER_SHARE = 0.1;

/**
 * Runs `callback`, which does not throw, every `interval` milliseconds. `keyTransparencyLastSelfCheck` of the store
 * keeps the time of the last run across sessions (Signal Desktop `ts/util/CheckScheduler.preload.ts`).
 */
export default class CheckScheduler {
  private timer?: ReturnType<typeof setTimeout>;

  private isRunning = false;

  // Changes whenever a timer is replaced or stopped, so a stale scheduling step does not set another timer
  private generation = 0;

  constructor(private store: SignalStore, private interval: number, private callback: () => Promise<void>) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    void this.schedule();
  }

  stop() {
    this.isRunning = false;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Makes the next check run at `timestamp`, by the device clock */
  async runAt(timestamp: number) {
    await this.store.setItem('keyTransparencyLastSelfCheck', timestamp - this.interval);
    if (this.isRunning) await this.schedule();
  }

  /** Makes the next check run `delay` from now at the earliest */
  async delayBy(delay: number) {
    const lastCheck = await this.store.getItem('keyTransparencyLastSelfCheck') ?? 0;
    await this.store.setItem(
      'keyTransparencyLastSelfCheck', Math.max(lastCheck, Date.now() + delay - this.interval),
    );
    if (this.isRunning) await this.schedule();
  }

  private async schedule() {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    const { interval } = this;
    const now = Date.now();
    // Without a last check, the first check comes at a random time within an interval
    const lastCheck = await this.store.getItem('keyTransparencyLastSelfCheck') ?? now - interval * Math.random();
    if (generation !== this.generation) return;

    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_SHARE / 2;
    const delay = Math.max(0, lastCheck + interval * jitter - now);
    this.timer = setTimeout(() => void this.run(generation), delay);
  }

  private async run(generation: number) {
    const lastCheck = await this.store.getItem('keyTransparencyLastSelfCheck');
    await this.callback();
    // The callback may have moved the next check itself
    if (lastCheck === await this.store.getItem('keyTransparencyLastSelfCheck')) {
      await this.store.setItem('keyTransparencyLastSelfCheck', Date.now());
    }
    if (generation === this.generation) await this.schedule();
  }
}
