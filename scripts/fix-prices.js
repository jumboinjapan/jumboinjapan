#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright-core');

const DATA_PATH = path.resolve(__dirname, '../src/data/restaurants.json');
const BATCH_SIZE = 10;
const DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeSinglePrice(text) {
  const m = String(text || '').match(/¥\s?\d[\d,]*/);
  return m ? m[0].replace(/¥\s*/g, '¥') : null;
}

function buildPriceFromList(prices) {
  if (!prices || prices.length === 0) return null;

  const unique = Array.from(new Set(prices.map((p) => normalizeSinglePrice(p)).filter(Boolean)));
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  const numeric = unique
    .map((p) => ({ raw: p, n: Number(p.replace(/[¥,]/g, '')) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);

  if (numeric.length < 2) return unique[0];
  return `${numeric[0].raw} - ${numeric[numeric.length - 1].raw}`;
}

async function extractByIcons(page) {
  return page.evaluate(() => {
    const priceMatches = (text) =>
      Array.from((text || '').matchAll(/¥\s?\d[\d,]*(?=\s*\/\s*Guest)/gi)).map((m) => m[0]);

    const getIconType = (el) => {
      const html = el.outerHTML || '';
      const tag = el.tagName?.toLowerCase() || '';
      const dataIcon = (el.getAttribute?.('data-icon') || '').toLowerCase();
      const aria = (el.getAttribute?.('aria-label') || '').toLowerCase();
      const alt = (el.getAttribute?.('alt') || '').toLowerCase();
      const src = (el.getAttribute?.('src') || '').toLowerCase();

      const blob = `${tag} ${dataIcon} ${aria} ${alt} ${src} ${html}`.toLowerCase();
      if (blob.includes('moon') || blob.includes('dinner')) return 'dinner';
      if (blob.includes('sun') || blob.includes('lunch')) return 'lunch';
      return null;
    };

    const findCardRoot = (iconEl, type) => {
      let current = iconEl;
      for (let i = 0; i < 8 && current; i += 1) {
        const text = (current.innerText || '').replace(/\s+/g, ' ').trim();
        if (!/Guest/i.test(text) || !/¥\s?\d/.test(text)) {
          current = current.parentElement;
          continue;
        }

        const moonCount = current.querySelectorAll('svg[data-icon="moon"], svg.fa-moon, img[alt*="moon" i], img[src*="moon" i]').length;
        const sunCount = current.querySelectorAll('svg[data-icon="sun"], svg.fa-sun, img[alt*="sun" i], img[src*="sun" i]').length;

        if (type === 'dinner' && moonCount >= 1 && sunCount === 0) return current;
        if (type === 'lunch' && sunCount >= 1 && moonCount === 0) return current;

        // fallback: first node with price+guest
        if (moonCount + sunCount === 1) return current;
        current = current.parentElement;
      }
      return null;
    };

    const iconNodes = Array.from(
      document.querySelectorAll(
        'svg[data-icon], svg.fa-moon, svg.fa-sun, img[alt*="moon" i], img[alt*="sun" i], img[src*="moon" i], img[src*="sun" i]'
      )
    );

    const out = { lunch: [], dinner: [] };
    const seen = new Set();

    for (const icon of iconNodes) {
      const type = getIconType(icon);
      if (!type) continue;

      const root = findCardRoot(icon, type);
      if (!root) continue;

      const key = `${type}::${(root.textContent || '').slice(0, 140)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const prices = priceMatches(root.innerText || '');
      if (prices.length) out[type].push(...prices);
    }

    return out;
  });
}

function mergePrices(target, incoming) {
  target.lunch.push(...(incoming.lunch || []));
  target.dinner.push(...(incoming.dinner || []));
}

function chooseExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p));
}

async function collectForRestaurant(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);

  // Ensure courses are visible
  await page.getByRole('button', { name: 'Courses' }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  const bag = { lunch: [], dinner: [] };

  // 1) Current visible course list
  mergePrices(bag, await extractByIcons(page));

  // 2) Switch course mode and collect again (some pages hide lunch by default)
  const lunchSwitch = page.getByText('View Lunch Courses', { exact: false }).first();
  if ((await lunchSwitch.count()) > 0) {
    await lunchSwitch.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    mergePrices(bag, await extractByIcons(page));
  }

  const dinnerSwitch = page.getByText('View Dinner Courses', { exact: false }).first();
  if ((await dinnerSwitch.count()) > 0) {
    await dinnerSwitch.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    mergePrices(bag, await extractByIcons(page));
  }

  return {
    lunch: buildPriceFromList(bag.lunch),
    dinner: buildPriceFromList(bag.dinner),
  };
}

function shouldSave(index) {
  return index > 0 && index % BATCH_SIZE === 0;
}

async function main() {
  const raw = await fsp.readFile(DATA_PATH, 'utf8');
  const restaurants = JSON.parse(raw);

  const executablePath = chooseExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  let changed = 0;

  for (let i = 0; i < restaurants.length; i += 1) {
    const r = restaurants[i];
    if (!r.pocket_concierge_url) continue;

    const prevLunch = r.lunch_price ?? null;
    const prevDinner = r.dinner_price ?? null;

    try {
      const parsed = await collectForRestaurant(page, r.pocket_concierge_url);

      let nextLunch = prevLunch;
      let nextDinner = prevDinner;

      if (parsed.lunch && parsed.dinner) {
        nextLunch = parsed.lunch;
        nextDinner = parsed.dinner;
      } else if (parsed.lunch && !parsed.dinner) {
        nextLunch = parsed.lunch;
        nextDinner = null;
      } else if (!parsed.lunch && parsed.dinner) {
        nextLunch = null;
        nextDinner = parsed.dinner;
      }
      // if both null -> keep old values

      r.lunch_price = nextLunch;
      r.dinner_price = nextDinner;

      if (prevLunch !== nextLunch || prevDinner !== nextDinner) {
        changed += 1;
        console.log(`[${i + 1}/${restaurants.length}] Updated: ${r.name} | lunch: ${prevLunch} -> ${nextLunch} | dinner: ${prevDinner} -> ${nextDinner}`);
      } else {
        console.log(`[${i + 1}/${restaurants.length}] Unchanged: ${r.name}`);
      }
    } catch (err) {
      console.warn(`[${i + 1}/${restaurants.length}] Error: ${r.name} | ${err.message}`);
    }

    if (shouldSave(i + 1)) {
      await fsp.writeFile(DATA_PATH, JSON.stringify(restaurants, null, 2) + '\n');
      console.log(`Saved progress after ${i + 1} restaurants.`);
    }

    await sleep(DELAY_MS);
  }

  await fsp.writeFile(DATA_PATH, JSON.stringify(restaurants, null, 2) + '\n');
  await context.close();
  await browser.close();

  console.log(`Done. Changed restaurants: ${changed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
