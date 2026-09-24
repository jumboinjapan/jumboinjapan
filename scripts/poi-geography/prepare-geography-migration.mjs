#!/usr/bin/env node
/**
 * ПОДГОТОВКА МИГРАЦИИ ОХВАТА И СВЯЗЕЙ — ТОЛЬКО ЧТЕНИЕ ФАЙЛОВ.
 *
 *   node scripts/poi-geography/prepare-geography-migration.mjs \
 *     --schema <снимок Meta API tables> --base <снимок базы> \
 *     --proposals <poi-geography-proposals/v1> --out <новый каталог> [--today YYYY-MM-DD]
 *
 * Отчёт называет две части миграции, ни одну не исполняя:
 *
 *   1. СХЕМА — есть ли поле `POI Geography`; если нет, ровно один запрос
 *      Meta API, который его создаёт, и постусловие, по которому создание
 *      проверяется свежим чтением. Повтор с уже созданным полем — `present`,
 *      запроса нет: дубля поля не бывает.
 *   2. ДАННЫЕ — по каждому предложению один исход из закрытого списка;
 *      сумма исходов равна числу предложений; `old → new` по полю; повтор на
 *      снимке с уже записанным равным документом даёт `alreadyMatches`, а не
 *      второе предложение. Частичное исполнение проверяется тем же отчётом на
 *      свежем снимке: строки делятся на применённые и оставшиеся.
 *
 * Сети, Airtable, записи здесь нет. Исполнение — по существующим путям после
 * аудита: поле — цепочкой схемной операции по отдельной карточке, данные —
 * `poi:jg-intake --review-selection` (создание) и `poi:jg-copy --links`
 * (существующие записи) через реестр review, куда предложения переносятся
 * агентом ПОСЛЕ проверки источников.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { assertExactKeys, canonicalJsonBytes, isStrictCalendarDate } from '../lib/canonical-contract.mjs'
import { findPoiTable } from '../../src/lib/poi-taxonomy-airtable.ts'
import { POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { POI_GEOGRAPHY_FIELD, POI_GEOGRAPHY_FIELD_TYPE, mergePoiGeographyDocument, readPoiGeographyDocument, serializePoiGeographyDocument } from '../../src/lib/poi-geography-document.ts'
import { reviewGeographyDocument } from '../poi-portals/lib/geography-review.mjs'

export const PROPOSALS_SPEC = 'poi-geography-proposals/v1'
export const MIGRATION_REPORT_SPEC = 'poi-geography-migration-report/v1'
export const DATA_OUTCOMES = Object.freeze(['create', 'alreadyMatches', 'needsOwner', 'insufficientEvidence', 'technicalRefusal'])

/** Один запрос Meta API — тело описано здесь и только здесь. */
export const FIELD_REQUEST = Object.freeze({
  method: 'POST',
  path: `/v0/meta/bases/{baseId}/tables/${POI_TABLE_ID}/fields`,
  body: Object.freeze({
    name: POI_GEOGRAPHY_FIELD,
    type: POI_GEOGRAPHY_FIELD_TYPE,
    description: 'Документ poi-geography/v1: географический охват (префектуры, муниципалитеты) и связи мест. Контракт: docs/poi-intake/poi-geography-contract.md',
  }),
})

export function schemaPlan(tables) {
  const found = findPoiTable(tables)
  assert(found.ok, `Схема: ${found.reason}`)
  const field = (found.table.fields ?? []).find((f) => f.name === POI_GEOGRAPHY_FIELD) ?? null
  if (field && field.type !== POI_GEOGRAPHY_FIELD_TYPE) {
    return { state: 'conflict', field: { id: field.id ?? null, type: field.type }, request: null,
      postcondition: `поле «${POI_GEOGRAPHY_FIELD}» уже существует с типом ${field.type}; менять тип миграция не вправе — решение владельца` }
  }
  if (field) return { state: 'present', field: { id: field.id ?? null, type: field.type }, request: null, postcondition: 'поле есть; запрос не нужен, повтор дубля не создаёт' }
  return { state: 'missing', field: null, request: FIELD_REQUEST,
    postcondition: `после POST свежее чтение Meta API обязано показать в таблице ${POI_TABLE_ID} поле «${POI_GEOGRAPHY_FIELD}» типа ${POI_GEOGRAPHY_FIELD_TYPE}; ответ POST исходом не является` }
}

