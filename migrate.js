// migrate.js — creates Postgres table in Neon (run with DATABASE_URL set)
const db = require('./db');

async function migrate() {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS links (
        id SERIAL PRIMARY KEY,
        short_code VARCHAR(64) UNIQUE,
        original_url TEXT NOT NULL,
        total_clicks INTEGER DEFAULT 0,
        last_clicked TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Migration complete');
    if (db.client && db.client.end) await db.client.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    if (db.client && db.client.end) await db.client.end();
    process.exit(1);
  }
}

migrate();
