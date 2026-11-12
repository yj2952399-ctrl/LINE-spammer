import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { CFG } from './config.js';
import { db, logRow } from './db.js';
import * as manager from './bot/manager.js';

const app = Fastify({ logger: false });
fs.mkdirSync(path.join(CFG.dataDir, 'accounts'), { recursive: true });

await app.register(fastifyStatic, { root: path.join(import.meta.dirname, 'web'), prefix: '/' });

/* --- アカウント手動追加: ログイン用ブラウザを VNC 上に出す --- */
let loginCtx: any = null;
let loginBrowser: any = null;

app.post('/api/accounts/open-login', async (_req, reply) => {
  if (loginBrowser) { await loginBrowser.close().catch(() => {}); }
  loginBrowser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  loginCtx = await loginBrowser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const p = await loginCtx.newPage();
  await p.goto('https://openchat.line.me/');
  reply.send({ ok: true, vnc: CFG.vncUrl });
});

app.post('/api/accounts/save', async (req, reply) => {
  const { name } = req.body as any;
  if (!loginCtx) return reply.code(400).send({ error: 'no login session' });
  const id = crypto.randomUUID();
  const file = path.join(CFG.dataDir, 'accounts', `${id}.json`);
  await loginCtx.storageState({ path: file });
  db.prepare('INSERT INTO accounts (id,name,state,status,created_at) VALUES (?,?,?,?,?)')
    .run(id, name || 'account', file, 'ready', Date.now());
  await loginBrowser?.close().catch(() => {});
  loginCtx = loginBrowser = null;
  reply.send({ id });
});

app.get('/api/accounts', async () => db.prepare('SELECT id,name,status FROM accounts').all());

app.post('/api/rooms', async (req, reply) => {
  const { accountId, url, replyText } = req.body as any;
  if (!accountId || !url || !replyText) return reply.code(400).send({ error: 'missing fields' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO rooms (id,account_id,url,reply_text,enabled) VALUES (?,?,?,?,0)')
    .run(id, accountId, url, replyText);
  reply.send({ id });
});

app.get('/api/rooms', async () =>
  db.prepare('SELECT * FROM rooms').all().map((r: any) => ({ ...r, running: manager.running().includes(r.id) })));

app.post('/api/rooms/:id/toggle', async (req, reply) => {
  const { id } = req.params as any;
  const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as any;
  if (!r) return reply.code(404).send({ error: 'not found' });
  const next = r.enabled ? 0 : 1;
  db.prepare('UPDATE rooms SET enabled = ? WHERE id = ?').run(next, id);
  next ? manager.startRoom(r) : manager.stopRoom(id);
  reply.send({ enabled: !!next });
});

app.get('/api/logs/:roomId', async (req) =>
  db.prepare('SELECT * FROM logs WHERE room_id = ? ORDER BY id DESC LIMIT 100')
    .all((req.params as any).roomId));

// 起動時に有効ルームを復元
for (const r of db.prepare('SELECT * FROM rooms WHERE enabled = 1').all() as any[]) manager.startRoom(r);

app.listen({ port: CFG.port, host: '0.0.0.0' })
  .then(() => console.log(`listening :${CFG.port}`));