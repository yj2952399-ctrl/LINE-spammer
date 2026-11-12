import type { Page } from 'playwright';

const MSG = '[class*="chat-item"],[class*="ChatItem"],[class*="message-item"],[data-testid*="message"]';
const INPUT = 'div[contenteditable="true"],textarea';

export const LIMIT_PATTERNS = [
  /しばらく/, /送信できません/, /上限/, /too many/i, /rate.?limit/i,
  /retry.?after/i, /少し時間/, /失敗しました/,
];

export async function snapshot(page: Page) {
  return page.evaluate((SEL) => {
    const els = [...document.querySelectorAll(SEL)];
    const last = els[els.length - 1] as HTMLElement | undefined;
    const own = !!last?.closest('[class*="own"],[class*="self"],[class*="mine"]');
    return { count: els.length, text: (last?.innerText || '').trim().slice(0, 200), own };
  }, MSG).catch(() => ({ count: 0, text: '', own: false }));
}

export async function limitShown(page: Page): Promise<boolean> {
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  return LIMIT_PATTERNS.some(re => re.test(body));
}

export async function inputReady(page: Page): Promise<boolean> {
  return page.locator(INPUT).first().isVisible().catch(() => false);
}