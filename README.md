# Gumtree Scraper Service

A local Express + Puppeteer service that mirrors the scraper n8n calls at `localhost:3000`.

## Setup

```bash
cd gumtree-scraper
npm install
```

> Puppeteer will auto-download Chromium on first install (~170 MB). If you already
> have Chrome installed, you can set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and
> set `PUPPETEER_EXECUTABLE_PATH=/path/to/chrome` instead.

## Start

```bash
node server.js
# or for auto-reload during development:
npx nodemon server.js
```

The server starts on **http://localhost:3000** by default.
Override with `PORT=3001 node server.js`.

---

## API

### `POST /scrape`

Starts an async scrape job.

**Body (JSON):**
```json
{
  "url": "https://www.gumtree.com/flats-houses/property-to-rent/uk/england?sort=relevance&search_category=property-to-rent&seller_type=private",
  "pages": 2
}
```

**Response:**
```json
{ "runId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### `GET /scrape-results/:runId`

Poll until `status` is no longer `"pending"`.

**Response (pending):**
```json
{ "status": "pending" }
```

**Response (done):**
```json
{
  "status": "done",
  "data": [
    {
      "listing_id": "123456789",
      "listing_url": "https://www.gumtree.com/p/...",
      "title": "2 bed flat in ...",
      "price": "£1,200 pcm",
      "price_value": 1200,
      "location": "London",
      "bedrooms": "2",
      "Seller Name": "John",
      "Date Available": "Now",
      "description": "...",
      "imageUrl": "https://...",
      "features": ["Private"],
      "scraped_at": "..."
    }
  ]
}
```

---

### `GET /health`

Quick liveness check.

```json
{ "ok": true, "activeJobs": 1 }
```

---

## How it fits into the n8n workflow

```
Schedule → Get Sheet IDs → POST /scrape → Extract runId
  → Wait 30s → GET /scrape-results/:runId
  → (loop if pending) → Filter & Deduplicate → Build Message → Write to Sheet
```

The scraper service replaces the external scraping tool previously used in the workflow.
All n8n nodes remain unchanged — this service just needs to be running locally
before the workflow executes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Error: Failed to launch the browser` | Run `npm install` again or install missing libs: `sudo apt-get install -y libgbm1 libnss3` |
| Listings come back empty | Gumtree may have changed its HTML structure. Check selectors in `scraper.js` with `headless: false` to debug visually |
| Bot detection / CAPTCHA | Add a longer delay in `scraper.js` or use a residential proxy via `PUPPETEER_PROXY` env var |
| Puppeteer too slow | Reduce `pages` in the n8n workflow body to `1` |
