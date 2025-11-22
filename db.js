/* db.js — sqlite3 (no native better-sqlite3) fallback with Promise wrappers and prepare shim */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, process.env.DB_FILE || 'tinylink.db');
const raw = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Failed to open DB:', err);
  else console.log('Opened DB at', DB_PATH);
});

// ensure table exists
raw.run(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT UNIQUE,
    original_url TEXT NOT NULL,
    total_clicks INTEGER DEFAULT 0,
    last_clicked TEXT,
    created_at TEXT
  )
`, (err) => {
  if (err) console.error('Table creation failed:', err);
});

// Promise helpers
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// prepare shim — returns an object with run/get/all that return Promises
function prepare(sql) {
  const stmt = raw.prepare(sql);
  return {
    run: (params = [], cb) => {
      if (typeof cb === 'function') return stmt.run(params, cb);
      return new Promise((resolve, reject) => {
        stmt.run(params, function (err) {
          if (err) return reject(err);
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get: (params = []) => new Promise((resolve, reject) => stmt.get(params, (err, row) => (err ? reject(err) : resolve(row)))),
    all: (params = []) => new Promise((resolve, reject) => stmt.all(params, (err, rows) => (err ? reject(err) : resolve(rows)))),
    finalize: () => stmt.finalize()
  };
}

module.exports = { all, get, run, prepare, raw };
