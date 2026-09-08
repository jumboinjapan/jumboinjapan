#!/usr/bin/env node
/**
 * ПРОИЗВОДНЫЕ ФИКСТУРЫ JG‑1: ИЗ ЗАКРЫТЫХ ПОЛНЫХ ВЫГРУЗОК — В РЕПОЗИТОРИЙ.
 *
 *   npm run poi:jg-fixtures -- --snapshot tmp/japan-guide-discovery-2026-09-06.json \
 *     --airtable tmp/airtable-poi-export-2026-09-06.json --out-dir docs/poi-intake/baselines
 *
 * ЗАЧЕМ. Аудит 10h‑D предъявил два довода, и оба верны. Полный снимок обхода
 * Japan Guide несёт 6 880 факт‑лидов — извлечённые часы, цены и выдержки
 * страниц чужого сайта: складывать их массивом в ПУБЛИЧНЫЙ репозиторий не
 * следует, а JG‑1 ими не пользуется вовсе. Живая выгрузка Airtable несёт
 * настоящие `recordId` рабочей базы: тесту они безразличны, а в открытом
 * репозитории это внутренние идентификаторы.
 *
 * ЧТО ДЕЛАЕТ. Из полных выгрузок (они остаются ВНЕ репозитория) выводит два
 * детерминированных файла и манифест на них:
 *
 *   · снимок `poi-discovery-snapshot/v3` с теми же 1 140 записями, но без
 *     `factLeads` и `omissions`. Остаются ровно те поля, которыми пользуется
 *     JG‑1: ключ, адрес, английское имя, размещения (регион, позиция,
 *     категория), порядок коллекций, свидетельства страниц и контрольные
 *     отпечатки. Снимок пересобирается настоящим `buildDiscoverySnapshot`,
 *     поэтому `snapshotDigest` и все записи — не переписанные литералы, а
 *     заново вычисленные значения, проходящие полный контракт;
 *   · выгрузку `poi-airtable-export/v1` с теми же строками, но с
 *     синтетическими `recordId` (детерминированно из `POI ID`) и без
 *     `createdTime`. Поля matcher’а — имена, ключ, сайт, город, `POI ID`,
 *     служебность — сохраняются: без них «не найдено» означало бы «мы не
 *     спрашивали»;
 *   · манифест `poi-jg1-fixture-manifest/v1`: дата, число записей и SHA‑256
 *     ОБОИХ исходников и обеих фикстур. Полные выгрузки доказуемы отпечатком,
 *     не присутствием.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не ходит в сеть, не читает Airtable, не решает, что заводить.
 * Результаты очередей JG‑1 от минимизации не меняются: ни одно решение не
 * читает ни факт‑лид, ни `recordId` — и это проверяется тестом.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDirectEntry } from '../lib/direct-entry.mjs'
import {
  assertDiscoverySnapshot,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
} from './lib/discovery-contract.mjs'
import { canonicalGzip, readCanonicalGzip } from './lib/discovery-baseline.mjs'
import { assertAirtableExport } from './lib/discovery-airtable-match.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const JG1_FIXTURE_MANIFEST_SPEC = 'poi-jg1-fixture-manifest/v1'
/** Поля записи discovery, которые фикстура НЕ несёт. */
export const DROPPED_RECORD_FIELDS = Object.freeze(['factLeads', 'omissions'])
/** Поля строки выгрузки, которые фикстура НЕ несёт. */
export const DROPPED_EXPORT_FIELDS = Object.freeze(['createdTime'])
/** Соль синтетических идентификаторов — часть правила, а не секрет. */
export const SYNTHETIC_RECORD_SALT = 'jg1-fixture:'

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const posixJoin = (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`

/**
 * Синтетический `recordId` из `POI ID`.
 *
 * Форма — та же, что у Airtable (`rec` и 14 знаков), иначе выгрузку не примет
 * её собственный контракт. Значение — детерминированное: одна и та же строка
 * базы получает один и тот же идентификатор в любом прогоне, и фикстуру можно
 * сравнивать построчно. Обратно к живому `recordId` оно не ведёт.
 */
export function syntheticRecordId(poiId) {
  return `rec${createHash('sha256').update(`${SYNTHETIC_RECORD_SALT}${poiId}`).digest('hex').slice(0, 14)}`
}

/** Снимок из документа прогона коллектора или из голого снимка. */
export function snapshotFromRunDocument(doc) {
  if (doc && Array.isArray(doc.portals)) {
    const portal = doc.portals.find((p) => p?.portalId === 'japan-guide' && p?.discovery)
    if (!portal) throw new Error('в файле прогона нет discovery портала japan-guide')
    return portal.discovery
  }
  return doc
}

/**
 * Полный снимок → снимок только с полями JG‑1.
 *
 * Пересборка идёт через настоящие строители контракта: запись собирает
 * `buildDiscoveryRecord`, снимок — `buildDiscoverySnapshot`, и он же его
 * проверяет. Счётчики извлечения (`unknownAdmissionLabels`,
 * `emptyAdmissionValues`) обнуляются: лидов в фикстуре нет, и оставить их
 * прежними значило бы утверждать про фикстуру измерение чужого прогона.
 */
export function deriveJg1Snapshot(snapshot) {
  assertDiscoverySnapshot(snapshot)
  const records = snapshot.records.map((record) => buildDiscoveryRecord({
    sourceKey: record.sourceKey,
    url: record.url,
    nameEn: record.nameEn,
    placements: record.placements,
    factLeads: [],
    omissions: [],
    pageEvidence: record.pageEvidence,
  }))
  return buildDiscoverySnapshot({
    scope: snapshot.scope,
    entryUrl: snapshot.entryUrl,
    incompleteReasons: snapshot.incompleteReasons,
    networkPolicy: snapshot.networkPolicy,
    robotsEvidence: snapshot.robotsEvidence,
    catalogueEvidence: snapshot.catalogueEvidence,
    catalogueTargetEvidence: snapshot.catalogueTargetEvidence,
    nestedCollectionEvidence: snapshot.nestedCollectionEvidence,
    orderRecords: snapshot.orderRecords,
    records,
    rejected: snapshot.rejected,
    counters: { ...snapshot.counters, unknownAdmissionLabels: 0, emptyAdmissionValues: 0 },
  })
}

/**
 * Живая выгрузка → детерминированная фикстура.
 *
 * Строки сохраняются все, включая служебные (`isSystem`): сопоставление их
 * отбрасывает само, и выкинуть их здесь значило бы проверять не тот отбор.
 *
 * ПОРЯДОК СТРОК СОХРАНЯЕТСЯ ИСХОДНЫЙ, и это не мелочь. Пересортировка по
 * `POI ID` выглядела опрятнее, но пробная минимизация показала: у общего
 * matcher’а список совпадений по имени зависит от порядка строк — при равных
 * оценках в срез попадают разные записи. Ни одну ОЧЕРЕДЬ это не меняет (строка
 * всё равно уходит в `review` как «имя без независимого признака»), но
 * справочный список `nameMatches` у 14 строк расходился бы с принятым отчётом
 * без всякой на то причины. Фикстура минимизирует состав полей, а не
 * переставляет строки.
 */
export function deriveJg1AirtableExport(live, { note }) {
  assertAirtableExport(live)
  const rows = live.records
  const seen = new Set()
  const records = rows.map((row) => {
    const recordId = syntheticRecordId(row.poiId)
    if (seen.has(recordId)) throw new Error(`${JG1_FIXTURE_MANIFEST_SPEC}: синтетический идентификатор ${recordId} выпал дважды`)
    seen.add(recordId)
    const out = { recordId }
    for (const field of live.fields) {
      if (row[field] !== undefined) out[field] = row[field]
    }
    return out
  })
  const fixture = {
    contractVersion: live.contractVersion,
    note,
    baseId: live.baseId,
    tableId: live.tableId,
    fetchedAt: live.fetchedAt,
    fields: [...live.fields],
    totalRecordCount: records.length,
    records,
  }
  assertAirtableExport(fixture)
  return fixture
}

/** Манифест: дата, количество записей и отпечатки исходников и фикстур. */
export function buildJg1FixtureManifest({ derivedAt, label, discovery, airtable }) {
  return {
    contractVersion: JG1_FIXTURE_MANIFEST_SPEC,
    label: `japan-guide-jg1-fixtures-${label ?? derivedAt}`,
    note: 'Производные фикстуры JG‑1. Полные выгрузки (снимок обхода и живая выгрузка Airtable) '
      + 'в репозитории НЕ хранятся: они остаются в закрытом хранилище и доказуемы отпечатками ниже.',
    derivedAt,
    discovery,
    airtable,
  }
}

/** Точная форма манифеста — проверяется и при записи, и при чтении. */
export function assertJg1FixtureManifest(doc, where = JG1_FIXTURE_MANIFEST_SPEC) {
  const digest = (value, at) => {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new TypeError(`${at}: ожидается отпечаток вида sha256:<64 hex>, получено ${JSON.stringify(value)}`)
    }
  }
  const count = (value, at) => {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`${at}: ожидается целое ≥ 0`)
  }
  const text = (value, at) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${at}: ожидается непустая строка`)
  }
  const exact = (value, keys, at) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${at}: ожидается объект`)
    const got = Object.keys(value).sort()
    const want = [...keys].sort()
    if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
      throw new TypeError(`${at}: ключи ${got.join(', ')} при ожидаемых ${want.join(', ')}`)
    }
  }
  exact(doc, ['contractVersion', 'label', 'note', 'derivedAt', 'discovery', 'airtable'], where)
  if (doc.contractVersion !== JG1_FIXTURE_MANIFEST_SPEC) {
    throw new TypeError(`${where}.contractVersion: ожидается «${JG1_FIXTURE_MANIFEST_SPEC}»`)
  }
  text(doc.label, `${where}.label`)
  text(doc.note, `${where}.note`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.derivedAt)) throw new TypeError(`${where}.derivedAt: ожидается дата вида 2026-09-08`)

  exact(doc.discovery, ['source', 'derived', 'droppedFields'], `${where}.discovery`)
  exact(doc.discovery.source, ['storage', 'documentBytes', 'documentDigest', 'records', 'snapshotDigest'], `${where}.discovery.source`)
  text(doc.discovery.source.storage, `${where}.discovery.source.storage`)
  count(doc.discovery.source.documentBytes, `${where}.discovery.source.documentBytes`)
  digest(doc.discovery.source.documentDigest, `${where}.discovery.source.documentDigest`)
  count(doc.discovery.source.records, `${where}.discovery.source.records`)
  digest(doc.discovery.source.snapshotDigest, `${where}.discovery.source.snapshotDigest`)
  exact(doc.discovery.derived, ['path', 'encoding', 'records', 'snapshotDigest', 'compressedBytes', 'compressedDigest', 'decompressedBytes', 'decompressedDigest'], `${where}.discovery.derived`)
  text(doc.discovery.derived.path, `${where}.discovery.derived.path`)
  if (doc.discovery.derived.encoding !== 'gzip') throw new TypeError(`${where}.discovery.derived.encoding: ожидается «gzip»`)
  count(doc.discovery.derived.records, `${where}.discovery.derived.records`)
  digest(doc.discovery.derived.snapshotDigest, `${where}.discovery.derived.snapshotDigest`)
  count(doc.discovery.derived.compressedBytes, `${where}.discovery.derived.compressedBytes`)
  digest(doc.discovery.derived.compressedDigest, `${where}.discovery.derived.compressedDigest`)
  count(doc.discovery.derived.decompressedBytes, `${where}.discovery.derived.decompressedBytes`)
  digest(doc.discovery.derived.decompressedDigest, `${where}.discovery.derived.decompressedDigest`)
  if (!Array.isArray(doc.discovery.droppedFields) || doc.discovery.droppedFields.some((f) => typeof f !== 'string')) {
    throw new TypeError(`${where}.discovery.droppedFields: ожидается список строк`)
  }
  if (doc.discovery.source.records !== doc.discovery.derived.records) {
    throw new TypeError(`${where}.discovery: производный снимок несёт ${doc.discovery.derived.records} записей при ${doc.discovery.source.records} исходных — минимизация не теряет строк`)
  }

  exact(doc.airtable, ['source', 'derived', 'droppedFields', 'recordIdRule'], `${where}.airtable`)
  exact(doc.airtable.source, ['storage', 'documentBytes', 'documentDigest', 'records', 'fetchedAt'], `${where}.airtable.source`)
  text(doc.airtable.source.storage, `${where}.airtable.source.storage`)
  count(doc.airtable.source.documentBytes, `${where}.airtable.source.documentBytes`)
  digest(doc.airtable.source.documentDigest, `${where}.airtable.source.documentDigest`)
  count(doc.airtable.source.records, `${where}.airtable.source.records`)
  text(doc.airtable.source.fetchedAt, `${where}.airtable.source.fetchedAt`)
  exact(doc.airtable.derived, ['path', 'encoding', 'records', 'bytes', 'digest'], `${where}.airtable.derived`)
  text(doc.airtable.derived.path, `${where}.airtable.derived.path`)
  if (doc.airtable.derived.encoding !== 'utf-8') throw new TypeError(`${where}.airtable.derived.encoding: ожидается «utf-8»`)
  count(doc.airtable.derived.records, `${where}.airtable.derived.records`)
  count(doc.airtable.derived.bytes, `${where}.airtable.derived.bytes`)
  digest(doc.airtable.derived.digest, `${where}.airtable.derived.digest`)
  if (!Array.isArray(doc.airtable.droppedFields) || doc.airtable.droppedFields.some((f) => typeof f !== 'string')) {
    throw new TypeError(`${where}.airtable.droppedFields: ожидается список строк`)
  }
  text(doc.airtable.recordIdRule, `${where}.airtable.recordIdRule`)
  if (doc.airtable.source.records !== doc.airtable.derived.records) {
    throw new TypeError(`${where}.airtable: фикстура несёт ${doc.airtable.derived.records} строк при ${doc.airtable.source.records} исходных`)
  }
  return doc
}

export function parseFixtureArgs(argv) {
  const args = { snapshot: null, airtable: null, outDir: 'docs/poi-intake/baselines', label: null }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a}: нужен аргумент`)
      i += 1
      return v
    }
    if (a === '--snapshot') args.snapshot = next()
    else if (a === '--airtable') args.airtable = next()
    else if (a === '--out-dir') args.outDir = next()
    else if (a === '--label') args.label = next()
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (!args.snapshot || !args.airtable) throw new Error('Нужны --snapshot <полный прогон> и --airtable <живая выгрузка>')
  return args
}

