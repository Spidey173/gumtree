const express = require('express');
const cors = require('cors');
const { scrapeListings } = require('./scraper');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// POST /scrape
// Body: { url?: string, pages?: number, retries?: number, proxies?: string[] }
// Returns: { status: 'done', data: [] }
// ─────────────────────────────────────────────
app.post('/scrape', async (req, res) => {
  const { url, pages = 5, retries = 3, proxies = [] } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  console.log(`[Server] New synchronous scrape job started — pages: ${pages}, retries: ${retries}`);

  try {
    const listings = await scrapeListings({ url, pages, retries, proxies });
    console.log(`[Server] Scrape completed — ${listings.length} listings`);
    res.json({ status: 'done', data: listings });
  } catch (err) {
    console.error(`[Server] Scrape failed:`, err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /health  — quick liveness check
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Gumtree scraper service listening on port ${PORT} (0.0.0.0)`);
  console.log(`  POST /scrape            – start a scrape job (synchronous)`);
  console.log(`  GET  /health             – liveness check`);
});
