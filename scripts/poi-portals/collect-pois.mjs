#!/usr/bin/env node
/**
 * Коллектор POI с туристических порталов и открытых данных Японии.
 *
 *   node scripts/poi-portals/collect-pois.mjs --portal bodik-osaka-tourism
 *   node scripts/poi-portals/collect-pois.mjs --portal bodik-kyoto-tourism --limit 300
 *   node scripts/poi-portals/collect-pois.mjs --all --out tmp/poi-run.json
 *   node scripts/poi-portals/collect-pois.mjs --portal ... --monitor tmp/prev.json
 *
 * Dry-run по умолчанию. Запись включается флагом --write и идёт ТОЛЬКО
 * через ingestPoi из src/lib/poi-ingest.ts — канон, идемпотентность по
 * Source Key, гейт дублей, черновик. Собственного пути записи у коллектора
 * нет и быть не должно.
 *
 * Русское имя собирается транслитерацией по Поливанову из английского
 * названия (src/lib/polivanov.ts): «Todai-ji Temple» → «Храм Тодайдзи».
 * Родовое слово переводится, ядро транслитерируется, заимствования
 * остаются латиницей — так же, как владелец пишет их сам.
 *
 * Каждое собранное имя помечается в Notes как машинное. Запись всё равно
 * черновик, но отличить «имя выбрал человек» от «имя собрал скрипт» потом
 * можно будет только по этой отметке — поэтому она ставится всегда.
 *
 * Файл --names остаётся: имя оттуда ПЕРЕОПРЕДЕЛЯЕТ машинное. Сверка
 * транслитератора с живой базой — npm run check:polivanov.
 *
 * Режим --monitor сравнивает прогон с предыдущим снимком и показывает, что
 * изменилось у источника: закрытия, смена часов, новые и пропавшие объекты.
 * Это и есть «мониторинг» — то, ради чего источник вообще подключается
 * повторно, а не один раз.
 */

import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import nextEnv from '@next/env'
import { ingestPoiBatch } from '../../src/lib/poi-ingest.ts'
import { poiNameToRu, poiNameFromKana } from '../../src/lib/polivanov.ts'
import { resolveSiteCity } from '../../src/lib/jp-address.ts'
import { assertNameCoverage, describeNameCoverage, loadNames } from './lib/names-file.mjs'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
import { activePortals, getPortal } from './registry.mjs'
import { collectFromOpenDataCsv } from './lib/opendata-csv.mjs'
import { evaluatePoiCandidate } from './lib/scoring.mjs'
import { dedupeWithinBatch, matchAgainstExisting } from './lib/dedupe.mjs'
import { estimateCascadeCost } from './lib/enrich.mjs'
/* Единственный разрешённый импорт моста совместимости: только здесь, только
   для подготовки полей старого Airtable. См. заголовок самого моста. */
import { legacyAirtableCategory } from './lib/legacy-airtable-category-bridge.mjs'
import { isRouteToPoi, poiWritableDecision, TERMINAL } from './lib/classification-contract.mjs'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

/** Границы регионов — грубые, задача только отловить координаты «не туда». */
const REGION_BBOX = {
  tokyo: { minLat: 35.5, maxLat: 35.9, minLon: 139.3, maxLon: 139.95 },
  osaka: { minLat: 34.2, maxLat: 35.1, minLon: 135.0, maxLon: 135.8 },
  kyoto: { minLat: 34.7, maxLat: 35.8, minLon: 134.8, maxLon: 136.1 },
  uji: { minLat: 34.7, maxLat: 35.0, minLon: 135.7, maxLon: 136.0 },
  nara: { minLat: 33.8, maxLat: 34.8, minLon: 135.6, maxLon: 136.2 },
  hakone: { minLat: 35.1, maxLat: 35.35, minLon: 138.9, maxLon: 139.15 },
  kamakura: { minLat: 35.28, maxLat: 35.36, minLon: 139.48, maxLon: 139.58 },
  nikko: { minLat: 36.6, maxLat: 37.2, minLon: 139.2, maxLon: 139.9 },
  kanazawa: { minLat: 36.4, maxLat: 36.7, minLon: 136.5, maxLon: 136.8 },
  hiroshima: { minLat: 34.0, maxLat: 34.9, minLon: 132.0, maxLon: 133.5 },
}

const ADAPTERS = {
  'opendata-csv': collectFromOpenDataCsv,
}

function parseArgs(argv) {
  const args = {
    portal: null,
    all: false,
    limit: null,
    write: false,
    dryWrite: false,
    baseSnapshot: null,
    out: null,
    monitor: null,
    existing: null,
    names: null,
    samples: 8,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    if (a === '--portal') args.portal = next()
    else if (a === '--all') args.all = true
    else if (a === '--limit') args.limit = Number(next())
    else if (a === '--write') args.write = true
    // Полный конвейер записи против настоящего снимка базы, но без
    // создания записей: так видно реальные исходы гейта до первой правки.
    else if (a === '--dry-write') { args.write = true; args.dryWrite = true }
    else if (a === '--out') args.out = next()
    else if (a === '--monitor') args.monitor = next()
    else if (a === '--existing') args.existing = next()
    else if (a === '--names') args.names = next()
    // Снимок базы файлом. Прогон без записи не должен требовать ключей
    // НА ЗАПИСЬ — иначе посмотреть, что сделает гейт, можно только имея
    // право всё испортить.
    else if (a === '--base-snapshot') { args.baseSnapshot = next(); args.dryWrite = true; args.write = true }
    else if (a === '--samples') args.samples = Number(next())
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`Неизвестный аргумент: ${a}`)
  }
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit должен быть положительным числом')
  }
  return args
}

