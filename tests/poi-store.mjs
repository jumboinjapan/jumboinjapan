#!/usr/bin/env node
/**
 * Тесты хранилища POI поверх Airtable (scripts/poi-portals/lib/airtable-store.mjs).
 *
 *   npm run test:poi-store
 *
 * Airtable подменяется заглушкой fetch: проверяется то, что нельзя увидеть
 * на живой базе без риска — постраничное чтение, выдача номеров без гонки,
 * поведение при коллизии и то, что dry-run действительно ничего не создаёт.
 */

import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { ingestPoiBatch } from '../src/lib/poi-ingest.ts'

let passed = 0
const failures = []
const check = (label, actual, expected) => {
  if (actual === expected) passed += 1
  else failures.push(`${label}: ждали ${expected}, получили ${actual}`)
}

/** Заглушка Airtable: две страницы существующих записей, приём создания. */
function fakeAirtable({ existing = [], collideOn = null } = {}) {
  const created = []
  const calls = { reads: 0, creates: 0, patches: 0 }

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    const method = init.method ?? 'GET'

    if (method === 'POST') {
      calls.creates += 1
      const body = JSON.parse(init.body)
      const rec = { id: `recNEW${created.length}`, fields: body.records[0].fields }
      created.push(rec)
      return { ok: true, json: async () => ({ records: [{ id: rec.id }] }) }
    }
    if (method === 'PATCH') {
      calls.patches += 1
      return { ok: true, json: async () => ({}) }
    }

    calls.reads += 1
    const filter = u.searchParams.get('filterByFormula')
    if (filter) {
      // Проверка коллизии: делаем вид, что номер занял чужой процесс.
      const id = filter.match(/'([^']+)'/)?.[1]
      const hits = id === collideOn ? [{ id: 'recFOREIGN', fields: { 'POI ID': id } }, { id: 'recNEW0', fields: { 'POI ID': id } }] : []
      return { ok: true, json: async () => ({ records: hits }) }
    }

    // Постраничная выдача: первая страница + offset, вторая без него.
    const offset = u.searchParams.get('offset')
    if (!offset && existing.length > 1) {
      return { ok: true, json: async () => ({ records: existing.slice(0, 1), offset: 'p2' }) }
    }
    return { ok: true, json: async () => ({ records: offset ? existing.slice(1) : existing }) }
  }

  return { created, calls }
}

const rec = (poiId, nameRu, extra = {}) => ({
  id: `rec${poiId}`,
  fields: { 'POI ID': poiId, 'POI Name (RU)': nameRu, 'Site City': 'nara', ...extra },
})

const originalFetch = globalThis.fetch

// ── Постраничное чтение ─────────────────────────────────────────────────
{
  const fake = fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи'), rec('POI-000011', 'Храм Кофукудзи')] })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX' })
  const all = await store.listExisting()
  check('обе страницы прочитаны', all.length, 2)
  check('вторая страница разобрана', all[1].nameRu, 'Храм Кофукудзи')
  await store.listExisting()
  check('второй вызов идёт из кэша', fake.calls.reads, 2)
}

// ── Выдача номеров ──────────────────────────────────────────────────────
{
  fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи')] })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX' })
  const one = await store.create({ 'POI Name (RU)': 'Храм Раз', 'Site City': 'nara' })
  check('следующий номер — максимум плюс один', one.poiId, 'POI-000011')
  const two = await store.create({ 'POI Name (RU)': 'Храм Два', 'Site City': 'nara' })
  check('второй номер не повторяется', two.poiId, 'POI-000012')
}

// ── Гонка: пять одновременных созданий ──────────────────────────────────
{
  fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи')] })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX' })
  const ids = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      store.create({ 'POI Name (RU)': `Храм ${i}`, 'Site City': 'nara' }).then((r) => r.poiId),
    ),
  )
  check('пять параллельных созданий', ids.length, 5)
  check('все номера различны', new Set(ids).size, 5)
}

// ── Коллизия между процессами ───────────────────────────────────────────
{
  // Номер POI-000011 «занят» чужим процессом в момент записи.
  const fake = fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи')], collideOn: 'POI-000011' })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX' })
  const r = await store.create({ 'POI Name (RU)': 'Храм Раз', 'Site City': 'nara' })
  check('запись переименована, а не потеряна', r.recordId, 'recNEW0')
  check('номер сменился', r.poiId !== 'POI-000011', true)
  check('сменён через PATCH', fake.calls.patches, 1)
}

// ── dryRun ничего не создаёт ────────────────────────────────────────────
{
  const fake = fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи')] })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX', dryRun: true })
  const r = await store.create({ 'POI Name (RU)': 'Храм Раз', 'Site City': 'nara' })
  check('номер выдан и в dry-run', r.poiId, 'POI-000011')
  check('но POST не отправлен', fake.calls.creates, 0)
}

// ── Пакет через конвейер: гейт видит уже созданные в этом же прогоне ─────
{
  fakeAirtable({ existing: [rec('POI-000010', 'Храм Тодайдзи', { Latitude: 34.689, Longitude: 135.8398 })] })
  const store = createAirtablePoiStore({ token: 't', baseId: 'appX', dryRun: true })
  const req = (nameRu, extra = {}) => ({
    source: { kind: 'portal-collector', id: 'bodik-nara' },
    poi: { nameRu, siteCity: 'nara', categoriesRu: ['Буддийский храм'], ...extra },
  })
  const results = await ingestPoiBatch(
    [
      req('Храм Тодайдзи'),                                        // дубль базы
      req('Храм Гокуракудзи'),                                     // новый
      req('Храм Гокуракудзи'),                                     // повтор внутри пакета
      req('Храм Кофукудзи', { lat: 34.6891, lon: 135.8399 }),      // 14 м от Тодайдзи
    ],
    store,
  )
  check('дубль базы заблокирован', results[0].outcome, 'blocked_duplicate')
  check('новый создан', results[1].outcome, 'created')
  check('повтор внутри пакета заблокирован', results[2].outcome, 'blocked_duplicate')
  // Соседство по координатам с 11.08.2026 останавливает приём. У храмового
  // комплекса соседние постройки действительно стоят в одной точке и
  // остаются разными записями — но ровно так же выглядит тот же объект,
  // заведённый под другим именем. Различить может только человек, поэтому
  // запись не создаётся, а причина возвращается вызывающему.
  check('сосед по координатам останавливает', results[3].outcome, 'needs_review')
  check('поля не строятся', results[3].fields, null)
  check('причина возвращена', /Рядом уже есть: POI-000010/.test(results[3].explanation), true)
}

globalThis.fetch = originalFetch

if (failures.length) {
  console.error(`\n✗ провалено ${failures.length} из ${passed + failures.length}\n`)
  for (const f of failures) console.error(`  ${f}`)
  process.exitCode = 1
} else {
  console.log(`✓ хранилище POI: ${passed} проверок пройдено`)
}
