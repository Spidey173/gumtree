const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function scrapeListings({ url, pages = 1 }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  );

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  let results = [];

  for (let i = 0; i < pages; i++) {
    console.log(`Scraping page ${i + 1}`);

    await page.waitForSelector('[data-q="listing"]', { timeout: 15000 });

    const listings = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-q="listing"]');

      return Array.from(cards).map(card => {
        const title = card.querySelector('[data-q="listing-title"]')?.innerText || '';
        const price = card.querySelector('[data-q="listing-price"]')?.innerText || '';
        const location = card.querySelector('[data-q="listing-location"]')?.innerText || '';

        const linkEl = card.querySelector('a');
        const listing_url = linkEl ? linkEl.href : '';

        return { title, price, location, listing_url };
      });
    });

    results.push(...listings);

    // Go to next page
    const nextBtn = await page.$('a[rel="next"]');
    if (!nextBtn) break;

    await Promise.all([
      nextBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);
  }

  await browser.close();
  return results;
}

module.exports = { scrapeListings };