export function parseProposals(raw) {
  canonicalJsonBytes(raw, PROPOSALS_SPEC)
  assertExactKeys(raw, ['spec', 'note', 'rows'], PROPOSALS_SPEC)
  assert.equal(raw.spec, PROPOSALS_SPEC)
  assert(typeof raw.note === 'string', 'note must be text')
  assert(Array.isArray(raw.rows) && raw.rows.length > 0 && raw.rows.length <= 100, 'rows: 1..100 proposals')
  const seen = new Set()
  for (const row of raw.rows) {
    assertExactKeys(row, ['sourceKey', 'existingPoiId', 'decisionRef', 'sourcesFetched', 'parentKey', 'facts', ...['geographicScope', 'relations'].filter((k) => Object.hasOwn(row, k))], 'proposal')
    assert(typeof row.sourceKey === 'string' && row.sourceKey.includes(':'), 'sourceKey required')
    assert(row.existingPoiId === null || /^POI-\d{6}$/.test(row.existingPoiId), 'existingPoiId: POI ID or null')
    assert(typeof row.decisionRef === 'string' && row.decisionRef, 'decisionRef required')
    assert(typeof row.sourcesFetched === 'boolean', 'sourcesFetched must be declared explicitly')
    assert(row.parentKey === null || /^POI-\d{6}$/.test(row.parentKey) || row.parentKey.includes(':'), 'parentKey: key, POI ID or null')
    assert(Array.isArray(row.facts) && row.facts.length > 0, 'facts required')
    for (const f of row.facts) { assertExactKeys(f, ['text', 'sourceUrl', 'checkedOn'], 'fact'); assert(isStrictCalendarDate(f.checkedOn), 'fact date') }
    const key = row.existingPoiId ?? row.sourceKey
    assert(!seen.has(key), `proposal repeated: ${key}`); seen.add(key)
  }
  return raw
}

const baseRows = (raw) => {
  const rows = Array.isArray(raw) ? raw : raw.rows ?? raw.records
  assert(Array.isArray(rows) && rows.length, 'base snapshot must contain rows')
  return rows.map((r) => ({ recordId: r.recordId ?? r.id, fields: r.fields ?? {} }))
}

