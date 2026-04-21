const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.gumtree.com/flats-houses/property-to-rent/uk/england';

/**
 * Scrapes Gumtree listing cards from the search results page.
 * Returns an array of raw listing objects.
 */
async function scrapeListings({ url, pages = 2, retries = 3, proxies = [] } = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt < retries) {
    attempt++;
    const proxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
    console.log(`[Scraper] Attempt ${attempt}/${retries}${proxy ? ` using proxy ${proxy}` : ''}`);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,900',
    ];
    if (proxy) {
      args.push(`--proxy-server=${proxy}`);
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args,
      });

      const allListings = [];
      const page = await browser.newPage();

      // Spoof a real user agent to reduce bot detection
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });

      // Intercept and block heavy resources to speed things up
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['stylesheet', 'font', 'media'].includes(type) || req.isInterceptResolutionHandled()) {
          req.abort().catch(() => {});
        } else {
          req.continue().catch(() => {});
        }
      });

      const baseUrl = url || `${BASE_URL}?sort=relevance&search_category=property-to-rent&seller_type=private`;

      for (let pageNum = 1; pageNum <= pages; pageNum++) {
        const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}&page=${pageNum}`;

        console.log(`[Scraper] Fetching page ${pageNum}: ${pageUrl}`);

        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

        // Accept cookies if the banner appears
        try {
          await page.waitForSelector('[data-q="gdpr-accept-all-button"]', { timeout: 4000 });
          await page.click('[data-q="gdpr-accept-all-button"]');
          await new Promise(r => setTimeout(r, 1000));
        } catch (_) { /* No cookie banner, continue */ }

        // Wait for listings to appear
        try {
          await page.waitForSelector('[data-q="listing"]', { timeout: 15000 });
        } catch (_) {
          console.warn(`[Scraper] No listings found on page ${pageNum}, skipping due to possible block.`);
          throw new Error(`Empty results or blocked on page ${pageNum}`);
        }

        const pageListings = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('[data-q="listing"]'));

          return cards.map(card => {
            const linkEl = card.querySelector('[data-q="listing-title"] a, .listing-title a, a[href*="/p/"]');
            const href = linkEl ? linkEl.getAttribute('href') : '';
            const fullUrl = href ? (href.startsWith('http') ? href : 'https://www.gumtree.com' + href) : '';
            const idMatch = fullUrl.match(/\/(\d{7,})(?:[/?#]|$)/);
            const listing_id = idMatch ? idMatch[1] : (card.getAttribute('data-listing-id') || '');

            const titleEl = card.querySelector('[data-q="listing-title"], .listing-title');
            const title = titleEl ? titleEl.textContent.trim() : '';

            const priceEl = card.querySelector('[data-q="listing-price"] .listing-price-price, .listing-price');
            let priceText = priceEl ? priceEl.textContent.trim() : '';
            const priceValueMatch = priceText.replace(/,/g, '').match(/[\d.]+/);
            const price_value = priceValueMatch ? parseFloat(priceValueMatch[0]) : null;

            const locationEl = card.querySelector('[data-q="listing-location"] span, .listing-location span, [itemprop="addressLocality"]');
            const location = locationEl ? locationEl.textContent.trim() : '';

            const bedroomsEl = card.querySelector('[data-q="listing-spec"] span, .listing-size, .bedrooms');
            let bedrooms = '';
            if (bedroomsEl) {
              const bedMatch = bedroomsEl.textContent.match(/(\d+)\s*bed/i);
              bedrooms = bedMatch ? bedMatch[1] : bedroomsEl.textContent.trim();
            }

            const sellerEl = card.querySelector('[data-q="listing-ads-user"] span, .seller-name, [class*="sellerName"]');
            const sellerName = sellerEl ? sellerEl.textContent.trim() : '';

            const imgEl = card.querySelector('[data-q="listing-thumbnail"] img, .listing-thumbnail img, img.lazyload');
            const imageUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : '';

            const descEl = card.querySelector('[data-q="listing-description"], .listing-description');
            const description = descEl ? descEl.textContent.trim() : '';

            const featureEls = Array.from(card.querySelectorAll('[data-q="listing-feature"], .listing-features li'));
            const features = featureEls.map(f => f.textContent.trim());

            const availEl = card.querySelector('[data-q="listing-available"], [class*="available"]');
            const dateAvailable = availEl ? availEl.textContent.replace(/available/i, '').trim() : '';

            const dateEl = card.querySelector('[data-q="listing-addate"], .listing-addate');
            const scrapedAt = dateEl ? dateEl.textContent.trim() : '';

            return {
              listing_id, listing_url: fullUrl, title, price: priceText, price_value,
              location, bedrooms, 'Seller Name': sellerName, 'Date Available': dateAvailable,
              description, 'Image Url': imageUrl, features, scraped_at: scrapedAt,
            };
          }).filter(item => item.listing_id);
        });

        if (!pageListings.length) {
          throw new Error(`No listings extracted on page ${pageNum}`);
        }

        console.log(`[Scraper] Page ${pageNum}: found ${pageListings.length} listings`);
        allListings.push(...pageListings);

        // Polite delay between pages
        if (pageNum < pages) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
        }
      }

      await browser.close();
      return allListings; // Success, return the result

    } catch (err) {
      console.error(`[Scraper] Attempt ${attempt} failed:`, err);
      if (browser) {
        await browser.close().catch(() => {});
      }
      lastError = err;
      
      if (attempt < retries) {
        const delay = 2000 * Math.pow(2, attempt); // Exponential backoff (4s, 8s, 16s...)
        console.log(`[Scraper] Waiting ${delay}ms before next retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Scraping failed after ${retries} attempts. Last error: ${lastError?.message}`);
}

module.exports = { scrapeListings };
