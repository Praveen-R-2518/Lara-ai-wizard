import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS applications(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, source TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflows(
      id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES applications(id), title TEXT NOT NULL,
      status TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_runs(
      id INTEGER PRIMARY KEY, app_id TEXT NOT NULL REFERENCES applications(id), source_hash TEXT NOT NULL,
      route_map TEXT NOT NULL, workflow_count INTEGER NOT NULL, analyzed TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), status TEXT NOT NULL,
      step_index INTEGER NOT NULL, snapshot TEXT NOT NULL, input_type TEXT NOT NULL, started TEXT NOT NULL, ended TEXT
    );
    CREATE TABLE IF NOT EXISTS session_events(
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), action TEXT NOT NULL,
      accepted INTEGER NOT NULL, occurred TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity(
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL, icon TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations(
      id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES applications(id), title TEXT NOT NULL,
      created TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, workflow_id TEXT, created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(conversation_id,id);
    CREATE INDEX IF NOT EXISTS conversations_app ON conversations(app_id,updated);
  `);
  for (const [table, column, type] of [
    ['analysis_runs', 'knowledge', "TEXT NOT NULL DEFAULT '{}'"],
    ['activity', 'app_id', 'TEXT REFERENCES applications(id)']
  ]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(field => field.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  return db;
}
