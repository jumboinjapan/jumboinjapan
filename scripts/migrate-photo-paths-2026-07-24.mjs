#!/usr/bin/env node
/**
 * migrate-photo-paths-2026-07-24.mjs — транзакционный перевод Airtable
 * Route Stops.«Photo Path» на каноническую раскладку /tours/city-tour/.
 *
 * ⚠️ ЗАПУСКАТЬ ТОЛЬКО ПОСЛЕ деплоя на прод ветки с файлами
 *    public/tours/city-tour/* — иначе лайв получит пути, которых нет.
 *
 * По умолчанию dry-run (печатает «было → стало», ничего не пишет).
 * Запись: node scripts/migrate-photo-paths-2026-07-24.mjs --write
 *
 * После записи: нажать «Обновить кэш сайта» в админке (Route Texts) или
 * дождаться ISR (до часа), затем `npm run sync:photo-fallback` и
 * закоммитить обновлённый снапшот + удалить старые файлы (cleanup-коммит).
 *
 * Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID (.env.local подхватывается).
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/** Ключ: `${Route Slug}::${POI Name Snapshot}` → новые значения. */
const MIGRATION = {
  'city-tour/day-one::Гинза': { photo: '/tours/city-tour/ginza-six.jpg' },
  'city-tour/day-one::Сад Хамарикю': { photo: '/tours/city-tour/hamarikyu-teahouse.jpg' },
  'city-tour/day-one::Рынок Цукидзи': { photo: '/tours/city-tour/tsukiji-chef.jpg' },
  'city-tour/day-one::Святилище Мэйдзи': { photo: '/tours/city-tour/meiji-jingu.jpg' },
  'city-tour/day-one::Харадзюку': { photo: '/tours/city-tour/harajuku-takeshita.jpg' },
  // Сибуя: смена не только раскладки, но и кадра — толпа на переходе →
  // памятник Хатико (решение владельца, кадр 2506×1674, handoff 2026-07-24).
  'city-tour/day-one::Сибуя': {
    photo: '/tours/city-tour/shibuya-hachiko.jpg',
    alt: 'Памятник Хатико у станции Сибуя ночью',
  },
  'city-tour/day-two::Императорский дворец (Восточный сад)': { photo: '/tours/city-tour/nijubashi.jpg' },
  'city-tour/day-two::Токийский вокзал и Маруноути': { photo: '/tours/city-tour/marunouchi-cityscape.jpg' },
  'city-tour/day-two::Асакуса и Сэнсодзи': { photo: '/tours/city-tour/sensoji.jpg' },
  'city-tour/day-two::Одайба': { photo: '/tours/city-tour/odaiba.jpg' },
  'city-tour/hidden-spots::Сибамата': { photo: '/tours/city-tour/shibamata-dusk.jpg' },
  'city-tour/hidden-spots::Янака Гинза': { photo: '/tours/city-tour/yanaka-street.jpg' },
  'city-tour/hidden-spots::Акихабара': { photo: '/tours/city-tour/akihabara-main.jpg' },
  'city-tour/hidden-spots::Голден Гай / Омоидэ Ёкотё': { photo: '/tours/city-tour/shinjuku-golden-gai.jpg' },
}

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
  const write = process.argv.includes('--write')
  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN / AIRTABLE_BASE_ID не заданы')

  // Проверка: все целевые файлы существуют локально.
  for (const { photo } of Object.values(MIGRATION)) {
    const f = path.join(ROOT, 'public', photo.slice(1))
    if (!fs.existsSync(f)) throw new Error(`Целевой файл отсутствует: ${photo}`)
  }

  const records = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Route Stops')}`)
    for (const f of ['Route Slug', 'POI Name Snapshot', 'Photo Path', 'Photo Alt']) url.searchParams.append('fields[]', f)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Airtable: HTTP ${res.status}`)
    const data = await res.json()
    records.push(...data.records)
    offset = data.offset
  } while (offset)

  const updates = []
  const seen = new Set()
  for (const r of records) {
    const key = `${r.fields['Route Slug']}::${r.fields['POI Name Snapshot']}`
    const target = MIGRATION[key]
    if (!target) continue
    seen.add(key)
    const fields = {}
    if (r.fields['Photo Path'] !== target.photo) fields['Photo Path'] = target.photo
    if (target.alt && r.fields['Photo Alt'] !== target.alt) fields['Photo Alt'] = target.alt
    if (Object.keys(fields).length === 0) { console.log(`= ${key} уже мигрирован`); continue }
    console.log(`~ ${key}`)
    console.log(`    Photo Path: ${r.fields['Photo Path']} → ${target.photo}`)
    if (fields['Photo Alt']) console.log(`    Photo Alt:  ${r.fields['Photo Alt']} → ${target.alt}`)
    updates.push({ id: r.id, fields })
  }
  for (const key of Object.keys(MIGRATION)) {
    if (!seen.has(key)) console.warn(`⚠️ запись не найдена в Airtable: ${key}`)
  }

  if (!write) {
    console.log(`\nDRY-RUN: ${updates.length} записей к обновлению. Запуск с --write для записи.`)
    return
  }

  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10)
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Route Stops')}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk }),
    })
    if (!res.ok) throw new Error(`PATCH failed: HTTP ${res.status} — ${await res.text()}`)
  }
  console.log(`\n✅ Записано: ${updates.length}. Дальше: «Обновить кэш сайта» в админке → npm run sync:photo-fallback → cleanup-коммит (старые файлы).`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