export async function runFixtureCli(argv = process.argv, deps = {}, target = process) {
  const now = deps.now ?? (() => new Date())
  try {
    const args = parseFixtureArgs(argv)
    const derivedAt = now().toISOString().slice(0, 10)
    const label = args.label ?? derivedAt

    const snapshotBytes = await readFile(path.resolve(args.snapshot))
    const source = snapshotFromRunDocument(JSON.parse(snapshotBytes.toString('utf8')))
    const derivedSnapshot = deriveJg1Snapshot(source)
    const snapshotJson = Buffer.from(`${JSON.stringify(derivedSnapshot, null, 2)}\n`, 'utf8')
    const snapshotGz = canonicalGzip(snapshotJson)
    const snapshotRel = `japan-guide-jg1-${label}.snapshot.json.gz`
    await writeFile(path.resolve(args.outDir, snapshotRel), snapshotGz)
    /* Круговая проверка: записанный файл разворачивается в тот же снимок. */
    assertDiscoverySnapshot(JSON.parse(readCanonicalGzip(snapshotGz).toString('utf8')))

    const liveBytes = await readFile(path.resolve(args.airtable))
    const live = JSON.parse(liveBytes.toString('utf8'))
    const fixture = deriveJg1AirtableExport(live, {
      note: `Deterministic JG-1 fixture derived from the read-only export of ${live.fetchedAt}; record ids synthetic`,
    })
    const fixtureJson = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    const fixtureRel = `airtable-poi-jg1-fixture-${label}.json`
    await writeFile(path.resolve(args.outDir, fixtureRel), fixtureJson)

    const manifest = buildJg1FixtureManifest({
      derivedAt,
      label,
      discovery: {
        source: {
          storage: 'закрытое хранилище вне репозитория (полный прогон коллектора)',
          documentBytes: snapshotBytes.length,
          documentDigest: sha256(snapshotBytes),
          records: source.records.length,
          snapshotDigest: source.snapshotDigest,
        },
        derived: {
          path: posixJoin(args.outDir, snapshotRel),
          encoding: 'gzip',
          records: derivedSnapshot.records.length,
          snapshotDigest: derivedSnapshot.snapshotDigest,
          compressedBytes: snapshotGz.length,
          compressedDigest: sha256(snapshotGz),
          decompressedBytes: snapshotJson.length,
          decompressedDigest: sha256(snapshotJson),
        },
        droppedFields: [...DROPPED_RECORD_FIELDS],
      },
      airtable: {
        source: {
          storage: 'закрытое хранилище вне репозитория (живая выгрузка только на чтение)',
          documentBytes: liveBytes.length,
          documentDigest: sha256(liveBytes),
          records: live.records.length,
          fetchedAt: live.fetchedAt,
        },
        derived: {
          path: posixJoin(args.outDir, fixtureRel),
          encoding: 'utf-8',
          records: fixture.records.length,
          bytes: fixtureJson.length,
          digest: sha256(fixtureJson),
        },
        droppedFields: [...DROPPED_EXPORT_FIELDS],
        recordIdRule: `recordId = «rec» и первые 14 знаков sha256(«${SYNTHETIC_RECORD_SALT}» + POI ID); к живым идентификаторам не ведёт`,
      },
    })
    assertJg1FixtureManifest(manifest)
    const manifestRel = `japan-guide-jg1-fixtures-${label}.manifest.json`
    await writeFile(path.resolve(args.outDir, manifestRel), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    console.log(`снимок JG-1: ${snapshotRel} — записей ${derivedSnapshot.records.length}, ${snapshotGz.length} байт сжатых из ${snapshotJson.length}`)
    console.log(`выгрузка JG-1: ${fixtureRel} — строк ${fixture.records.length}, ${fixtureJson.length} байт`)
    console.log(`манифест: ${manifestRel}`)
    target.exitCode = 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-jg-fixtures] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  await runFixtureCli()
}