async function loadExisting(file) {
  if (!file) return []
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : (parsed.records ?? [])
  } catch (error) {
    console.error(`[poi-portals] не удалось прочитать --existing ${file}: ${error.message}`)
    return []
  }
}

async function runPortal(portal, args) {
  const adapter = ADAPTERS[portal.adapter]
  if (!adapter) {
    return { portalId: portal.id, skipped: `адаптер «${portal.adapter}» ещё не реализован` }
  }

  const started = Date.now()
  const { candidates, meta } = await adapter(portal, { limit: args.limit })

  // Один bbox на портал: для мультирегиональных источников проверка
  // выключается, там регион определяется на этапе привязки к городу.
  const bbox = portal.regionKeys.length === 1 ? (REGION_BBOX[portal.regionKeys[0]] ?? null) : null

  const evaluated = candidates.map((candidate) => ({
    candidate,
    verdict: evaluatePoiCandidate(candidate, { bbox }),
  }))

  /* Дедуп идёт по всему, что ещё может стать POI. Отклонённое по качеству,
     исключённое таксономией и уехавшее в чужой каталог в нём не участвует:
     это не наши записи, и совпадения с ними ничего не значат. */
  const STILL_OURS = new Set([TERMINAL.POI_ELIGIBLE, TERMINAL.AWAITING, TERMINAL.NEEDS_REVIEW])
  const { kept, collisions } = dedupeWithinBatch(
    evaluated.filter((e) => STILL_OURS.has(e.verdict.terminal)).map((e) => e.candidate),
  )

  const existing = await loadExisting(args.existing)
  const againstBase = existing.length
    ? kept.map((c) => ({ candidate: c, match: matchAgainstExisting(c, existing) }))
    : []

  /* Очереди по ТЕРМИНАЛЬНОМУ ИСХОДУ, а не по оценке качества. Раньше корзины
     строились на `decision`, который смотрел на факт совпадения шаблона и
     объявлял import вокзалу, рёкану и башне: маршрут реестра в это условие не
     входил. Отчёт, дедуп и счётчики были неверны, а фактическую запись
     останавливал только legacy-мост слоем ниже — случайная страховка. */
  const outcomes = Object.fromEntries(Object.values(TERMINAL).map((key) => [key, []]))
  for (const item of evaluated) {
    if (!outcomes[item.verdict.terminal]) {
      throw new Error(`Неизвестный терминальный исход ${item.verdict.terminal}`)
    }
    outcomes[item.verdict.terminal].push(item)
  }

  const queue = (key) =>
    outcomes[key].map(({ candidate, verdict }) => ({
      sourceKey: candidate.sourceKey,
      nameJa: candidate.nameJa,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      catalogTarget: verdict.classification?.catalogTarget ?? null,
      excludeReason: verdict.classification?.excludeReason ?? null,
      routeRuleId: verdict.classification?.routeRuleId ?? null,
      classificationSource: verdict.classification?.classificationSource ?? null,
      reason: verdict.terminalReason,
    }))

  // Записывать можно только то, что таксономия направила в POI И что прошло
  // дедуп внутри партии. Пересечение по sourceKey: списки хранят разные объекты.
  const eligibleKeys = new Set(
    outcomes[TERMINAL.POI_ELIGIBLE].map((e) => e.candidate.sourceKey),
  )

  // Город берётся из самой выгрузки, а не из реестра порталов.
  //
  // Раньше слаг ставился как единственный regionKey портала, а у Киото их
  // два («kyoto» и «uji») — слаг выходил пустым, и канон честно отверг все
  // 584 записи с «не указан город». Но и починить это подстановкой одного
  // из ключей было бы неверно: выгрузка идёт по ПРЕФЕКТУРЕ, и в ней лежит
  // всё от самого Киото до деревень Тангоского полуострова.
  // Коллизии дедупа, попавшие именно в корзину import. Общий счётчик
  // collisions смешивает import и review, и по нему нельзя ответить, куда
  // делись кандидаты корзины: 11.08.2026 из 381 import в трёх исходах
  // нашлось 377, а четыре просто исчезли.
  const poiDeduped = collisions.filter((c) => eligibleKeys.has(c.candidate.sourceKey))

  const outsideRegion = []
  const cityUnresolved = []
  const writable = kept
    .filter((c) => eligibleKeys.has(c.sourceKey))
    .filter((c) => {
      // Город берётся из выделенной колонки, а если её нет — из склеенного
      // адреса. У Осаки 所在地_市区町村 объявлена в заголовке и пуста во всех
      // 2012 строках: адрес целиком лежит в 所在地_連結表記. Пока разбирали
      // только колонку, все 381 кандидата корзины import отсеивались как
      // «вне региона», а сводка при этом рапортовала autoImportable: 381.
      // Три источника сразу, ни один не главнее по факту непустоты.
      // «中央区» в колонке при адресе в Осаке — это Осака, а не Токио.
      const place = resolveSiteCity({
        prefecture: c.prefectureJa,
        city: c.cityJa,
        address: c.address,
      })
      c.prefectureJa = c.prefectureJa || place.prefecture || null
      c.municipalityJa = place.municipality || null
      c.wardJa = place.ward || null

      // МУНИЦИПАЛИТЕТ НЕ РАСПОЗНАН — это не то же самое, что «вне региона».
      // Второе значит «знаем где, туда не едем»; первое — «не знаем где».
      // Догадаться по префектуре нельзя: 東京都 покрывает и Сибую, и острова
      // Огасавара в тысяче километров от неё. Такие идут человеку.
      if (!place.municipality) {
        cityUnresolved.push({
          sourceKey: c.sourceKey, nameJa: c.nameJa,
          cityJa: c.cityJa ?? null, address: c.address ?? null,
          conflict: place.conflict, reason: place.reason,
        })
        return false
      }

      // Место вне маршрутных городов портала. Это не брак данных — просто
      // туда никто не поедет, и в базе такая точка будет только мешать
      // поиску дублей и подбору под интересы гостя.
      if (!place.siteCity || !portal.regionKeys.includes(place.siteCity)) {
        outsideRegion.push({
          sourceKey: c.sourceKey,
          nameJa: c.nameJa, municipality: place.municipality, slug: place.siteCity || null,
        })
        return false
      }
      c.siteCity = place.siteCity
      return true
    })

  // ИНВАРИАНТ СУММЫ. Каждый кандидат корзины import обязан иметь ровно один
  // терминальный исход: запись, география, человек или дедуп. Пока проверки
  // не было, потеря четырёх записей выглядела как ничто — сводка сходилась
  // «на глаз», потому что складывать было нечего.
  const eligibleTerminal = writable.length + outsideRegion.length + cityUnresolved.length + poiDeduped.length
  if (eligibleTerminal !== eligibleKeys.size) {
    throw new Error(
      `Очередь poiEligible не сходится: ${eligibleKeys.size} кандидатов, терминальных исходов ${eligibleTerminal} `
      + `(writable ${writable.length} + география ${outsideRegion.length} + человек ${cityUnresolved.length} `
      + `+ дедуп ${poiDeduped.length}). Потерянные кандидаты означают, что часть выгрузки исчезла без следа.`,
    )
  }

  /* ФИНАЛЬНОЕ РЕШЕНИЕ. canAutoImport считается здесь и только здесь — по той
     же функции, что отобрала portal.writable. Раньше он стоял на вердикте
     кандидата, то есть до географии и дедупа: 336 объектов назывались
     автоимпортируемыми там, где до записи доходит 116. */
  const writableSet = new Set(writable.map((c) => c.sourceKey))
  const dedupedSet = new Set(poiDeduped.map((c) => c.candidate.sourceKey))
  const outsideSet = new Set(outsideRegion.map((r) => r.sourceKey))
  const unresolvedSet = new Set(cityUnresolved.map((r) => r.sourceKey))
  const finalDecision = (item) => poiWritableDecision({
    terminal: item.verdict.terminal,
    municipalityResolved: !unresolvedSet.has(item.candidate.sourceKey),
    insideRegion: !outsideSet.has(item.candidate.sourceKey),
    deduped: dedupedSet.has(item.candidate.sourceKey),
  })
  const autoImportKeys = new Set(
    evaluated.filter((item) => finalDecision(item).writable).map((item) => item.candidate.sourceKey),
  )
  if (autoImportKeys.size !== writableSet.size
    || [...autoImportKeys].some((key) => !writableSet.has(key))) {
    throw new Error(
      `canAutoImport разошёлся с portal.writable: ${autoImportKeys.size} против ${writableSet.size}. `
      + 'Условие обязано быть одно.',
    )
  }

  /* ГЛОБАЛЬНЫЙ ИНВАРИАНТ. Каждый кандидат обязан попасть ровно в один
     терминальный исход. needs_review, exclude и маршрут в чужой каталог
     writable называться не могут — раньше могли. */
  const outcomeTotal = Object.values(outcomes).reduce((sum, list) => sum + list.length, 0)
  if (outcomeTotal !== evaluated.length) {
    throw new Error(
      `Терминальные исходы не сходятся: кандидатов ${evaluated.length}, разложено ${outcomeTotal}.`,
    )
  }

  /* ПОЛНЫЙ ФИНАЛЬНЫЙ ИНВАРИАНТ. Раскладка poiEligible на четыре реальных
     исхода плюс остальные очереди обязана дать ровно число выгруженных
     записей. Именно эта сумма показывает, что «336 автоимпортируемых» было
     арифметически невозможно: до записи доходит только часть. */
  const finalTally = {
    poiWritable: writable.length,
    outsideRegion: outsideRegion.length,
    cityUnresolved: cityUnresolved.length,
    poiDeduped: poiDeduped.length,
    classificationNeedsReview: outcomes[TERMINAL.NEEDS_REVIEW].length,
    excludedByTaxonomy: outcomes[TERMINAL.EXCLUDED].length,
    routedElsewhere: outcomes[TERMINAL.ROUTED_ELSEWHERE].length,
    awaitingClassification: outcomes[TERMINAL.AWAITING].length,
    qualityRejected: outcomes[TERMINAL.QUALITY_REJECTED].length,
  }
  const finalTotal = Object.values(finalTally).reduce((a, b) => a + b, 0)
  if (finalTotal !== candidates.length) {
    throw new Error(
      `Финальная арифметика не сходится: выгружено ${candidates.length}, разложено ${finalTotal} — `
      + Object.entries(finalTally).map(([k, v]) => `${k} ${v}`).join(', '),
    )
  }

  const rejectReasons = {}
  for (const item of outcomes[TERMINAL.QUALITY_REJECTED]) {
    for (const reason of item.verdict.blockingReasons.length
      ? item.verdict.blockingReasons
      : ['below_threshold']) {
      rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1
    }
  }

  // Раскладка по КОДАМ реестра, а не по старым русским ярлыкам. Записи,
  // где шаблон совпал, но однозначного типа у него нет, считаются отдельно:
  // это очередь к человеку, а не «не определилось».
  const categories = {}
  for (const item of evaluated) {
    const c = item.verdict.classification
    const key = !c
      ? '(правила не разобрали)'
      : (c.poiPrimaryType ?? `${c.entityKind}/${c.intakeDisposition}`)
    categories[key] = (categories[key] ?? 0) + 1
  }

  const byKey = new Map(evaluated.map((e) => [e.candidate.sourceKey, e]))

  const sample = (items) =>
    items.slice(0, args.samples).map(({ candidate, verdict }) => ({
      name: candidate.nameJa,
      city: candidate.cityJa,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      score: verdict.score,
      coords: Number.isFinite(candidate.lat) ? [candidate.lat, candidate.lon] : null,
      blockers: verdict.blockingReasons,
      signals: verdict.signals
        .filter((s) => s.score !== 0)
        .map((s) => `${s.kind}:${s.code}:${s.score}`),
    }))

  return {
    portalId: portal.id,
    label: portal.label,
    licence: portal.licence,
    source: meta,
    durationMs: Date.now() - started,
    // Финальная раскладка: сумма обязана равняться fetched, и это проверено
    // выше, а не «на глаз».
    finalTally,
    totals: {
      fetched: candidates.length,
      // Терминальные исходы таксономии. Старых корзин import/review/reject
      // здесь больше нет: они строились на смешанной категории, которую
      // реестр как раз и заменяет.
      // poiEligible — прошли таксономию и качество; poiWritable — ещё и
      // географию с дедупом. Второе и есть то, что уйдёт в запись.
      poiEligible: outcomes[TERMINAL.POI_ELIGIBLE].length,
      /* Раскладка НЕ переписывается второй раз, а разворачивается та же
         самая, чью сумму проверил инвариант. Две копии счётчиков разошлись бы
         молча — и первая же правка одной из них это и сделала бы. */
      ...finalTally,
      // Ровно portal.writable.length: инвариант выше это и проверяет.
      autoImportable: autoImportKeys.size,
      dedupedWithinBatch: collisions.length,
      // Отдельно от общего счётчика: только корзина import, только терминальный исход.
      poiDeduped: poiDeduped.length,
      // Отсеяно как «не маршрутный город»: не брак, а география.
      outsideRegion: outsideRegion.length,
      // Муниципалитет не распознан — очередь к человеку, а не география.
      cityUnresolved: cityUnresolved.length,
      matchedExistingBase: againstBase.filter((r) => r.match.verdict !== 'new').length,
      // Сколько записей придётся отдать LLM на категоризацию — прямая
      // оценка счёта за прогон.
      needsLlmCategory: outcomes[TERMINAL.AWAITING].length,
      // Записи, у которых часы/цена пришли из устаревшей выгрузки.
      // Импортировать можно, публиковать эти поля — нет.
      volatileFieldsUnverified: evaluated.filter(
        (e) => e.verdict.terminal !== TERMINAL.QUALITY_REJECTED && e.verdict.volatileFieldsUnverified,
      ).length,
    },
    rejectReasons,
    categories,
    // Стоимость AI-обработки считается по фактическому корпусу этого
    // прогона, а не по средней оценке «примерно столько-то за точку».
    aiCost: estimateCascadeCost(evaluated),
    samples: {
      poiEligible: sample(outcomes[TERMINAL.POI_ELIGIBLE]),
      classificationNeedsReview: sample(outcomes[TERMINAL.NEEDS_REVIEW]),
      excludedByTaxonomy: sample(outcomes[TERMINAL.EXCLUDED]),
      routedElsewhere: sample(outcomes[TERMINAL.ROUTED_ELSEWHERE]),
      qualityRejected: sample(outcomes[TERMINAL.QUALITY_REJECTED]),
    },
    /* Полные очереди, а не только примеры: по каждой видно sourceKey,
       маршрут, правило реестра и причину. */
    queues: {
      poiEligible: queue(TERMINAL.POI_ELIGIBLE),
      classificationNeedsReview: queue(TERMINAL.NEEDS_REVIEW),
      excludedByTaxonomy: queue(TERMINAL.EXCLUDED),
      routedElsewhere: queue(TERMINAL.ROUTED_ELSEWHERE),
      awaitingClassification: queue(TERMINAL.AWAITING),
    },
    // Полные списки, а не только примеры: на вопрос «почему эта точка не
    // прошла» нужно уметь отвечать без перезапуска прогона.
    outsideRegionSample: outsideRegion.slice(0, 20),
    // Неразобранная или противоречивая география — очередь к человеку.
    // Полный список уходит в --out: двадцати строк для разбора мало, а
    // в консоли от него остаётся счётчик, иначе сводка нечитаема.
    cityUnresolvedSample: cityUnresolved.slice(0, 20),
    cityUnresolvedQueue: cityUnresolved,
    // Полная очередь коллизий: что с чем сошлось и по каким признакам.
    collisionQueue: collisions.map((c) => ({
      sourceKey: c.candidate.sourceKey,
      nameJa: c.candidate.nameJa,
      bucket: importKeys.has(c.candidate.sourceKey) ? 'import' : 'review',
      againstSourceKey: c.against?.sourceKey ?? null,
      againstNameJa: c.against?.nameJa ?? null,
      reasons: c.reasons ?? [],
    })),
    // Кандидаты корзины import, пережившие дедуп внутри партии. Именно их
    // берёт --write; в stdout не печатаются, иначе консоль тонет.
    writable: writable.map((c) => ({
      sourceKey: c.sourceKey,
      nameJa: c.nameJa,
      // Чтение каной — главный вход для имени. В базу оно не попадает,
      // это промежуточная запись звучания: иероглифы читать нечем, а
      // английского названия японские открытые данные часто не дают
      // вовсе (у Осаки колонка объявлена и пуста во всех 2012 строках).
      nameKana: c.nameKana ?? '',
      nameEn: c.nameEn ?? '',
      cityJa: c.cityJa ?? '',
      // Полный адрес нужен человеку при разборе: по одним координатам не
      // отличить филиал от головного объекта и тёзку от тёзки, а карта
      // открывается по точке, которая у обоих одна.
      address: c.address ?? '',
      // Административные части — отдельно от туристического слага:
      // Site City это направление продукта, а не тип территории.
      prefectureJa: c.prefectureJa ?? '',
      municipalityJa: c.municipalityJa ?? '',
      wardJa: c.wardJa ?? '',
      lat: Number.isFinite(c.lat) ? c.lat : null,
      lon: Number.isFinite(c.lon) ? c.lon : null,
      workingHours: c.workingHours ?? '',
      website: c.website ?? '',
      // Классификация правилами: коды реестра и уже вычисленный маршрут.
      // Старое русское значение сюда не едет — сравнение «до/после» делает
      // baseline-файл, а не вторая колонка в этом отчёте.
      entityKind: byKey.get(c.sourceKey)?.verdict.classification?.entityKind ?? null,
      poiPrimaryType: byKey.get(c.sourceKey)?.verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: byKey.get(c.sourceKey)?.verdict.classification?.intakeDisposition ?? null,
      classificationSource: byKey.get(c.sourceKey)?.verdict.classification?.classificationSource ?? null,
      // Слаг проставлен выше по японскому названию муниципалитета.
      siteCity: c.siteCity ?? '',
    })),
    all: evaluated.map(({ candidate, verdict }) => ({
      sourceKey: candidate.sourceKey,
      nameJa: candidate.nameJa,
      lat: candidate.lat,
      lon: candidate.lon,
      workingHours: candidate.workingHours,
      website: candidate.website,
      qualityVerdict: verdict.qualityVerdict,
      terminal: verdict.terminal,
      terminalReason: verdict.terminalReason,
      score: verdict.score,
      entityKind: verdict.classification?.entityKind ?? null,
      poiPrimaryType: verdict.classification?.poiPrimaryType ?? null,
      intakeDisposition: verdict.classification?.intakeDisposition ?? null,
      classificationSource: verdict.classification?.classificationSource ?? null,
      blockers: verdict.blockingReasons,
      volatileFieldsUnverified: verdict.volatileFieldsUnverified,
    })),
  }
}

