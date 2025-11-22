// db.js — Postgres for production (Render + Neon) + existing SQLite fallback
// Location: C:\Users\Hp\Desktop\tinylink\db.js

const path = require('path');

// If DATABASE_URL is set (Render/Neon), use pg; otherwise use sqlite
if (process.env.DATABASE_URL) {
  // --------------------
  // Postgres (production)
  // --------------------
  const { Client } = require('pg');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  client.connect().catch(err => {
    console.error('Postgres connect error:', err);
    // Do not exit here; let app handle errors gracefully
  });

  // convert sqlite-style ? placeholders into Postgres $1, $2, ...
  function convertPlaceholders(sql, params = []) {
    let idx = 0;
    const newSql = sql.replace(/\?/g, () => {
      idx += 1;
      return '$' + idx;
    });
    return { sql: newSql, params };
  }

  // prepare shim so sqlite-style code still works (prepare(...).run(...))
  const prepare = (sqlTemplate) => {
    return {
      run: async (params = []) => {
        try {
          const { sql, params: p } = convertPlaceholders(sqlTemplate, params);

          // If it's an INSERT and there's no RETURNING, add RETURNING id for lastID compatibility
          let finalSql = sql;
          if (/^\s*insert/i.test(sql) && !/returning/i.test(sql)) {
            finalSql = sql + ' RETURNING id';
          }

          const res = await client.query(finalSql, p);
          const lastID = res.rows?.[0]?.id ?? null;
          return { lastID, rowCount: res.rowCount, rows: res.rows };
        } catch (err) {
          // bubble up
          throw err;
        }
      }
    };
  };

  module.exports = {
    // return single row
    get: async (sql, params = []) => {
      const { sql: s, params: p } = convertPlaceholders(sql, params);
      const res = await client.query(s, p);
      return res.rows[0];
    },

    // return all rows
    all: async (sql, params = []) => {
      const { sql: s, params: p } = convertPlaceholders(sql, params);
      const res = await client.query(s, p);
      return res.rows;
    },

    // run statement (INSERT/UPDATE/DELETE). returns object with rowCount (and rows if RETURNING used)
    run: async (sql, params = []) => {
      const { sql: s, params: p } = convertPlaceholders(sql, params);
      const res = await client.query(s, p);
      return { rowCount: res.rowCount, rows: res.rows };
    },

    // provide prepare so code that expects sqlite-style prepare works
    prepare,

    // expose client for advanced operations (migrations, etc)
    client
  };

} else {
  // --------------------
  // SQLite (local dev) — your original file, preserved
  // --------------------
  const sqlite3 = require('sqlite3').verbose();
  const DB_PATH = path.join(__dirname, process.env.DB_FILE || 'tinylink.db'); // default filename

  const raw = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Failed to open DB:', err);
    } else {
      console.log('Opened DB at', DB_PATH);
    }
  });

  // Ensure the links table exists (preserves your columns)
  raw.run(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE,
      original_url TEXT NOT NULL,
      total_clicks INTEGER DEFAULT 0,
      last_clicked TEXT,
      created_at TEXT
    )
  `, (err2) => {
    if (err2) console.error("Table creation failed:", err2);
    else console.log("Links table ready.");
  });

  module.exports = {
    // Promise wrapper for all()
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
    },

    // Promise wrapper for get()
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.get(sql, params, (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });
    },

    // Promise wrapper for run()
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.run(sql, params, function (err) {
          if (err) {
            console.error('--- DB RUN ERROR ---');
            console.error('SQL:', sql);
            console.error('params:', params);
            console.error('error:', err && err.message ? err.message : err);
            return reject(err);
          }
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },

    // expose prepare (synchronous, returns Statement) if needed by app.js
    prepare(sql) {
      return raw.prepare(sql);
    },

    // expose the raw DB if you need lower-level operations
    db: raw
  };
}
