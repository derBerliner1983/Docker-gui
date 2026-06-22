import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import type { DbUser } from '../types';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'docker-gui.db'));

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