export function dataPlan({ proposals, base, today, schemaState }) {
  const rows = baseRows(base)
  const byPoiId = new Map(rows.filter((r) => typeof r.fields['POI ID'] === 'string').map((r) => [r.fields['POI ID'], r]))
  const bySourceKey = new Map(rows.filter((r) => typeof r.fields['Source Key'] === 'string').map((r) => [r.fields['Source Key'], r]))
  const resolve = (key) => {
    const r = key.startsWith('POI-') ? byPoiId.get(key) : bySourceKey.get(key)
    return r ? { poiId: r.fields['POI ID'], recordId: r.recordId, nameRu: r.fields['POI Name (RU)'] ?? '' } : null
  }
  /* Ключ, который сам предлагается к созданию в этом же пакете, — не
     «цели нет», а порядок записи: родитель создаётся раньше связи, как и в
     reviewed Intake (`relationTargetUnavailable` там останавливает строку до
     появления родителя). */
  const plannedKeys = new Set(proposals.rows.filter((r) => r.existingPoiId === null).map((r) => r.sourceKey))
  const results = proposals.rows.map((row) => {
    const base = { sourceKey: row.sourceKey, existingPoiId: row.existingPoiId, decisionRef: row.decisionRef }
    const diagnostics = []
    if (!row.sourcesFetched) diagnostics.push('источники названы, но в этой сессии не прочитаны; до реестра review их проверяет агент и ставит фактическую дату проверки')
    const finish = (outcome, extra = {}) => ({ ...base, outcome, diagnostics, ...extra })
    if (!row.sourcesFetched) {
      /* Остальные проверки всё равно выполняются и попадают в diagnostics:
         агенту нужно видеть все препятствия сразу, а не по одному за прогон. */
    }
    if (row.existingPoiId === null) {
      const known = bySourceKey.get(row.sourceKey)
      if (known) return finish('technicalRefusal', { reason: `ключ ${row.sourceKey} уже принадлежит ${known.fields['POI ID']}; предложение обязано ссылаться на него как на существующую запись` })
      if (!row.sourcesFetched) return finish('insufficientEvidence', { reason: diagnostics[0] })
      return finish('technicalRefusal', { reason: 'родитель ещё не зарегистрирован: агент готовит реестр review и подтверждённую точку по действующей политике координат, затем создаёт его через Intake; вопрос владельцу нужен только при нерешённом выборе' })
    }
    const record = byPoiId.get(row.existingPoiId)
    if (!record) return finish('technicalRefusal', { reason: `${row.existingPoiId} нет в снимке базы` })
    let built
    try {
      built = reviewGeographyDocument(row, { resolveTarget: resolve, today })
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
      return finish('insufficientEvidence', { reason: diagnostics[diagnostics.length - 1] })
    }
    const missing = built.unresolved.filter((key) => !plannedKeys.has(key))
    const pending = built.unresolved.filter((key) => plannedKeys.has(key))
    if (missing.length) return finish('technicalRefusal', { reason: `цели связей нет в снимке: ${missing.join(', ')}` })
    if (!built.document) return finish('technicalRefusal', { reason: 'предложение без охвата и связей' })
    const current = readPoiGeographyDocument(record.fields, row.existingPoiId)
    if (current.error) return finish('technicalRefusal', { reason: `текущий документ повреждён: ${current.error}` })
    if (!row.sourcesFetched) return finish('insufficientEvidence', { reason: diagnostics[0], dependsOn: pending })
    if (pending.length) return finish('technicalRefusal', { reason: `сначала создайте цели связей и обновите снимок: ${pending.join(', ')}`, dependsOn: pending, blockedBySchema: schemaState !== 'present' })
    built.document = mergePoiGeographyDocument(current.document, built.document, row.existingPoiId)
    const strip = (d) => d && JSON.stringify({ ...d, updatedAt: null })
    if (!pending.length && current.document && strip(current.document) === strip(built.document)) {
      return finish('alreadyMatches', { recordId: record.recordId, reason: 'документ уже записан и совпадает по содержанию' })
    }
    const next = serializePoiGeographyDocument(built.document, row.existingPoiId)
    return finish('create', {
      recordId: record.recordId,
      blockedBySchema: schemaState !== 'present',
      parentKey: row.parentKey,
      /* Связи на ещё не созданный родитель дописываются на записи, когда он
         появится; здесь они названы, а не выдуманы с пустыми идентификаторами. */
      dependsOn: pending,
      old: { [POI_GEOGRAPHY_FIELD]: typeof record.fields[POI_GEOGRAPHY_FIELD] === 'string' ? record.fields[POI_GEOGRAPHY_FIELD] : null, 'Parent POI': record.fields['Parent POI'] ?? null },
      new: { [POI_GEOGRAPHY_FIELD]: next },
      newDigest: sha256Bytes(Buffer.from(next, 'utf8')),
    })
  })
  const counts = Object.fromEntries(DATA_OUTCOMES.map((o) => [o, results.filter((r) => r.outcome === o).length]))
  const total = DATA_OUTCOMES.reduce((n, o) => n + counts[o], 0)
  assert.equal(total, proposals.rows.length, 'закон сохранения: сумма исходов равна числу предложений')
  for (const r of results) assert(DATA_OUTCOMES.includes(r.outcome), 'исход вне закрытого списка')
  return { counts, rows: results }
}