/** Диффует прогон с предыдущим снимком — это и есть режим мониторинга. */
function diffAgainstSnapshot(current, previous) {
  const prevByKey = new Map()
  for (const portal of previous.portals ?? []) {
    for (const row of portal.all ?? []) prevByKey.set(row.sourceKey, row)
  }
  const curByKey = new Map()
  for (const portal of current.portals ?? []) {
    for (const row of portal.all ?? []) curByKey.set(row.sourceKey, row)
  }

  const added = []
  const removed = []
  const changed = []

  for (const [key, row] of curByKey) {
    const before = prevByKey.get(key)
    if (!before) {
      added.push({ sourceKey: key, nameJa: row.nameJa, terminal: row.terminal })
      continue
    }
    const fields = []
    if ((before.workingHours ?? '') !== (row.workingHours ?? '')) {
      fields.push({ field: 'workingHours', from: before.workingHours, to: row.workingHours })
    }
    if ((before.website ?? '') !== (row.website ?? '')) {
      fields.push({ field: 'website', from: before.website, to: row.website })
    }
    if (before.terminal !== row.terminal) {
      fields.push({ field: 'terminal', from: before.terminal, to: row.terminal })
    }
    if (fields.length) changed.push({ sourceKey: key, nameJa: row.nameJa, fields })
  }
  for (const [key, row] of prevByKey) {
    if (!curByKey.has(key)) {
      // Пропал из выгрузки — возможное закрытие. Автоматически ничего не
      // архивируем: сначала человек смотрит список.
      removed.push({ sourceKey: key, nameJa: row.nameJa })
    }
  }

  return {
    comparedWith: previous.startedAt ?? null,
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    details: { added: added.slice(0, 50), removed: removed.slice(0, 50), changed: changed.slice(0, 50) },
  }
}


