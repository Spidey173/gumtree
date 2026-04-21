# Gumtree Scraper Service

A fast, pure HTTP-based Express service optimized with Axios and Cheerio. This scraper is built to fetch Gumtree listings directly and return the results synchronously, skipping slow headless browser overheads.

## Setup

1. Install dependencies (make sure `puppeteer` is removed if upgrading from an older version):
```bash
npm install
```

2. Start the server (defaults to port 3000):
```bash
node server.js
```

You can optionally use `nodemon` for development:
```bash
npm run dev
```

The server starts on **http://localhost:3000** by default.
Override the port by setting an environment variable: `PORT=3001 node server.js`.

---

## API

### `POST /scrape`

Starts a scrape job and synchronously returns the structured data extracted.

**Body (JSON):**
```json
{
  "url": "https://www.gumtree.com/flats-houses/property-to-rent/uk/england?sort=relevance&search_category=property-to-rent&seller_type=private",
  "pages": 5,
  "retries": 3,
  "proxies": [
    "http://username:pass@proxy.example.com:8080"
  ]
}
```

- `url`: (Required) The target URL to start scraping from.
- `pages`: (Optional) Number of pages to paginate through. Defaults to 5.
- `retries`: (Optional) Number of times to retry if a request fails. Defaults to 3.
- `proxies`: (Optional) Array of proxy strings. Will rotate through them randomly on retries.

**Response (Success):**
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
{ "ok": true }
```

---

## How it fits into the n8n workflow

1. The workflow triggers according to its schedule.
2. It hits the `POST /scrape` endpoint on this service.
3. The server immediately acts on fetching and parsing pages, returning the finished payload inside the response.
4. No explicit wait/polling loop is necessary.
5. The dataset seamlessly continues sequentially to your Filters and Sheet operations.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module 'axios'` | Run `npm install` to grab the newly added HTTP toolset packages. |
| Empty results or `AxiosError: 403` | Gumtree may have blocked your IP. If you are scraping at high frequencies, pass an array of proxies into the JSON payload body or space out scraping intervals. Note: this is target behaviour, not code failure. |
| Timeouts during scraping | Gumtree might be rate limiting you. Try decreasing the `pages` scraped simultaneously, reduce your n8n workflow execution frequency, or utilize robust rotating residential proxy servers. |
