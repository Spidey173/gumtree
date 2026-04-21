const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const BASE_URL = 'https://www.gumtree.com/flats-houses/property-to-rent/uk/england';

/**
 * Concurrency helper: processes an array of items with a fixed concurrency limit
 */
async function asyncPool(concurrency, iterable, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of iterable) {
    const p = Promise.resolve().then(() => iteratorFn(item, iterable));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

/**
 * Configures an axios client with anti-bot headers and proxy
 */
function createClient(proxyUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    'sec-ch-ua-platform': '"Windows"',
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0'
  };

  const clientConfig = { headers, timeout: 60000 };

  if (proxyUrl) {
    try {
      const urlObj = new URL(proxyUrl);
      clientConfig.proxy = {
        protocol: urlObj.protocol.replace(':', ''),
        host: urlObj.hostname,
        port: parseInt(urlObj.port),
      };
      if (urlObj.username) {
        clientConfig.proxy.auth = {
          username: urlObj.username,
          password: urlObj.password
        };
      }
    } catch (e) {
      console.warn(`[Scraper] Invalid proxy URL: ${proxyUrl}`);
    }
  }

  return axios.create(clientConfig);
}

/**
 * Scrapes a single page and extracts listing details
 */
async function scrapeSinglePage(client, pageUrl, pageNum) {
  try {
    console.log(`[Scraper] Fetching page ${pageNum}: ${pageUrl}`);
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    const response = await client.get(pageUrl);
    const $ = cheerio.load(response.data);

    const listings = [];
    const cards = $('[data-q="listing"], article.listing-maxi');

    if (cards.length === 0) {
      console.warn(`[Scraper] No listings found on page ${pageNum}.`);
      return { listings: [], maxPage: 1 };
    }

    cards.each((_, el) => {
      const card = $(el);

      const linkEl = card.find('[data-q="listing-title"] a, .listing-title a, a[href*="/p/"]').first();
      const href = linkEl ? linkEl.attr('href') : '';
      const fullUrl = href ? (href.startsWith('http') ? href : 'https://www.gumtree.com' + href) : '';

      const idMatch = fullUrl.match(/\/(\d{7,})(?:[\/?#]|$)/);
      const listing_id = idMatch ? idMatch[1] : (card.attr('data-listing-id') || '');

      if (!listing_id) return; // Skip if no ID found

      const titleEl = card.find('[data-q="listing-title"], .listing-title').first();
      const title = titleEl ? titleEl.text().trim() : '';

      const priceEl = card.find('[data-q="listing-price"] .listing-price-price, .listing-price').first();
      let priceText = priceEl ? priceEl.text().trim() : '';
      const priceValueMatch = priceText.replace(/,/g, '').match(/[\d.]+/);
      const price_value = priceValueMatch ? parseFloat(priceValueMatch[0]) : null;

      const locationEl = card.find('[data-q="listing-location"] span, .listing-location span, [itemprop="addressLocality"]').first();
      const location = locationEl ? locationEl.text().trim() : '';

      const bedroomsEl = card.find('[data-q="listing-spec"] span, .listing-size, .bedrooms').first();
      let bedrooms = '';
      if (bedroomsEl.length) {
        const bedMatch = bedroomsEl.text().match(/(\d+)\s*bed/i);
        bedrooms = bedMatch ? bedMatch[1] : bedroomsEl.text().trim();
      }

      const sellerEl = card.find('[data-q="listing-ads-user"] span, .seller-name, [class*="sellerName"]').first();
      const sellerName = sellerEl ? sellerEl.text().trim() : '';

      const imgEl = card.find('[data-q="listing-thumbnail"] img, .listing-thumbnail img, img.lazyload').first();
      const imageUrl = imgEl ? (imgEl.attr('data-src') || imgEl.attr('src') || '') : '';

      const descEl = card.find('[data-q="listing-description"], .listing-description').first();
      const description = descEl ? descEl.text().trim() : '';

      const featureEls = card.find('[data-q="listing-feature"], .listing-features li');
      const features = [];
      featureEls.each((_, f) => features.push($(f).text().trim()));

      const availEl = card.find('[data-q="listing-available"], [class*="available"]').first();
      const dateAvailable = availEl ? availEl.text().replace(/available/i, '').trim() : '';

      const dateEl = card.find('[data-q="listing-addate"], .listing-addate').first();
      const scrapedAt = dateEl ? dateEl.text().trim() : '';

      listings.push({
        listing_id, listing_url: fullUrl, title, price: priceText, price_value,
        location, bedrooms, 'Seller Name': sellerName, 'Date Available': dateAvailable,
        description, 'Image Url': imageUrl, features, scraped_at: scrapedAt,
      });
    });

    // Detect max pages from pagination
    let maxPage = 1;
    const paginationLinks = $('.pagination-page, [data-q="pagination"] a, .pagination a');
    paginationLinks.each((_, link) => {
      const num = parseInt($(link).text().trim(), 10);
      if (!isNaN(num) && num > maxPage) {
        maxPage = num;
      }
    });

    console.log(`[Scraper] Page ${pageNum}: found ${listings.length} listings`);
    return { listings, maxPage };
  } catch (err) {
    console.error(`[Scraper] Exception on page ${pageNum}:`, err.message);
    return { listings: [], maxPage: 1 };
  }
}

/**
 * Scrapes Gumtree listing cards from the search results page using HTTP requests directly
 */
async function scrapeListings({ url, pages = 5, retries = 3, proxies = [] } = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt < retries) {
    attempt++;
    const proxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
    console.log(`[Scraper] Attempt ${attempt}/${retries}${proxy ? ' using proxy...' : ' (no proxy)'}`);

    const client = createClient(proxy);
    const allListings = [];
    const baseUrl = url || `${BASE_URL}?sort=relevance&search_category=property-to-rent&seller_type=private`;

    try {
      // 1. Scrape the first page to detect items and max pages
      const firstPageResult = await scrapeSinglePage(client, baseUrl, 1);
      if (!firstPageResult.listings.length) {
        throw new Error(`No listings extracted on page 1`);
      }
      allListings.push(...firstPageResult.listings);

      // Smart pagination bounds
      const detectedPages = firstPageResult.maxPage > 1 ? firstPageResult.maxPage : pages;
      const targetPages = Math.min(pages, detectedPages);

      // 2. Process remaining pages in FULL PARALLEL execution
      if (targetPages > 1) {
        const remainingUrls = [];
        for (let i = 2; i <= targetPages; i++) {
          remainingUrls.push({ pageNum: i, url: `${baseUrl}&page=${i}` });
        }

        // USER REQUESTED: Incremental concurrency (4 to 6) to avoid ban
        const CONCURRENCY_LIMIT = 5;
        console.log(`[Scraper] HTTP Scraping pages 2 to ${targetPages} in parallel (concurrency: ${CONCURRENCY_LIMIT})...`);

        const results = await asyncPool(CONCURRENCY_LIMIT, remainingUrls, async (item) => {
          return await scrapeSinglePage(client, item.url, item.pageNum);
        });

        for (const res of results) {
          allListings.push(...res.listings);
        }
      }

      return allListings; // Success
    } catch (err) {
      console.error(`[Scraper] Attempt ${attempt} failed:`, err.message);
      lastError = err;

      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`[Scraper] Waiting ${delay}ms before next retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Scraping failed after ${retries} attempts. Last error: ${lastError?.message}`);
}

module.exports = { scrapeListings };
