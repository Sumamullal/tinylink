// db.js — simple better-sqlite3 setup
const path = require('path');
const Database = require('better-sqlite3');

// DB file in project root (or use DB_FILE env if present)
const dbPath = path.join(__dirname, process.env.DB_FILE || 'tinylink.db');
const db = new Database(dbPath);

// Optional: better durability/concurrency
db.pragma('journal_mode = WAL');

// Ensure links table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    total_clicks INTEGER NOT NULL DEFAULT 0,
    last_clicked TEXT,
    created_at TEXT NOT NULL
  );
`);

console.log('Opened DB at', dbPath);

module.exports = db;
