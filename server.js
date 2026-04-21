const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { scrapeListings } = require('./scraper');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// In-memory job store
// Structure: { [runId]: { status, data, error, startedAt } }
// ─────────────────────────────────────────────
const jobs = new Map();

// Optional: auto-clean jobs older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.startedAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
// POST /scrape
// Body: { url?: string, pages?: number }
// Returns: { runId: string }
// ─────────────────────────────────────────────
app.post('/scrape', (req, res) => {
  const { url, pages = 2, retries = 3, proxies = [] } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  const runId = uuidv4();

  jobs.set(runId, {
    status: 'pending',
    data: null,
    error: null,
    startedAt: Date.now(),
  });

  console.log(`[Server] New scrape job started — runId: ${runId}, pages: ${pages}, retries: ${retries}`);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Scrape timeout')), 120000)
  );

  // Run the scraper asynchronously — don't await here
  Promise.race([
    scrapeListings({ url, pages, retries, proxies }),
    timeout
  ])
    .then(listings => {
      jobs.set(runId, {
        ...jobs.get(runId),
        status: 'done',
        data: listings,
      });
      console.log(`[Server] Job ${runId} completed — ${listings.length} listings`);
    })
    .catch(err => {
      jobs.set(runId, {
        ...jobs.get(runId),
        status: 'error',
        error: err.message,
      });
      console.error(`[Server] Job ${runId} failed:`, err.message);
    });

  res.json({ runId });
});

// ─────────────────────────────────────────────
// GET /scrape-results/:runId
// Returns: { status: 'pending'|'done'|'error', data?: [], error?: string }
// ─────────────────────────────────────────────
app.get('/scrape-results/:runId', (req, res) => {
  const { runId } = req.params;
  const job = jobs.get(runId);

  if (!job) {
    return res.status(404).json({ status: 'error', error: `Unknown runId: ${runId}` });
  }

  if (job.status === 'pending') {
    return res.json({ status: 'pending' });
  }

  if (job.status === 'error') {
    return res.status(500).json({ status: 'error', error: job.error });
  }

  // status === 'done'
  return res.json({ status: 'done', data: job.data });
});

// ─────────────────────────────────────────────
// GET /health  — quick liveness check
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, activeJobs: jobs.size });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Gumtree scraper service listening on http://localhost:${PORT}`);
  console.log(`  POST /scrape            – start a scrape job`);
  console.log(`  GET  /scrape-results/:id – poll for results`);
  console.log(`  GET  /health             – liveness check`);
});
