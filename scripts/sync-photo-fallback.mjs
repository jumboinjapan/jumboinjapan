#!/usr/bin/env node
/**
 * sync-photo-fallback.mjs — регенерирует src/data/route-stop-photos.generated.json
 * из Airtable (Route Stops: Photo Path / Photo Alt).
 *
 * Этот JSON — НЕ источник правды, а зафиксированный в git кэш на случай
 * недоступности Airtable при холодном билде. Источник правды пути к фото
 * остановки — ровно одно место: Airtable «Route Stops».Photo Path.
 * Руками файл не редактировать — только `npm run sync:photo-fallback`.
 *
 * Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID (подхватывается .env.local).
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'src', 'data', 'route-stop-photos.generated.json')

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

async function main() {
  loadEnvLocal()
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN / AIRTABLE_BASE_ID не заданы')

  const records = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Route Stops')}`)
    for (const f of ['Route Slug', 'POI Name Snapshot', 'Stop Title Override', 'Photo Path', 'Photo Alt', 'Status', 'Is Helper'])
      url.searchParams.append('fields[]', f)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Airtable: HTTP ${res.status}`)
    const data = await res.json()
    records.push(...data.records)
    offset = data.offset
  } while (offset)

  /** slug -> ключ остановки (snapshot | titleOverride) -> { photo, alt } */
  const map = {}
  for (const r of records) {
    const f = r.fields
    if (!f['Photo Path'] || f['Is Helper'] || f['Status'] === 'Inactive') continue
    const slug = f['Route Slug']
    if (!slug) continue
    map[slug] ??= {}
    for (const key of [f['POI Name Snapshot'], f['Stop Title Override']]) {
      if (key) map[slug][key] = { photo: f['Photo Path'], alt: f['Photo Alt'] ?? '' }
    }
  }

  const sorted = Object.fromEntries(
    Object.keys(map).sort().map((slug) => [
      slug,
      Object.fromEntries(Object.keys(map[slug]).sort().map((k) => [k, map[slug][k]])),
    ]),
  )

  fs.writeFileSync(OUT, JSON.stringify({
    __comment: 'GENERATED — не редактировать. Кэш Airtable Route Stops.Photo Path/Alt на случай недоступности API. Обновление: npm run sync:photo-fallback',
    generatedAt: new Date().toISOString(),
    bySlug: sorted,
  }, null, 2) + '\n')
  console.log(`OK: ${OUT} — ${Object.keys(sorted).length} slug(ов), ${records.length} записей просмотрено`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
