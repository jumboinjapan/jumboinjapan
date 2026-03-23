#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOTELS_TS_PATH = path.join(ROOT, "src/lib/hotels-data.ts");
const OUTPUT_PATH = path.join(ROOT, "src/data/hotels-trip.json");

const AFFILIATE_QUERY = "Allianceid=6693408&SID=231989290&trip_sub3=D14363442";
const TOKYO_CITY_ID = "294211";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

async function loadHotelNames() {
  const src = await fs.readFile(HOTELS_TS_PATH, "utf8");
  const names = [];
  const re = /name:\s*"([^"]+)"/g;
  let match;

  while ((match = re.exec(src)) !== null) {
    names.push(match[1]);
  }

  if (names.length === 0) {
    throw new Error("No hotel names found in src/lib/hotels-data.ts");
  }

  return names;
}

function extractHotelIdFromHtml(html) {
  const patterns = [
    /data-offline-hotelId="(\d+)"/i,
    /\/hotels\/tokyo-hotel-detail-\d+-(\d+)\//,
    /\/hotels\/[^"'\s>]*hotel-detail-\d+-(\d+)\//,
    /hotel-detail-\d+-(\d+)\//,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function fetchSearchHtml(name) {
  const url = `https://www.trip.com/hotels/list?city=228&keyword=${encodeURIComponent(name)}&locale=en-US&curr=USD`;

  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://www.trip.com/",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

function buildAffiliateUrl(hotelId) {
  return `https://www.trip.com/hotels/tokyo-hotel-detail-${TOKYO_CITY_ID}-${hotelId}/?${AFFILIATE_QUERY}`;
}

async function main() {
  const hotelNames = await loadHotelNames();
  const results = [];

  console.log(`Processing ${hotelNames.length} hotels...`);

  for (let i = 0; i < hotelNames.length; i += 1) {
    const name = hotelNames[i];
    process.stdout.write(`[${i + 1}/${hotelNames.length}] ${name} ... `);

    let tripUrl = null;

    try {
      const html = await fetchSearchHtml(name);
      const hotelId = extractHotelIdFromHtml(html);
      if (hotelId) {
        tripUrl = buildAffiliateUrl(hotelId);
        process.stdout.write(`OK (${hotelId})\n`);
      } else {
        process.stdout.write("not found\n");
      }
    } catch (error) {
      process.stdout.write(`error (${error.message})\n`);
    }

    results.push({ name, trip_url: tripUrl });

    if (i < hotelNames.length - 1) {
      await sleep(randomDelayMs());
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  const foundCount = results.filter((item) => item.trip_url).length;
  console.log(`\nSaved ${results.length} rows to ${OUTPUT_PATH}`);
  console.log(`Found trip_url for ${foundCount}/${results.length} hotels (${((foundCount / results.length) * 100).toFixed(1)}%)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
