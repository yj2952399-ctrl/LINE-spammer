import type { Page } from 'playwright';

const INPUT = 'div[contenteditable="true"],textarea';

/** アプリ自身の送信リクエストを横取りして記録する初期化スクリプト */
export const CAPTURE_INIT = () => {
  const hook = (win: any) => {
    const orig = win.fetch;
    win.fetch = async (input: any, init: any = {}) => {
      try {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'POST' && /message|talk|send/i.test(url)) {
          const headers: Record<string, string> = {};
          new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
          win.__lastSend = { url, headers, body: String(init.body ?? '') };
        }
      } catch {}
      return orig(input, init);
    };
  };
  hook(window);
};

function patchBody(raw: string, text: string) {
  try {
    const o = JSON.parse(raw);
    if ('text' in o) o.text = text;
    else if (o.message?.text !== undefined) o.message.text = text;
    else return raw;
    return JSON.stringify(o);
  } catch {
    return raw.replace(/("text"\s*:\s*")[^"]*(")/, `$1${text}$2`);
  }
}

/** 主経路: 記録済みリクエストを書き換えて直接再送 */
export async function sendViaFetch(page: Page, text: string): Promise<boolean> {
  const captured = await page.evaluate(() => (window as any).__lastSend).catch(() => null);
  if (!captured) return false;

  const res = await page.evaluate(async ({ url, headers, body }) => {
    try {
      const r = await fetch(url, { method: 'POST', headers, body, credentials: 'include' });
      return { status: r.status, ok: r.ok, text: (await r.text()).slice(0, 300) };
    } catch (e: any) { return { status: 0, ok: false, text: String(e) }; }
  }, { url: captured.url, headers: captured.headers, body: patchBody(captured.body, text) });

  return res.ok && !/error|too many|しばらく/i.test(res.text);
}

/** 副経路: DOM 操作。disabled を剥がして押す */
export async function sendViaDom(page: Page, text: string): Promise<boolean> {
  const box = page.locator(INPUT).first();
  if (!(await box.isVisible().catch(() => false))) return false;

  await box.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await box.evaluate((el, t) => {
    if ((el as HTMLElement).isContentEditable) {
      document.execCommand('insertText', false, t);
    } else {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(el, t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, text);

  await page.waitForTimeout(250);

  // L2: disabled 剥がし + 送信ボタン + Enter の二段
  await page.evaluate(() => {
    const btn = document.querySelector('button[class*="send"],[class*="sendButton"]') as HTMLButtonElement | null;
    if (btn) { btn.disabled = false; btn.removeAttribute('disabled'); btn.click(); }
  });
  await page.keyboard.press('Enter');
  return true;
}

export async function send(page: Page, text: string): Promise<boolean> {
  return (await sendViaFetch(page, text)) || (await sendViaDom(page, text));
}