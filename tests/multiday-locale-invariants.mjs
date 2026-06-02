#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = process.cwd()
const require = createRequire(import.meta.url)
const failures = []
const passes = []
const skips = []

function pass(message) {
  passes.push(message)
}

function fail(message) {
  failures.push(message)
}

function skip(message) {
  skips.push(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

function assertIncludes(text, needle, message) {
  assert(text.includes(needle), message)
}

function assertNotIncludes(text, needle, message) {
  assert(!text.includes(needle), message)
}

function assertNoRegex(text, regex, message) {
  assert(!regex.test(text), message)
}

const runtimeFiles = [
  'src/lib/multi-day-builder.ts',
  'src/lib/multi-day-builder-storage.ts',
  'src/lib/multi-day-builder-data.ts',
  'src/components/admin/MultiDayBuilderWorkspace.tsx',
  'src/app/api/admin/multi-day/route/route.ts',
  'src/app/api/admin/multi-day/cities/route.ts',
  'src/app/api/admin/multi-day/pois/route.ts',
]

const runtimeSource = runtimeFiles.map((file) => `\n// ${file}\n${read(file)}`).join('\n')
const builderSource = read('src/lib/multi-day-builder.ts')
const storageSource = read('src/lib/multi-day-builder-storage.ts')
const workspaceSource = read('src/components/admin/MultiDayBuilderWorkspace.tsx')

assertNoRegex(runtimeSource, /tokyo-hokkaido-autotour|hokkaido/i, 'runtime multi-day code has no route-specific Hokkaido hardcode')
assertNoRegex(runtimeSource, /None минут|около\s+None\s+минут/i, 'runtime code cannot emit `None минут`')

assertIncludes(builderSource, 'dayTitleEn: string', 'day model has first-class EN title')
assertIncludes(builderSource, 'daySummaryEn: string', 'day model has first-class EN summary')
assertIncludes(builderSource, 'displayTitleEn: string', 'day item model has first-class EN title')
assertIncludes(builderSource, 'shortDescriptionEn: string', 'day item model has first-class EN description')
assertIncludes(builderSource, 'displayLabelEn: string', 'transport segment model has first-class EN display label')

assertIncludes(storageSource, "'Day Title (EN)': day.dayTitleEn", 'storage writes day EN title')
assertIncludes(storageSource, "'Day Summary (EN)': day.daySummaryEn", 'storage writes day EN summary')
assertIncludes(storageSource, "'Display Title (EN)': item.displayTitleEn", 'storage writes item EN title')
assertIncludes(storageSource, "'Short Description (EN)': item.shortDescriptionEn", 'storage writes item EN description')
assertIncludes(storageSource, "'Display Label (EN)': segment.displayLabelEn", 'storage writes transport EN display label')
assertIncludes(storageSource, "dayTitleEn: getText(record.fields, 'Day Title (EN)')", 'storage reads day EN title')
assertIncludes(storageSource, "displayTitleEn: getText(record.fields, 'Display Title (EN)')", 'storage reads item EN title')
assertIncludes(storageSource, "displayLabelEn: getText(record.fields, 'Display Label (EN)')", 'storage reads transport EN display label')
assertNotIncludes(storageSource, "|| 'Transport block'", 'RU transport display label does not fall back to English')
assertIncludes(storageSource, "|| 'Блок транспорта'", 'RU transport display label falls back to Russian')

assertNotIncludes(workspaceSource, 'poi.nameRu || poi.nameEn', 'multi-day admin POI visible/add path does not fall back from RU to EN')
assertNotIncludes(workspaceSource, '>Day Blocks<', 'multi-day admin does not render English `Day Blocks` label')
assertIncludes(workspaceSource, 'displayTitle: poi.nameRu || poi.poiId', 'added POIs use RU title or neutral POI id')
assertIncludes(workspaceSource, 'displayTitleEn: poi.nameEn || poi.poiId', 'added POIs preserve EN title separately')

function loadBuilderModule() {
  const transpiled = ts.transpileModule(builderSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: 'multi-day-builder.ts',
  }).outputText

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    Math,
    Date,
  }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(transpiled, sandbox, { filename: 'multi-day-builder.js' })
  return sandbox.module.exports
}

