import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { db, logRow } from '../db.js';
import { ThrottleQueue } from './throttle.js';
import { snapshot, limitShown, inputReady } from './detect.js';
import { send, CAPTURE_INIT } from './sender.js';
import { clearThrottleState, backoff } from './recover.js';

const MSG_COUNT_SEL = '[class*="chat-item"],[class*="message-item"],[data-testid*="message"]';

export class Worker {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;
  private pages: Page[] = [];
  private queue = new ThrottleQueue();
  private proxyIdx = 0;
  private running = false;
  private lastSig = '';

  constructor(
    public roomId: string,
    public accountId: string,
    public url: string,
    public replyText: string,
  ) {}

  private statePath() { return path.join(CFG.dataDir, 'accounts', `${this.accountId}.json`); }

  private async launch() {
    const proxy = CFG.proxies.length ? CFG.proxies[this.proxyIdx % CFG.proxies.length] : null;
    if (proxy) this.proxyIdx++;

    this.browser = await chromium.launch({
      headless: CFG.headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      proxy: proxy ? { server: proxy } : undefined,
    });

    const state = fs.existsSync(this.statePath())
      ? JSON.parse(fs.readFileSync(this.statePath(), 'utf8')) : undefined;

    this.ctx = await this.browser.newContext({
      storageState: state,
      viewport: { width: 1280, height: 900 },
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });
    await this.ctx.addInitScript(CAPTURE_INIT);

    for (let i = 0; i < CFG.tabsPerAccount; i++) {
      const p = await this.ctx.newPage();
      await p.goto(this.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      this.pages.push(p);
    }
  }

  /** L5/L6: セッション完全再生成（storageState 引き継ぎ + プロキシ切替） */
  private async rebuildContext() {
    logRow(this.roomId, 'RECOVER', 'context rebuild');
    await this.ctx?.storageState({ path: this.statePath() }).catch(() => {});
    await this.ctx?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.pages = [];
    this.lastSig = '';
    await this.launch();
    db.prepare('UPDATE rooms SET recover_count = recover_count + 1 WHERE id = ?').run(this.roomId);
  }

  /** 検知→送信。制限を踏んだら L1→L3→L4→L5→L6→L7 の順で復帰を試みる */
  private async attempt(sig: string) {
    const page = this.pages[0];
    if (!page || page.isClosed()) return;

    const before = await snapshot(page);

    for (let attempt = 1; attempt <= 7; attempt++) {
      if (attempt === 1) await clearThrottleState(page);                 // L1
      if (attempt === 3) { await page.goto(this.url).catch(() => {}); }   // L3/L4
      if (attempt === 5) await this.rebuildContext();                     // L5/L6
      if (attempt >= 2) await backoff(attempt);                           // L7

      const target = this.pages[0];
      if (!target || !(await inputReady(target))) continue;

      const ok = await this.queue.run(() => send(target, this.replyText));
      await target.waitForTimeout(900);

      const after = await snapshot(target);
      const limited = await limitShown(target);

      if (ok && !limited && after.count > before.count) {
        db.prepare('UPDATE rooms SET last_reply_at = ?, sent_count = sent_count + 1 WHERE id = ?')
          .run(Date.now(), this.roomId);
        logRow(this.roomId, 'OK', `sent (attempt ${attempt})`);
        await this.ctx?.storageState({ path: this.statePath() }).catch(() => {});
        return;
      }
      logRow(this.roomId, 'LIMIT', `attempt ${attempt} failed (limited=${limited})`);
    }
    logRow(this.roomId, 'FAIL', 'all recovery levels exhausted');
  }

  private async tick() {
    const page = this.pages[0];
    if (!page || page.isClosed()) return;

    const { count, text, own } = await snapshot(page);
    const sig = `${count}:${text}`;
    if (!sig || sig === this.lastSig) return;
    this.lastSig = sig;

    if (count === 0 || own || !text) return;
    if (text === this.replyText) return;

    const room = db.prepare('SELECT enabled, last_reply_at FROM rooms WHERE id = ?').get(this.roomId) as any;
    if (!room?.enabled) return;
    if (Date.now() - room.last_reply_at < CFG.minIntervalMs) return;

    await this.attempt(sig);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.launch();

    while (this.running) {
      try { await this.tick(); } catch (e: any) { logRow(this.roomId, 'ERR', e.message); }
      await new Promise(r => setTimeout(r, CFG.pollMs));
    }
  }

  async stop() {
    this.running = false;
    await this.ctx?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}