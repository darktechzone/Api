const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin API key (change this to something strong)
const ADMIN_KEY = 'DarkZone2025';

// Enable CORS for all origins (so any app/website can use it)
app.use(cors());
app.use(express.json());

// ========== SQLite Database Setup ==========
const db = new sqlite3.Database('./numbers.db');

db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== PUBLIC ENDPOINTS (No API key needed) ==========

// 1. Get list of countries with available numbers
app.get('/api/countries', (req, res) => {
  db.all("SELECT country, COUNT(*) as count FROM numbers GROUP BY country", (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({
      success: true,
      countries: rows.map(r => ({ code: r.country, count: r.count }))
    });
  });
});

// 2. Get random virtual number(s) – optional ?country=XX&limit=Y
app.get('/api/number', (req, res) => {
  const country = req.query.country ? req.query.country.toUpperCase() : null;
  const limit = Math.min(parseInt(req.query.limit) || 1, 10);
  
  let sql, params;
  if (country) {
    sql = "SELECT phone FROM numbers WHERE country = ? ORDER BY RANDOM() LIMIT ?";
    params = [country, limit];
  } else {
    sql = "SELECT phone FROM numbers ORDER BY RANDOM() LIMIT ?";
    params = [limit];
  }
  
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const numbers = rows.map(r => r.phone);
    if (numbers.length === 0) {
      return res.status(404).json({ success: false, error: 'No numbers available' + (country ? ` for ${country}` : '') });
    }
    res.json({
      success: true,
      count: numbers.length,
      numbers: numbers,
      country: country || 'random'
    });
  });
});

// 3. Proxy to your existing OTP API (adds CORS, so any domain can fetch OTPs)
app.get('/api/otps', async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const response = await axios.get('https://dtz-tools.xo.je/sms-api.php', {
      params: { limit },
      timeout: 10000
    });
    // Forward the JSON exactly as received
    res.json(response.data);
  } catch (error) {
    console.error('OTP proxy error:', error.message);
    res.status(502).json({ success: false, error: 'Failed to fetch OTPs from upstream' });
  }
});

// ========== ADMIN ENDPOINTS (require API key in header or query) ==========
function adminAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

// Add numbers (POST body: { country, numbers: ["+123...", ...] })
app.post('/api/admin/numbers', adminAuth, (req, res) => {
  const { country, numbers } = req.body;
  if (!country || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing country or numbers array' });
  }
  const stmt = db.prepare("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)");
  let added = 0;
  numbers.forEach(phone => {
    stmt.run([country.toUpperCase(), phone], function(err) {
      if (!err && this.changes > 0) added++;
    });
  });
  stmt.finalize(err => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, added: added, total: numbers.length });
  });
});

// Delete all numbers of a country
app.delete('/api/admin/country/:country', adminAuth, (req, res) => {
  const country = req.params.country.toUpperCase();
  db.run("DELETE FROM numbers WHERE country = ?", [country], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// Delete a single number by exact phone
app.delete('/api/admin/number', adminAuth, (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  db.run("DELETE FROM numbers WHERE phone = ?", [phone], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// ========== Root endpoint with instructions ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone – Virtual Numbers API</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🔐 Dark Tech Zone Virtual Numbers API</h1>
      <p>✅ API is running. Base URL: <code>${req.protocol}://${req.get('host')}</code></p>
      <h2>📡 Public Endpoints (No API key)</h2>
      <ul>
        <li><code>GET /api/countries</code> – list countries with number counts</li>
        <li><code>GET /api/number?country=US&limit=1</code> – get random number(s)</li>
        <li><code>GET /api/otps?limit=50</code> – proxy to OTP API (real‑time SMS)</li>
      </ul>
      <h2>🔑 Admin Endpoints (API key required)</h2>
      <p>Use header <code>x-api-key: DarkZone2025</code> or query param <code>?key=DarkZone2025</code></p>
      <ul>
        <li><code>POST /api/admin/numbers</code> – add numbers (body: { "country": "US", "numbers": ["+12025550123"] })</li>
        <li><code>DELETE /api/admin/country/:country</code> – delete all numbers of a country</li>
        <li><code>DELETE /api/admin/number</code> – delete a single number (body: { "phone": "+12025550123" })</li>
      </ul>
      <h2>🧪 Test with cURL</h2>
      <pre>
# Add numbers
curl -X POST https://your-app.up.railway.app/api/admin/numbers \\
  -H "x-api-key: DarkZone2025" \\
  -H "Content-Type: application/json" \\
  -d '{"country":"US","numbers":["+12025550123","+12025550124"]}'

# Get a random US number
curl https://your-app.up.railway.app/api/number?country=US

# Get OTPs
curl https://your-app.up.railway.app/api/otps?limit=10
      </pre>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Dark Tech Zone API running on port ${PORT}`);
  console.log(`🔗 WhatsApp channel: https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t`);
});