/**
 * Запись прогона в базу — единственным разрешённым способом.
 *
 * Ничего не решает сама: собирает запросы и отдаёт их ingestPoiBatch.
 * Канон, идемпотентность по Source Key, поиск дублей и родителя, выбор
 * полей — всё там. Здесь только перевод кандидата источника в форму запроса
 * и разбор ответов по корзинам.
 */
export async function writeRun(report, args) {
  /* PREFLIGHT. Маршрут проверяется по ВСЕМ входным строкам до чтения файла
     имён, до поиска имени, до транслитерации и до очереди unnamed. Раньше
     проверка стояла внутри цикла построения запросов, то есть уже после всей
     работы с именами: комментарий обещал «до», а код делал «после». */
  const inbound = report.portals.flatMap((portal) =>
    (portal.writable ?? []).map((row) => ({ portal, row })),
  )
  const notRouteToPoi = inbound
    .filter(({ row }) => !isRouteToPoi(row))
    .map(({ row }) => ({
      sourceKey: row.sourceKey,
      nameJa: row.nameJa,
      entityKind: row.entityKind ?? null,
      poiPrimaryType: row.poiPrimaryType ?? null,
      classificationSource: row.classificationSource ?? null,
    }))
  if (notRouteToPoi.length) {
    const sample = notRouteToPoi
      .slice(0, 10)
      .map((r) => `  ${r.sourceKey} «${r.nameJa}» — ${r.entityKind ?? '?'} / ${r.poiPrimaryType ?? 'без типа'} / ${r.classificationSource ?? '?'}`)
      .join('\n')
    throw new Error(
      `В запись пришло ${notRouteToPoi.length} строк из ${inbound.length}, которые реестр не маршрутизирует `
      + `в POI. Отбор в writable и повторная проверка разошлись — запись остановлена до чтения имён.\n${sample}`,
    )
  }

  const { names, stats: nameStats } = await loadNames(args.names)
  const usedNameKeys = new Set()
  const requests = []
  const unnamed = []
  /* Старое поле категории в Airtable умеет говорить только по-русски. Мост
     переводит код реестра в старое значение ТОЛЬКО там, где перевод точен;
     где старое значение шире или уже нового кода — возвращает null, и запись
     обязана остановиться. Подобрать ближайшее значило бы вернуть ту самую
     смесь, ради разбора которой заводился реестр. */
  const legacyCategoryBlocked = []

  for (const portal of report.portals) {
    for (const row of portal.writable ?? []) {
      // Имя из файла главнее машинного: если владелец уже выбрал форму,
      // транслитератор её не переписывает.
      // Три источника имени, по убыванию надёжности:
      //   1. --names   — владелец уже выбрал форму, она главнее всего;
      //   2. кана      — чтение из источника, прямой Поливанов;
      //   3. английское название — перевод, годится хуже: теряет звучание
      //      («Golden Pavilion» вместо «Кинкакудзи») и тащит заимствования.
      const named = names[row.sourceKey] ?? {}
      if (names[row.sourceKey]) usedNameKeys.add(row.sourceKey)
      let auto = null
      if (!named.nameRu && row.nameKana) auto = poiNameFromKana(row.nameJa, row.nameKana)
      // Английское имя из файла — такой же источник, как английское из
      // выгрузки, и он надёжнее: его выбрал человек. Пока учитывался только
      // row.nameEn, запись с nameEn в файле и без nameRu уходила в очередь
      // «имя не собралось», хотя собрать его было из чего.
      const englishSource = named.nameEn || row.nameEn
      if (!named.nameRu && !auto?.nameRu && englishSource) auto = poiNameToRu(englishSource)
      const nameRu = named.nameRu || auto?.nameRu || ''

      // Имени нет вовсе — это значит, что у источника не было английского
      // названия, а иероглифы транслитерировать нечем: нужна кана, которой
      // в выгрузке нет. Такие уходят в очередь, а не заводятся безымянными.
      if (!nameRu) {
        unnamed.push({
          sourceKey: row.sourceKey,
          nameJa: row.nameJa,
          nameEn: row.nameEn,
          reason: (auto?.warnings ?? []).join('; ')
            || (row.nameKana || row.nameEn ? 'имя не собралось' : 'нет ни чтения каной, ни английского названия'),
        })
        continue
      }
      const legacyCategory = legacyAirtableCategory(row.poiPrimaryType)
      if (!legacyCategory.value) {
        legacyCategoryBlocked.push({
          sourceKey: row.sourceKey,
          nameJa: row.nameJa,
          poiPrimaryType: row.poiPrimaryType ?? null,
          reason: legacyCategory.reason,
        })
      }

      requests.push({
        source: {
          kind: 'portal-collector',
          id: portal.portalId,
          // sourceKey из адаптера уже вида «<портал>:<id>», а buildSourceKey
          // приклеит id портала ещё раз. Снимаем префикс, иначе Source Key
          // выйдет «bodik-osaka:bodik-osaka:123» и идемпотентность сломается
          // при первом же переименовании портала.
          externalKey: row.sourceKey.startsWith(`${portal.portalId}:`)
            ? row.sourceKey.slice(portal.portalId.length + 1)
            : row.sourceKey,
          url: portal.source?.url ?? undefined,
        },
        poi: {
          nameRu,
          machineNamed: !named.nameRu,
          sourceName: [row.nameJa, row.nameKana].filter(Boolean).join(' / ') || row.nameEn,
          nameWarnings: auto?.warnings,
          nameEn: named.nameEn || row.nameEn || undefined,
          siteCity: named.siteCity || row.siteCity,
          categoriesRu: legacyCategory.value ? [legacyCategory.value] : [],
          workingHours: row.workingHours,
          website: row.website || undefined,
          lat: row.lat,
          lon: row.lon,
          // Описание НЕ приходит ни из источника, ни из файла имён: тексты
          // пишутся свои, а право на переиспользование чужих не даёт ни один
          // из восьми порталов. Часы и описания в контракт файла имён не
          // входят и обрабатываются своими конвейерами. Пока writeRun читал
          // отсюда workingHours и descriptionRu, код обещал две разные формы
          // файла сразу: схема разрешала одно, чтение допускало другое.
          sources: portal.source?.url ? [portal.source.url] : undefined,
        },
      })
    }
  }

  // ПОКРЫТИЕ ПРОВЕРЯЕТСЯ ЗДЕСЬ — до раннего возврата, до создания store и
  // до ingestPoiBatch. Раньше проверка стояла в конце, и обе ветки её
  // обходили: при нуле собранных имён функция возвращалась раньше, а при
  // части собранных запись в production успевала пройти, и о несовпадении
  // файла узнавали уже после неё.
  const nameCoverage = describeNameCoverage(nameStats, usedNameKeys, names)
  assertNameCoverage(nameCoverage)

  /* Остановка ДО создания store и до ingestPoiBatch, по образцу проверки имён
     выше. Молча записать POI без категории нельзя: старое поле — то, по
     которому база сегодня фильтруется, и пустое значение там выглядит как
     «не заполнили», а не как «не смогли перевести». */
  if (legacyCategoryBlocked.length) {
    const sample = legacyCategoryBlocked
      .slice(0, 10)
      .map((r) => `  ${r.sourceKey} «${r.nameJa}» — ${r.poiPrimaryType ?? 'тип не определён'}: ${r.reason}`)
      .join('\n')
    throw new Error(
      `Старое поле категории Airtable не может выразить ${legacyCategoryBlocked.length} записей `
      + `из ${requests.length}. Запись остановлена до обращения к базе.\n${sample}`
      + (legacyCategoryBlocked.length > 10 ? `\n  … и ещё ${legacyCategoryBlocked.length - 10}` : '')
      + '\nЭто ожидаемо до потребителя № 4: часть кодов реестра в старом наборе значений отсутствует.',
    )
  }

  if (!requests.length) {
    return {
      attempted: 0, names: nameCoverage,
      unnamed: unnamed.length, unnamedQueue: unnamed.slice(0, 200), outcomes: {},
    }
  }

  const store = args.baseSnapshot
    ? createSnapshotStore(JSON.parse(await readFile(args.baseSnapshot, 'utf8')))
    : createAirtablePoiStore({
        token: process.env.AIRTABLE_TOKEN?.trim(),
        baseId: process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm',
        dryRun: args.dryWrite,
      })
  const results = await ingestPoiBatch(requests, store)

  const outcomes = {}
  const created = []
  const blocked = []
  for (const [i, r] of results.entries()) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1
    if (r.outcome === 'created') created.push(`${r.poiId} «${requests[i].poi.nameRu}»`)
    else if (r.outcome !== 'already_ingested') {
      blocked.push(`${requests[i].poi.nameRu} → ${r.explanation}`)
    }
  }

  return {
    attempted: requests.length,
    names: nameCoverage,
    unnamed: unnamed.length,
    unnamedQueue: unnamed.slice(0, 200),
    outcomes,
    created: created.slice(0, 100),
    notCreated: blocked.slice(0, 100),
  }
}

