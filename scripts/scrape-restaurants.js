#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

const START_PAGE = 1;
const BASE_URL = 'https://www.pocket-concierge.jp/en/restaurants?area=1&page=';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];

  return candidates.find((candidate) => {
    try {
      require('node:fs').accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

async function autoScrollAndSettle(page) {
  let sameCountRounds = 0;
  let previousCount = 0;

  for (let i = 0; i < 30; i += 1) {
    const currentCount = await page.locator('a[href^="/en/restaurants/"]').count();

    if (currentCount === previousCount) {
      sameCountRounds += 1;
    } else {
      sameCountRounds = 0;
      previousCount = currentCount;
    }

    if (sameCountRounds >= 3) break;

    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 1.6);
    });
    await page.waitForTimeout(700);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function scrapePage(page, pageNumber) {
  const url = `${BASE_URL}${pageNumber}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('a[href^="/en/restaurants/"]', { timeout: 120_000 });
  await autoScrollAndSettle(page);

  const rows = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/en/restaurants/"]'));

    return links
      .map((link) => {
        const href = link.getAttribute('href');
        if (!href) return null;

        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.pocket-concierge.jp${href.replace('/en', '')}`;

        const name = (link.querySelector('div.line-clamp-2.font-semibold.leading-tight, div.line-clamp-3.font-semibold.leading-tight')?.textContent || '').trim();

        const meta = Array.from(link.querySelectorAll('div.text-sub.text-xs')).map((el) => (el.textContent || '').trim()).filter(Boolean);
        const location = meta[0] || '';
        const cuisine = meta[1] || '';

        const area = location.includes(',') ? location.split(',').slice(1).join(',').trim() : location.trim();

        const prices = Array.from(link.querySelectorAll('span.text-body.-ml-2'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean);

        const description = (link.querySelector('p.text-sm')?.textContent || '').trim();

        if (!name || !fullUrl.includes('/restaurants/')) return null;

        return {
          name,
          description: description || null,
          cuisine: cuisine || null,
          area: area || null,
          city: 'Tokyo',
          lunch_price: prices[0] || null,
          dinner_price: prices[1] || null,
          pocket_concierge_url: fullUrl,
        };
      })
      .filter(Boolean);
  });

  return rows;
}

async function main() {
  const executablePath = getChromePath();
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = 'chrome';
  }

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();

  const all = [];

  const firstPageRows = await scrapePage(page, START_PAGE);
  const totalRestaurantsText = await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('div, p, span')).find((el) => /of\s+\d+\s+restaurants/i.test((el.textContent || '').trim()));
    return (node?.textContent || '').trim();
  });

  const totalRestaurants = Number(totalRestaurantsText.match(/of\s+(\d+)\s+restaurants/i)?.[1] || 0);
  const perPage = firstPageRows.length || 12;
  const totalPages = totalRestaurants > 0 ? Math.ceil(totalRestaurants / perPage) : 12;

  console.log(`Detected total: ${totalRestaurants || 'unknown'} restaurants, ${perPage} per page, ${totalPages} pages`);
  console.log(`Page ${START_PAGE}: ${firstPageRows.length} restaurants`);
  all.push(...firstPageRows);

  for (let p = START_PAGE + 1; p <= totalPages; p += 1) {
    const delay = 1_000 + Math.floor(Math.random() * 1_000);
    await sleep(delay);

    const rows = await scrapePage(page, p);
    console.log(`Page ${p}: ${rows.length} restaurants`);
    all.push(...rows);
  }

  await browser.close();

  const unique = Array.from(new Map(all.map((item) => [item.pocket_concierge_url, item])).values());

  const outputPath = path.join(process.cwd(), 'src/data/restaurants-raw.json');
  await fs.writeFile(outputPath, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');

  console.log(`Saved ${unique.length} restaurants to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