/** Проверка частичного исполнения: тот же отчёт на свежем снимке. */
export function verifyApplied(previousReport, base) {
  const rows = baseRows(base)
  const byRecord = new Map(rows.map((r) => [r.recordId, r]))
  return previousReport.data.rows.filter((r) => r.outcome === 'create').map((r) => {
    const fresh = byRecord.get(r.recordId)
    if (!fresh) return { recordId: r.recordId, state: 'missing' }
    const value = typeof fresh.fields[POI_GEOGRAPHY_FIELD] === 'string' ? fresh.fields[POI_GEOGRAPHY_FIELD] : null
    if (value === r.new[POI_GEOGRAPHY_FIELD]) return { recordId: r.recordId, state: 'applied' }
    if (value === r.old[POI_GEOGRAPHY_FIELD]) return { recordId: r.recordId, state: 'notApplied' }
    return { recordId: r.recordId, state: 'drifted' }
  })
}

export function renderMarkdown(report) {
  const lines = [`# Миграция охвата и связей — отчёт ${report.today}`, '', `Схема: поле «${POI_GEOGRAPHY_FIELD}» — **${report.schema.state}**. ${report.schema.postcondition}.`, '']
  if (report.schema.request) lines.push('Запрос создания поля (исполняется только по отдельной карточке после аудита):', '', '```json', JSON.stringify(report.schema.request, null, 2), '```', '')
  lines.push(`Данные: предложений ${report.data.rows.length}; ${DATA_OUTCOMES.map((o) => `${o} ${report.data.counts[o]}`).join(', ')}.`, '')
  lines.push('| Предмет | Исход | Причина / изменение |', '|---|---|---|')
  for (const r of report.data.rows) {
    const what = r.outcome === 'create' ? `${POI_GEOGRAPHY_FIELD}: ${r.old[POI_GEOGRAPHY_FIELD] ? 'заменить' : 'пусто'} → ${r.newDigest.slice(0, 23)}${r.blockedBySchema ? ' (ждёт поля в схеме)' : ''}` : r.reason
    lines.push(`| ${r.existingPoiId ?? r.sourceKey} | ${r.outcome} | ${what.replace(/\|/g, '\\|')} |`)
  }
  lines.push('', 'Записей в этом прогоне: 0. Сеть: 0.')
  return `${lines.join('\n')}\n`
}

export async function runPrepare(argv = process.argv) {
  const options = {}
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    assert(['--schema', '--base', '--proposals', '--out', '--today', '--verify'].includes(flag), `Unknown option ${flag}`)
    const value = argv[++i]; assert(value && !value.startsWith('--'), `Missing value for ${flag}`)
    options[flag.slice(2)] = value
  }
  assert(options.schema && options.base && options.proposals && options.out, 'Usage: --schema FILE --base FILE --proposals FILE --out DIR [--today YYYY-MM-DD] [--verify PRIOR_REPORT]')
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  assert(isStrictCalendarDate(today), 'today must be a calendar date')
  const schemaRaw = JSON.parse(await readFile(options.schema, 'utf8'))
  const schema = schemaPlan(schemaRaw.tables ?? schemaRaw)
  const proposals = parseProposals(JSON.parse(await readFile(options.proposals, 'utf8')))
  const base = JSON.parse(await readFile(options.base, 'utf8'))
  const data = dataPlan({ proposals, base, today, schemaState: schema.state })
  const report = { spec: MIGRATION_REPORT_SPEC, today, inputs: {
    schema: { file: options.schema, digest: sha256Bytes(await readFile(options.schema)) },
    base: { file: options.base, digest: sha256Bytes(await readFile(options.base)) },
    proposals: { file: options.proposals, digest: sha256Bytes(await readFile(options.proposals)), note: proposals.note },
  }, schema, data, effects: { network: 0, post: 0, patch: 0, delete: 0 } }
  if (options.verify) report.verification = verifyApplied(JSON.parse(await readFile(options.verify, 'utf8')), base)
  const dir = path.resolve(options.out)
  await mkdir(dir) // никогда не поверх чужого прогона
  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  await writeFile(path.join(dir, 'report.md'), renderMarkdown(report), { flag: 'wx' })
  console.log(`схема: ${schema.state}; данные: ${DATA_OUTCOMES.map((o) => `${o} ${data.counts[o]}`).join(', ')}; записей 0; отчёт ${dir}`)
  return { report, exitCode: 0 }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  try { process.exitCode = (await runPrepare()).exitCode } catch (e) { console.error(e.message); process.exitCode = 1 }
}
