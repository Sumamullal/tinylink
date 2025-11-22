// db-dump.js — inspect SQLite contents without sqlite3 CLI
const db = require('./db');

(async () => {
  try {
    console.log("ROWS IN LINKS TABLE:");
    const rows = await db.all("SELECT id, short_code, original_url, total_clicks, created_at FROM links");
    console.log(rows);
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
})();
