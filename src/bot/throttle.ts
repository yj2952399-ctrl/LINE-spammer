import { CFG } from '../config.js';

/** 全送信を直列化し、必ず minIntervalMs 以上あける */
export class ThrottleQueue {
  private chain: Promise<void> = Promise.resolve();
  private last = 0;

  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(async () => {
      const wait = Math.max(0, this.last + CFG.minIntervalMs - Date.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      try { return await fn(); }
      finally { this.last = Date.now(); }
    });
    this.chain = p.then(() => {}, () => {});
    return p as Promise<T>;
  }
}