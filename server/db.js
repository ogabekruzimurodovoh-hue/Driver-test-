import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Opens (and creates) the SQLite database in dataDir. */
export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tms_id TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      telegram_chat_id INTEGER,
      link_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trucks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tms_id TEXT UNIQUE,
      unit TEXT NOT NULL UNIQUE,
      plate TEXT,
      vin TEXT,
      make TEXT,
      model TEXT,
      year INTEGER,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
      readiness TEXT NOT NULL DEFAULT 'unknown',
      last_inspection_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      checklist TEXT NOT NULL DEFAULT '{}',
      odometer INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      tms_ref TEXT,
      tms_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      file TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (inspection_id, slot)
    );
  `);
  return db;
}
