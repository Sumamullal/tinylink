// app.js — TinyLink (clean, combined server + DB + API)
require('dotenv').config();
const express = require('express');
const path = require('path');
const validator = require('validator');


const db = require('./db');

// ===== DEBUG: print table schema and wrap prepares to find SQLITE_RANGE =====
(async () => {
  try {
    console.log('DEBUG: listing links table schema...');
    const schema = await db.all("PRAGMA table_info('links')");
    console.log('DEBUG: links table columns:', schema.map(c => `${c.cid}:${c.name}:${c.type}`).join(' | '));
  } catch (e) {
    console.error('DEBUG: failed to read table schema:', e && e.message ? e.message : e);
  }
})();


const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));



const linksRouter = require('./routes/links');
app.use('/', linksRouter);

// Minimal error handler — logs and responds instead of letting process die
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Server error');
});


// Health check (must return 200)
app.get('/healthz', (req, res) => {
  res.status(200).json({
    ok: true,
    version: "1.0"
  });
});

// ------------------ DB helpers & statements ------------------
function generateCode(len = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function isValidCode(code) {
  return /^[A-Za-z0-9]{6,8}$/.test(code);
}

const insertStmt = db.prepare(`
  INSERT INTO links (short_code, original_url, total_clicks, last_clicked, created_at)
  VALUES (@short_code, @original_url, 0, NULL, @created_at)
`);
const findByCodeStmt = db.prepare('SELECT * FROM links WHERE short_code = ?');
const listAllStmt = db.prepare('SELECT * FROM links ORDER BY created_at DESC');
const deleteByCodeStmt = db.prepare('DELETE FROM links WHERE short_code = ?');
const incrementClicksStmt = db.prepare('UPDATE links SET total_clicks = total_clicks + 1, last_clicked = @last_clicked WHERE short_code = @short_code');

// ------------------ API: create, list, get, delete ------------------

// Create a link (409 if code exists)
app.post('/api/links', (req, res) => {
  try {
    const { url, customCode } = req.body;

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'url is required' });
    }

    let originalUrl = url.trim();
    if (!/^https?:\/\//i.test(originalUrl)) {
      originalUrl = 'https://' + originalUrl;
    }

    if (!validator.isURL(originalUrl, { require_protocol: true })) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    let code = null;
    if (customCode) {
      if (!isValidCode(customCode)) {
        return res.status(400).json({ error: 'customCode must match [A-Za-z0-9]{6,8}' });
      }
      const existing = findByCodeStmt.get(customCode);
      if (existing) return res.status(409).json({ error: 'customCode already exists' });
      code = customCode;
    } else {
      let attempts = 0;
      do {
        code = generateCode(6);
        attempts++;
        if (attempts > 10) code = generateCode(7);
      } while (findByCodeStmt.get(code));
    }

    const created_at = new Date().toISOString();
    insertStmt.run({ short_code: code, original_url: originalUrl, created_at });

    return res.status(201).json({
      short_code: code,
      original_url: originalUrl,
      short_url: `${process.env.BASE_URL || `http://localhost:${PORT}`}/${code}`,
      created_at
    });
  } catch (err) {
    console.error('POST /api/links error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DEBUG: List all links (temporary — prints DB rows to console)
app.get('/api/links', (req, res) => {
  try {
    const rows = listAllStmt.all();
    console.log('DEBUG /api/links - rows type:', typeof rows, 'length:', Array.isArray(rows) ? rows.length : 'N/A');
    console.log('DEBUG /api/links - first rows (up to 5):', rows && rows.slice ? rows.slice(0,5) : rows);
    // return the raw rows so we can see exactly what the DB returned
    return res.json(rows || []);
  } catch (err) {
    console.error('GET /api/links error (debug):', err && (err.stack || err.message) ? (err.stack || err.message) : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// Stats for one code
app.get('/api/links/:code', (req, res) => {
  try {
    const { code } = req.params;
    const row = findByCodeStmt.get(code);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json({
      short_code: row.short_code,
      original_url: row.original_url,
      total_clicks: row.total_clicks,
      last_clicked: row.last_clicked,
      created_at: row.created_at
    });
  } catch (err) {
    console.error('GET /api/links/:code error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete link
app.delete('/api/links/:code', (req, res) => {
  try {
    const { code } = req.params;
    const row = findByCodeStmt.get(code);
    if (!row) return res.status(404).json({ error: 'Not found' });
    deleteByCodeStmt.run(code);
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/links/:code error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ------------------ Root & DB test & redirect ------------------

// ------------------ UI: Create Link (Dashboard Form) ------------------
app.get('/create', (req, res) => {
  res.render('create', { error: null, values: {} });
});

app.post('/create', (req, res) => {
  try {
    // Accept both names so mismatch won't break
    const providedUrl = (req.body.url || req.body.destination || '').trim();
    const providedCustom = (req.body.customCode || req.body.custom || '').trim();

    console.log("DEBUG: POST /create body =", req.body);

    if (!providedUrl) {
      return res.render('create', {
        error: 'Destination required',
        values: req.body
      });
    }

    let originalUrl = providedUrl;
    if (!/^https?:\/\//i.test(originalUrl)) {
      originalUrl = 'https://' + originalUrl;
    }

    if (!validator.isURL(originalUrl, { require_protocol: true })) {
      return res.render('create', {
        error: 'Invalid URL',
        values: req.body
      });
    }

    // Handle custom code
    let code = providedCustom || generateCode(6);

    if (providedCustom) {
      if (!isValidCode(providedCustom)) {
        return res.render('create', {
          error: 'Custom code must be 6–8 letters/numbers.',
          values: req.body
        });
      }
      if (findByCodeStmt.get(providedCustom)) {
        return res.render('create', {
          error: 'This short code already exists!',
          values: req.body
        });
      }
    }

    // Generate unique code if needed
    while (findByCodeStmt.get(code)) {
      code = generateCode(6);
    }

    const created_at = new Date().toISOString();

    insertStmt.run({
      short_code: code,
      original_url: originalUrl,
      created_at
    });

    return res.redirect('/dashboard');

  } catch (err) {
    console.error('POST /create UI error:', err);
    return res.render('create', {
      error: 'Server error — please try again',
      values: req.body
    });
  }
});


// Root landing (simple)
app.get('/', (req, res) => {
  res.send(`
    <h1>TinyLink</h1>
    <p>Server is running. Useful endpoints:</p>
    <ul>
      <li><a href="/healthz">/healthz</a> — healthcheck (JSON)</li>
      <li><a href="/api/links">/api/links</a> — API</li>
    </ul>
    <p>Next: we'll add the dashboard UI at / and API endpoints.</p>
  `);
});

// DB test route (temporary)
app.get('/db-test', (req, res) => {
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    res.json({ ok: true, tables: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Redirect (302) with click increment
app.get('/:code', (req, res) => {
  try {
    const { code } = req.params;
    const row = findByCodeStmt.get(code);
    if (!row) return res.status(404).send('Not found');

    const now = new Date().toISOString();
    incrementClicksStmt.run({ last_clicked: now, short_code: code });

    return res.redirect(302, row.original_url);
  } catch (err) {
    console.error('Redirect error:', err);
    return res.status(500).send('Internal server error');
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`TinyLink server running at http://localhost:${PORT}`);
});
