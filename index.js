const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin API key (change this!)
const ADMIN_KEY = 'DarkZone2025';

app.use(cors());
app.use(express.json());

// ========== SQLite Database ==========
const db = new sqlite3.Database('./numbers.db');
db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== PANEL CONFIGURATION (KONEK + ST) ==========
const PANELS = [
  {
    name: 'KONEK',
    url: 'http://51.77.216.195/crapi/konek/viewstats',
    token: 'RFRXSjRSQmNccJFIWpN1e16XVIdYjGtlSGlphVVRUHpClnlginKV'
  },
  {
    name: 'ST Panel',
    url: 'http://147.135.212.197/crapi/st/viewstats',
    token: 'SFBXRkFBUzSIiZZ8Y2FwSlqMb3yGkWOAi2lXW1JojFZbaFddaZRPdQ=='
  }
];

function extractOtp(text) {
  if (!text) return null;
  const m = text.match(/(?<!\d)(\d{3,4})[\s\-]?(\d{3,4})(?!\d)/);
  if (m) return m[1] + m[2];
  const m2 = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
  return m2 ? m2[1] : null;
}

async function fetchPanelMessages(panel, limit = 20) {
  try {
    const url = `${panel.url}?token=${encodeURIComponent(panel.token)}&records=${limit}`;
    const res = await axios.get(url, { timeout: 10000 });
    const data = res.data;
    const messages = [];
    if (data && data.data && Array.isArray(data.data)) {
      for (const row of data.data) {
        messages.push({
          source: panel.name,
          time: row.dt || new Date().toISOString(),
          number: row.num || '',
          service: row.cli || '',
          message: row.message || '',
          otp: extractOtp(row.message)
        });
      }
    } else if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
      for (const row of data) {
        if (row.length >= 4) {
          messages.push({
            source: panel.name,
            time: row[3] || new Date().toISOString(),
            number: row[1] || '',
            service: row[0] || '',
            message: row[2] || '',
            otp: extractOtp(row[2])
          });
        }
      }
    }
    return messages;
  } catch (err) {
    console.error(`Panel ${panel.name} error:`, err.message);
    return [];
  }
}

// ========== PUBLIC ENDPOINTS ==========
app.get('/api/countries', (req, res) => {
  db.all("SELECT country, COUNT(*) as count FROM numbers GROUP BY country", (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, countries: rows.map(r => ({ code: r.country, count: r.count })) });
  });
});

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
    if (!numbers.length) {
      return res.status(404).json({ success: false, error: 'No numbers available' + (country ? ` for ${country}` : '') });
    }
    res.json({ success: true, count: numbers.length, numbers, country: country || 'random' });
  });
});

app.get('/api/otps', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  let allMessages = [];
  for (const panel of PANELS) {
    const msgs = await fetchPanelMessages(panel, limit);
    allMessages.push(...msgs);
  }
  allMessages.sort((a, b) => new Date(b.time) - new Date(a.time));
  allMessages = allMessages.slice(0, limit);
  res.json({
    success: true,
    count: allMessages.length,
    messages: allMessages,
    branding: {
      channel: 'https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t',
      copyright: '© Dark Tech Zone — Advanced Security Division'
    }
  });
});

// ========== ADMIN ENDPOINTS ==========
function adminAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ success: false, error: 'Invalid API key' });
  next();
}

app.post('/api/admin/numbers', adminAuth, (req, res) => {
  const { country, numbers } = req.body;
  if (!country || !numbers || !Array.isArray(numbers) || !numbers.length) {
    return res.status(400).json({ success: false, error: 'Missing country or numbers array' });
  }
  const stmt = db.prepare("INSERT OR IGNORE INTO numbers (country, phone) VALUES (?, ?)");
  let added = 0;
  numbers.forEach(phone => {
    stmt.run([country.toUpperCase(), phone], function(err) { if (!err && this.changes > 0) added++; });
  });
  stmt.finalize(err => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, added, total: numbers.length });
  });
});

app.delete('/api/admin/country/:country', adminAuth, (req, res) => {
  const country = req.params.country.toUpperCase();
  db.run("DELETE FROM numbers WHERE country = ?", [country], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

app.delete('/api/admin/number', adminAuth, (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  db.run("DELETE FROM numbers WHERE phone = ?", [phone], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// Root page with instructions
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dark Tech Zone API</title><style>body{background:#0a0c10;color:#fff;font-family:monospace;padding:2rem;}</style></head>
    <body>
      <h1>🔐 Dark Tech Zone Virtual Numbers API</h1>
      <p>✅ Running at <code>${req.protocol}://${req.get('host')}</code></p>
      <h2>Public Endpoints</h2>
      <ul>
        <li><code>GET /api/countries</code></li>
        <li><code>GET /api/number?country=US&limit=1</code></li>
        <li><code>GET /api/otps?limit=50</code> (real OTPs from KONEK+ST)</li>
      </ul>
      <h2>Admin (API key: DarkZone2025)</h2>
      <p>Use header <code>x-api-key: DarkZone2025</code></p>
      <ul>
        <li><code>POST /api/admin/numbers</code> – add numbers</li>
        <li><code>DELETE /api/admin/country/:country</code></li>
        <li><code>DELETE /api/admin/number</code></li>
      </ul>
      <p><a href="/admin.html">📁 Open Admin Panel to add numbers</a></p>
      <p>© Dark Tech Zone — Advanced Security Division | <a href="https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t" style="color:#00ff99;">Join WhatsApp</a></p>
    </body>
    </html>
  `);
});

// Simple admin HTML page to add numbers (served by the API itself)
app.get('/admin.html', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Add Numbers to API</title><style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:2rem;}</style></head>
    <body>
      <h2>➕ Add Virtual Numbers</h2>
      <input type="text" id="apiBase" value="${req.protocol}://${req.get('host')}" size="50" readonly><br><br>
      <input type="text" id="country" placeholder="Country code (e.g., US, PK, IN)" style="width:200px;"><br>
      <textarea id="numbers" rows="10" cols="50" placeholder="One phone number per line (with or without +)"></textarea><br>
      <button onclick="addNumbers()">Add Numbers</button>
      <pre id="result"></pre>
      <script>
        async function addNumbers() {
          const apiBase = document.getElementById('apiBase').value;
          const country = document.getElementById('country').value;
          const numbersText = document.getElementById('numbers').value;
          const numbers = numbersText.split('\\n').map(l=>l.trim()).filter(l=>l);
          if (!country || numbers.length===0) return alert('Fill country and numbers');
          const res = await fetch(apiBase + '/api/admin/numbers', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'x-api-key':'DarkZone2025' },
            body: JSON.stringify({ country, numbers })
          });
          const data = await res.json();
          document.getElementById('result').innerText = JSON.stringify(data, null, 2);
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`🔗 WhatsApp: https://whatsapp.com/channel/0029VbCgB63LCoX5aiV5qp1t`);
});
