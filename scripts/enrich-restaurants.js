#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const INPUT_PATH = path.join(process.cwd(), 'src/data/restaurants-raw.json');
const OUTPUT_PATH = path.join(process.cwd(), 'src/data/restaurants.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findPlaceId(name) {
  const params = new URLSearchParams({
    input: `${name} Tokyo`,
    inputtype: 'textquery',
    fields: 'place_id,name',
    key: API_KEY,
  });

  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Places HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0) return null;

  return data.candidates[0]?.place_id || null;
}

async function main() {
  const raw = await fs.readFile(INPUT_PATH, 'utf8');
  const restaurants = JSON.parse(raw);

  const enriched = [];

  for (let i = 0; i < restaurants.length; i += 1) {
    const restaurant = restaurants[i];

    try {
      const placeId = await findPlaceId(restaurant.name);
      const google_maps_url = placeId
        ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
        : null;

      enriched.push({
        ...restaurant,
        google_maps_url,
      });

      console.log(`${i + 1}/${restaurants.length} ${restaurant.name} -> ${placeId ? 'FOUND' : 'NOT_FOUND'}`);
    } catch (error) {
      console.error(`${i + 1}/${restaurants.length} ${restaurant.name} -> ERROR: ${error.message}`);
      enriched.push({
        ...restaurant,
        google_maps_url: null,
      });
    }

    if (i < restaurants.length - 1) {
      await sleep(200);
    }
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');
  console.log(`Saved ${enriched.length} restaurants to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