try {
  const { buildMultiDaySkeleton } = loadBuilderModule()
  const route = buildMultiDaySkeleton({
    titleRu: 'Тестовый маршрут',
    titleEn: 'test-route',
    dayCount: 3,
    startCityId: 'tokyo',
    startCityLabel: 'Токио',
    endCityId: 'kyoto',
    endCityLabel: 'Киото',
  })
  const visibleRu = []
  const visibleEn = []
  for (const day of route.days) {
    visibleRu.push(day.dayTitle, day.daySummary)
    visibleEn.push(day.dayTitleEn, day.daySummaryEn)
    for (const item of day.items) {
      visibleRu.push(item.displayTitle, item.shortDescription)
      visibleEn.push(item.displayTitleEn, item.shortDescriptionEn)
    }
    for (const segment of day.transportSegments) {
      visibleRu.push(segment.displayLabel)
      visibleEn.push(segment.displayLabelEn)
    }
  }

  assert(visibleRu.some((value) => /[А-Яа-яЁё]/.test(value)), 'skeleton RU visible fields are populated in Russian')
  assert(visibleEn.some((value) => /[A-Za-z]/.test(value)), 'skeleton EN fields are populated separately')
  assert(!visibleRu.some((value) => /None минут/.test(value)), 'skeleton RU fields do not contain `None минут`')
  assert(!visibleRu.includes('Transport block'), 'skeleton RU transport label is not English')
  assert(visibleEn.includes('Transport block'), 'skeleton EN transport label is stored separately')
} catch (error) {
  fail(`builder smoke test failed: ${error instanceof Error ? error.message : String(error)}`)
}

const token = process.env.AIRTABLE_TOKEN?.trim()
const baseId = process.env.AIRTABLE_BASE_ID?.trim()

async function airtableFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.json()
}

async function fetchAll(tableName, formula) {
  const records = []
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`)
  url.searchParams.set('pageSize', '100')
  if (formula) url.searchParams.set('filterByFormula', formula)
  let offset
  do {
    if (offset) url.searchParams.set('offset', offset)
    else url.searchParams.delete('offset')
    const data = await airtableFetch(url.toString())
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  return records
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

if (!token || !baseId) {
  skip('Airtable live checks skipped: AIRTABLE_TOKEN/AIRTABLE_BASE_ID are not set')
} else {
  try {
    const meta = await airtableFetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`)
    const fieldsByTable = new Map(meta.tables.map((table) => [table.name, new Set(table.fields.map((field) => field.name))]))
    const requiredFields = {
      'Route Days': ['Day Title', 'Day Title (EN)', 'Day Summary', 'Day Summary (EN)'],
      'Day Items': ['Display Title', 'Display Title (EN)', 'Short Description', 'Short Description (EN)'],
      'Transport Segments': ['Display Label', 'Display Label (EN)'],
    }
    for (const [table, fields] of Object.entries(requiredFields)) {
      const tableFields = fieldsByTable.get(table)
      assert(Boolean(tableFields), `Airtable table exists: ${table}`)
      for (const field of fields) {
        assert(Boolean(tableFields?.has(field)), `Airtable field exists: ${table}.${field}`)
      }
    }

    const routes = await fetchAll('Routes', `{Route Type}='multi-day'`)
    const routeSlugs = routes.map((record) => text(record.fields.Slug)).filter(Boolean)
    assert(routeSlugs.length > 0, 'Airtable has at least one multi-day route to verify')

    let noneFindings = 0
    let enLeakFindings = 0
    for (const slug of routeSlugs) {
      const formula = `{Route Slug}='${slug.replace(/'/g, "\\'")}'`
      const [days, items, segments] = await Promise.all([
        fetchAll('Route Days', formula),
        fetchAll('Day Items', formula),
        fetchAll('Transport Segments', formula),
      ])
      for (const record of days) {
        const visible = `${text(record.fields['Day Title'])} ${text(record.fields['Day Summary'])}`
        if (/None минут/i.test(visible)) noneFindings += 1
        if (/[A-Za-z]/.test(visible)) enLeakFindings += 1
      }
      for (const record of items) {
        const visible = `${text(record.fields['Display Title'])} ${text(record.fields['Short Description'])}`
        if (/None минут/i.test(visible)) noneFindings += 1
        if (/[A-Za-z]/.test(visible)) enLeakFindings += 1
      }
      for (const record of segments) {
        const visible = text(record.fields['Display Label'])
        if (/None минут/i.test(visible)) noneFindings += 1
        if (visible === 'Transport block') enLeakFindings += 1
      }
    }
    assert(noneFindings === 0, 'Airtable multi-day RU-visible fields have no `None минут`')
    assert(enLeakFindings === 0, 'Airtable multi-day RU-visible fields have no Latin/English visible leaks')
  } catch (error) {
    fail(`Airtable live checks failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`multi-day locale invariant tests: ${passes.length} passed, ${skips.length} skipped, ${failures.length} failed`)
for (const message of passes) console.log(`✓ ${message}`)
for (const message of skips) console.log(`- ${message}`)
for (const message of failures) console.error(`✗ ${message}`)

if (failures.length > 0) process.exit(1)
