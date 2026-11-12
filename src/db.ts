import Database from 'better-sqlite3';
import { CFG } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync(CFG.dataDir, { recursive: true });
export const db = new Database(path.join(CFG.dataDir, 'db.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT, state TEXT, status TEXT DEFAULT 'new', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, account_id TEXT, url TEXT, reply_text TEXT,
  enabled INTEGER DEFAULT 0, last_reply_at INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0, recover_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, level TEXT, msg TEXT, ts INTEGER
);
`);

export const logRow = (roomId: string, level: string, msg: string) => {
  db.prepare('INSERT INTO logs (room_id,level,msg,ts) VALUES (?,?,?,?)')
    .run(roomId, level, msg.slice(0, 500), Date.now());
  console.log(`[${level}] ${roomId} ${msg}`);
};