/**
 * Хранилище поверх снимка базы в файле. Ничего не пишет и ничего не читает
 * из сети — весь конвейер прогоняется как есть, включая гейт дублей
 * и накопление уже принятых записей внутри пакета.
 */
function createSnapshotStore(pois) {
  const pool = [...pois]
  let next = pool.reduce((max, p) => {
    const m = /^POI-(\d{6})$/.exec(p.poiId ?? '')
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return {
    async listExisting() { return pool },
    async findBySourceKey() { return null },
    async create(fields) {
      next += 1
      const poiId = `POI-${String(next).padStart(6, '0')}`
      pool.push({
        poiId,
        nameRu: fields['POI Name (RU)'] ?? '',
        nameEn: fields['POI Name (EN)'] ?? '',
        siteCity: fields['Site City'] ?? '',
        lat: fields.Latitude ?? undefined,
        lon: fields.Longitude ?? undefined,
        recordId: `snapshot-${poiId}`,
      })
      return { poiId, recordId: `snapshot-${poiId}` }
    },
  }
}

/** sourceKey → {nameRu, nameEn, siteCity}. */

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(
      [
        'Коллектор POI с порталов Японии.',
        '',
        '  --portal <id>      прогнать один портал из реестра',
        '  --all              все активные порталы с реализованным адаптером',
        '  --limit <n>        ограничить число записей (для обкатки)',
        '  --existing <file>  JSON с текущей базой POI для сверки на дубли',
        '  --monitor <file>   сравнить с предыдущим снимком прогона',
        '  --out <file>       записать полный отчёт JSON',
        '  --names <file>     JSON: sourceKey → {nameRu, nameEn, siteCity}',
        '  --write            записать корзину import через ingestPoi',
        '  --dry-write        прогнать запись против живой базы, ничего не создавая',
        '  --base-snapshot <file>  то же, но против снимка базы из файла, без токена',
        '',
        'Без --write ничего никуда не пишется. С --write записываются только',
        'кандидаты из корзины import, у которых есть русское имя в --names.',
      ].join('\n'),
    )
    return
  }

  const portals = args.all
    ? activePortals().filter((p) => ADAPTERS[p.adapter])
    : [getPortal(args.portal ?? 'bodik-osaka-tourism')]

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: true,
    portals: [],
  }

  for (const portal of portals) {
    // Коллектор пишет в базу ФАКТЫ, не чужой текст. Поэтому пропуск по
    // factExtraction, а не по праву на переиспользование текста: последнее
    // не разрешает ни один из зафиксированных источников, и это нормально —
    // русские тексты пишутся свои.
    if (portal.licence?.factExtraction !== true) {
      report.portals.push({
        portalId: portal.id,
        skipped: `извлечение фактов не разрешено однозначно: ${portal.licence?.factExtraction ?? 'не определено'}`,
      })
      continue
    }
    if (portal.robots?.allowsUs === false || portal.enabled === false) {
      report.portals.push({
        portalId: portal.id,
        skipped: `исключён: ${portal.blockedReason ?? 'robots'}`,
      })
      continue
    }
    try {
      report.portals.push(await runPortal(portal, args))
    } catch (error) {
      report.portals.push({ portalId: portal.id, error: error.message })
      console.error(`[poi-portals] ${portal.id}: ${error.message}`)
    }
  }

  if (args.write) {
    try {
      report.write = await writeRun(report, args)
      report.dryRun = Boolean(args.dryWrite)
    } catch (error) {
      report.write = { error: error.message }
      console.error(`[poi-portals] запись прервана: ${error.message}`)
    }
  }

  if (args.monitor) {
    try {
      const previous = JSON.parse(await readFile(args.monitor, 'utf8'))
      report.monitor = diffAgainstSnapshot(report, previous)
    } catch (error) {
      report.monitor = { error: `не удалось прочитать снимок: ${error.message}` }
    }
  }

  if (args.out) {
    await mkdir(path.dirname(args.out), { recursive: true })
    await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
  }

  // В stdout — сводка без объёмных списков, иначе консоль тонет. Они уже
  // записаны в --out целиком; здесь от них остаются счётчики и примеры.
  // Поля удаляются с копии, а не отбрасываются деструктуризацией: та
  // заводит переменные, которыми никто не пользуется, и линтер справедливо
  // ругается на каждую.
  const BULKY_PORTAL_FIELDS = ['all', 'writable', 'cityUnresolvedQueue', 'collisionQueue', 'queues']
  const BULKY_WRITE_FIELDS = ['unnamedQueue', 'created', 'notCreated']
  const withoutFields = (source, fields) => {
    const copy = { ...source }
    for (const field of fields) delete copy[field]
    return copy
  }
  const summary = {
    ...report,
    portals: report.portals.map((portal) => withoutFields(portal, BULKY_PORTAL_FIELDS)),
    ...(report.write ? { write: withoutFields(report.write, BULKY_WRITE_FIELDS) } : {}),
  }
  console.log(JSON.stringify(summary, null, 2))
}

// Запуск только как скрипт. Без этого импорт ради теста поднимал бы весь
// прогон: коллектор пошёл бы в сеть, а тест ждал бы портал.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[poi-portals] ${error.message}`)
    process.exitCode = 1
  })
}
