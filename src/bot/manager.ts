import { Worker } from './worker.js';

const workers = new Map<string, Worker>();

export function startRoom(r: any) {
  if (workers.has(r.id)) return;
  const w = new Worker(r.id, r.account_id, r.url, r.reply_text);
  workers.set(r.id, w);
  w.start().catch(() => {});
}

export async function stopRoom(id: string) {
  const w = workers.get(id);
  if (!w) return;
  await w.stop();
  workers.delete(id);
}

export const running = () => [...workers.keys()];