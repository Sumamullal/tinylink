// db.js — better-sqlite3 with helpers compatible with old API
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

// NEW: users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

console.log('Opened DB at', dbPath);


console.log('Opened DB at', dbPath);

/**
 * Helper methods to mimic the old sqlite3 wrapper:
 *  - db.get(sql, params)
 *  - db.all(sql, params)
 *  - db.run(sql, params)
 */
db.get = function (sql, params = []) {
  return db.prepare(sql).get(params);
};

db.all = function (sql, params = []) {
  return db.prepare(sql).all(params);
};

db.run = function (sql, params = []) {
  return db.prepare(sql).run(params);
};

module.exports = db;
