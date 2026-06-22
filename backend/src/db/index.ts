import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import type { DbUser } from '../types';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'core-hub.db');

// Migrate legacy database name (docker-gui.db → core-hub.db) if present
const legacyDb = path.join(DATA_DIR, 'docker-gui.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyDb)) {
  try {
    fs.renameSync(legacyDb, DB_PATH);
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(legacyDb + ext)) fs.renameSync(legacyDb + ext, DB_PATH + ext);
    }
  } catch { /* fall through – fresh DB will be created */ }
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS container_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT,
    path TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proxy_hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL UNIQUE,
    target_host TEXT NOT NULL DEFAULT 'localhost',
    target_port INTEGER NOT NULL,
    https INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  console.log('✓ Default admin user created: admin / admin');
  console.log('  → Please change the password after first login!');
}

export const userQueries = {
  getByUsername: db.prepare<[string], DbUser>('SELECT * FROM users WHERE username = ?'),
  getAll: db.prepare<[], Omit<DbUser, 'password_hash'>>('SELECT id, username, role, created_at FROM users'),
  create: db.prepare<[string, string, string]>('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
  delete: db.prepare<[number]>('DELETE FROM users WHERE id = ?'),
  changePassword: db.prepare<[string, number]>('UPDATE users SET password_hash = ? WHERE id = ?'),
};

export const auditQueries = {
  log: db.prepare<[number | null, string, string | null]>(
    'INSERT INTO audit_log (user_id, action, target) VALUES (?, ?, ?)'
  ),
  recent: db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50'),
};

export const categoryQueries = {
  set: db.prepare<[string, string]>(
    'INSERT INTO container_categories (container_id, category) VALUES (?, ?) ON CONFLICT(container_id) DO UPDATE SET category = excluded.category'
  ),
  getAll: db.prepare<[], { container_id: string; category: string }>('SELECT * FROM container_categories'),
  delete: db.prepare<[string]>('DELETE FROM container_categories WHERE container_id = ?'),
};

export interface BackupRow {
  id: number;
  type: string;
  name: string;
  source: string | null;
  path: string;
  size: number;
  status: string;
  created_at: string;
}

export const backupQueries = {
  create: db.prepare<[string, string, string | null, string, number, string]>(
    'INSERT INTO backups (type, name, source, path, size, status) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getAll: db.prepare<[], BackupRow>('SELECT * FROM backups ORDER BY created_at DESC'),
  getById: db.prepare<[number], BackupRow>('SELECT * FROM backups WHERE id = ?'),
  delete: db.prepare<[number]>('DELETE FROM backups WHERE id = ?'),
};

export interface ProxyRow {
  id: number;
  container_id: string | null;
  name: string;
  hostname: string;
  target_host: string;
  target_port: number;
  https: number;
  enabled: number;
  created_at: string;
}

export const proxyQueries = {
  getAll: db.prepare<[], ProxyRow>('SELECT * FROM proxy_hosts ORDER BY name'),
  getById: db.prepare<[number], ProxyRow>('SELECT * FROM proxy_hosts WHERE id = ?'),
  upsert: db.prepare<[string | null, string, string, string, number, number, number]>(
    `INSERT INTO proxy_hosts (container_id, name, hostname, target_host, target_port, https, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hostname) DO UPDATE SET
       container_id = excluded.container_id, name = excluded.name,
       target_host = excluded.target_host, target_port = excluded.target_port,
       https = excluded.https, enabled = excluded.enabled`
  ),
  setHttps: db.prepare<[number, number]>('UPDATE proxy_hosts SET https = ? WHERE id = ?'),
  setEnabled: db.prepare<[number, number]>('UPDATE proxy_hosts SET enabled = ? WHERE id = ?'),
  setHttpsAll: db.prepare<[number]>('UPDATE proxy_hosts SET https = ?'),
  delete: db.prepare<[number]>('DELETE FROM proxy_hosts WHERE id = ?'),
};
