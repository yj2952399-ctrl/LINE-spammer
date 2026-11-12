import type { Page, BrowserContext } from 'playwright';
import { CFG } from '../config.js';

/** L1: クライアント側スロットルカウンタを破壊する */
export async function clearThrottleState(page: Page) {
  await page.evaluate(() => {
    const re = /limit|throttle|cooldown|retry|send|interval/i;
    for (const store of [localStorage, sessionStorage]) {
      const kill: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && re.test(k)) kill.push(k);
      }
      kill.forEach(k => store.removeItem(k));
    }
    (window as any).__lastSend = null;
  }).catch(() => {});
}

export const backoff = (attempt: number) =>
  new Promise(r => setTimeout(r, Math.min(CFG.maxBackoffMs, 2 ** attempt * 500) + Math.random() * 400));