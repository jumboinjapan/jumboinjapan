/**
 * Единая точка приёма POI — для любого источника и любого агента.
 *
 * ПРАВИЛО: ни один путь не пишет в таблицу POI напрямую. Telegram-бот,
 * пакетный коллектор с порталов, админка, внешние агенты (LLoyd, Verter,
 * Johny, Mason, Porter) и всё, что появится потом, вызывают ingestPoi().
 * Это единственное место, где запись может быть создана.
 *
 * Что делает конвейер, по порядку:
 *
 *   1. КАНОН       poi-canon.ts — слаг города, типографика, часы,
 *                  категории из белого списка, запрещённые слова.
 *                  Ошибки канона останавливают приём.
 *   2. ГЕЙТ        poi-matching.ts — поиск дублей и родителя по всей базе.
 *                  Уверенный дубль в том же городе останавливает приём.
 *   3. ЗАПИСЬ      только после первых двух, всегда как черновик:
 *                  Copy Status = Draft, Fact Check = Todo, текст в
 *                  Draft-поля. Approved и Description (RU) не трогаются —
 *                  на сайт ничего не попадает без решения человека.
 *   4. СЛЕД        источник, ключ и дата фиксируются в самой записи,
 *                  чтобы повторный прогон был идемпотентным, а происхождение
 *                  прослеживалось.
 *
 * Почему так. До этого путей записи было три (агент, админка, хардкод),
 * и каждый проверял своё: агент искал дубли и игнорировал результат,
 * админка не проверяла ничего. На живой базе это дало 6 пар дублей,
 * два из которых были опубликованы.
 */

// Относительные пути, а не алиас '@/lib/...': этот модуль импортируют и
// Next.js, и обычные .mjs-скрипты коллектора, а alias резолвится только
// внутри Next. Относительный импорт работает в обоих.
import { applyCanon, type CanonIssue, type PoiCanonInput } from './poi-canon.ts'
import { screenNewPoi, type PoiLike, type PoiScreenResult } from './poi-matching.ts'

/** Кто заводит запись. Пишется в Notes и позволяет отобрать «всё от X». */
export type PoiSourceKind =
  | 'telegram-agent'
  | 'portal-collector'
  | 'admin'
  | 'external-agent'
  | 'manual-import'

export interface PoiIngestRequest {
  source: {
    kind: PoiSourceKind
    /** Идентификатор конкретного источника: 'bodik-osaka-tourism', 'johny'. */
    id: string
    /**
     * Ключ записи В ИСТОЧНИКЕ. Делает повторный прогон идемпотентным.
     * Без него коллектор при втором запуске заведёт всё заново.
     */
    externalKey?: string
    /** Ссылка на первоисточник — куда идти проверять факты. */
    url?: string
  }
  poi: PoiCanonInput & {
    /**
     * Имя собрано транслитератором, а не человеком. Помечается в Notes:
     * запись всё равно черновик, но владелец должен видеть, какие имена
     * он ещё не выбирал сам.
     */
    machineNamed?: boolean
    /** Исходное имя источника — чтобы было с чем сверять машинное. */
    sourceName?: string
    nameWarnings?: string[]
    parentNameRu?: string
    parentNameEn?: string
    ticketsNote?: string
    openQuestions?: string[]
    sources?: string[]
  }
}

export type PoiIngestOutcome =
  | 'created'
  | 'rejected_canon'
  | 'blocked_duplicate'
  | 'already_ingested'

export interface PoiIngestResult {
  outcome: PoiIngestOutcome
  /** ID созданной или найденной записи. */
  poiId: string | null
  recordId: string | null
  canonIssues: CanonIssue[]
  screen: PoiScreenResult | null
  /** Человекочитаемое объяснение решения — идёт в отчёт агенту. */
  explanation: string
  /** Значения полей, которые были бы записаны. Заполняется и при dryRun. */
  fields: Record<string, unknown> | null
}

/**
 * Что источник обязан уметь, чтобы конвейер был идемпотентным.
 * Реализуется в poi-intake.ts поверх Airtable; в тестах подменяется.
 */
export interface PoiStore {
  /** Снимок базы для гейта. Делается ОДИН раз на пакет, не на запись. */
  listExisting(): Promise<PoiLike[]>
  /** Поиск ранее принятой записи по ключу источника. */
  findBySourceKey(sourceKey: string): Promise<PoiLike | null>
  /**
   * Создаёт запись и САМ назначает POI ID.
   *
   * Назначение идентификатора намеренно принадлежит хранилищу, а не этому
   * модулю. Раньше конвейер делал два отдельных шага — «спроси следующий
   * id», потом «создай запись с ним», — и между ними мог вклиниться другой
   * приём: оба получали один и тот же номер. Внутри одного вызова store
   * выдача и запись неразделимы, и хранилище может защитить их так, как
   * умеет его бэкенд.
   */
  create(fields: Record<string, unknown>): Promise<{ poiId: string; recordId: string }>
}

/** Ключ происхождения: `<источник>:<ключ в источнике>`. */
export function buildSourceKey(source: PoiIngestRequest['source']): string | null {
  return source.externalKey ? `${source.id}:${source.externalKey}` : null
}

function buildNotes(request: PoiIngestRequest, screen: PoiScreenResult, canonIssues: CanonIssue[]): string {
  const sourceKey = buildSourceKey(request.source)
  const lines = [
    `Принято через ingestPoi. Источник: ${request.source.kind} / ${request.source.id}.`,
    sourceKey ? `Ключ источника: ${sourceKey}` : '',
    request.source.url ? `Первоисточник: ${request.source.url}` : '',
    request.poi.ticketsNote ? `Билеты: ${request.poi.ticketsNote}` : '',
    // Машинное имя помечается ВСЕГДА и первой строкой среди замечаний:
    // это единственное поле записи, которого не касался человек, и найти
    // такие записи потом можно будет только по этой отметке.
    request.poi.machineNamed
      ? `ИМЯ СОБРАНО ПО ПОЛИВАНОВУ, не проверено человеком. Источник: «${request.poi.sourceName ?? '—'}»`
      : '',
    request.poi.nameWarnings?.length
      ? `Замечания к имени: ${request.poi.nameWarnings.join('; ')}`
      : '',
    // Пограничные случаи фиксируются В ЗАПИСИ, а не только в отчёте:
    // отчёт агента прокрутится, поле Notes останется и попадёт в очередь.
    screen.verdict === 'needs_review' && screen.duplicates.length
      ? `ПРОВЕРИТЬ НА ДУБЛЬ: ${screen.duplicates
          .slice(0, 3)
          .map((m) => `${m.candidate.poiId} «${m.candidate.nameRu}» (${m.score})`)
          .join(', ')}`
      : '',
    screen.parentAmbiguous.length
      ? `РОДИТЕЛЬ НЕ ПРОСТАВЛЕН — кандидаты: ${screen.parentAmbiguous
          .map((m) => `${m.candidate.poiId} «${m.candidate.nameRu}»`)
          .join(', ')}`
      : '',
    // Соседи по координатам при непохожих именах. Часто это части одного
    // комплекса — тогда сосед и есть Parent POI, который матчер по имени
    // найти не мог.
    screen.geoNeighbours.length
      ? `РЯДОМ (по координатам): ${screen.geoNeighbours
          .map((m) => `${m.candidate.poiId} «${m.candidate.nameRu}» — ${Math.round(m.distanceM ?? 0)} м`)
          .join(', ')}`
      : '',
    canonIssues.filter((i) => i.level === 'warn').length
      ? `Замечания канона: ${canonIssues.filter((i) => i.level === 'warn').map((i) => i.message).join('; ')}`
      : '',
    request.poi.openQuestions?.length ? `Открытые вопросы: ${request.poi.openQuestions.join('; ')}` : '',
    request.poi.sources?.length ? `Источники фактов: ${request.poi.sources.join(', ')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * @param options.dryRun  ничего не пишет, но проходит все проверки и
 *   возвращает готовые поля. Пакетным коллекторам стоит прогонять пакет
 *   в dryRun и показывать сводку до записи.
 * @param options.force   завести даже при уверенном дубле. Только по
 *   осознанному подтверждению владельца, не по умолчанию.
 * @param options.existing  снимок базы, если он уже сделан на пакет.
 */
export async function ingestPoi(
  request: PoiIngestRequest,
  store: PoiStore,
  options: { dryRun?: boolean; force?: boolean; existing?: PoiLike[] } = {},
): Promise<PoiIngestResult> {
  // ── 1. Канон ──────────────────────────────────────────────────────────
  const { value, issues } = applyCanon(request.poi)
  const blocking = issues.filter((i) => i.level === 'error')
  if (blocking.length) {
    return {
      outcome: 'rejected_canon',
      poiId: null,
      recordId: null,
      canonIssues: issues,
      screen: null,
      explanation: `Не соответствует канону: ${blocking.map((i) => i.message).join('; ')}`,
      fields: null,
    }
  }

  // ── 2. Идемпотентность ────────────────────────────────────────────────
  const sourceKey = buildSourceKey(request.source)
  if (sourceKey) {
    const known = await store.findBySourceKey(sourceKey)
    if (known) {
      return {
        outcome: 'already_ingested',
        poiId: known.poiId,
        recordId: known.recordId ?? null,
        canonIssues: issues,
        screen: null,
        explanation: `Эта запись источника уже принята как ${known.poiId} «${known.nameRu}».`,
        fields: null,
      }
    }
  }

  // ── 3. Гейт ───────────────────────────────────────────────────────────
  const existing = options.existing ?? (await store.listExisting())
  const screen = screenNewPoi(
    {
      nameRu: value.nameRu,
      nameEn: value.nameEn,
      siteCity: value.siteCity,
      // Координаты идут в гейт вместе с именами. Это независимая от языка
      // ось: строковое сравнение между алфавитами упирается в потолок 0,85
      // и само по себе не блокирует, а расстояние в сто метров — блокирует.
      lat: value.lat,
      lon: value.lon,
    },
    existing,
    { nameRu: request.poi.parentNameRu, nameEn: request.poi.parentNameEn },
  )

  if (screen.verdict === 'blocked_duplicate' && !options.force) {
    const hit = screen.blockingDuplicate!.candidate
    return {
      outcome: 'blocked_duplicate',
      poiId: hit.poiId,
      recordId: hit.recordId ?? null,
      canonIssues: issues,
      screen,
      explanation: `Уже есть в базе: ${hit.poiId} «${hit.nameRu}» (${hit.siteCity}). ${screen.reasons.join(' ')}`,
      fields: null,
    }
  }

  // ── 4. Поля ───────────────────────────────────────────────────────────
  const parentRecordId = screen.parent?.candidate.recordId
  const fields: Record<string, unknown> = {
    'POI Name (RU)': value.nameRu,
    'POI Name (EN)': value.nameEn ?? null,
    'Site City': value.siteCity || null,
    'POI Category (RU)': value.categoriesRu?.length ? value.categoriesRu : undefined,
    'Working Hours': value.workingHours || null,
    Website: value.website || null,
    // Пишутся только парой и только после проверки рамкой Японии —
    // см. canonicalCoords. Половина пары до этого места не доходит.
    Latitude: value.lat ?? null,
    Longitude: value.lon ?? null,
    // Текст ТОЛЬКО в черновик. Description (RU) и Description Approved (RU)
    // не заполняются никогда: сайт рендерит approvedRu первым и без оглядки
    // на Copy Status, поэтому запись в них означала бы мгновенную публикацию.
    'Description Draft (RU)': value.descriptionRu || null,
    // Английский — тем же правилом: только в черновик. Раньше это поле
    // не заполнялось вовсе: исследователь возвращал descriptionEn, а путь
    // записи его молча терял, и каждая заведённая ботом точка приезжала
    // с русским текстом и пустым английским.
    'Description Draft (EN)': value.descriptionEn || null,
    'Copy Status': 'Draft',
    'Fact Check Status': 'Todo',
    ...(parentRecordId ? { 'Parent POI': [parentRecordId] } : {}),
    // Происхождение — в отдельных полях, а не прозой в Notes. По ним
    // отбирается «всё из источника X» для ревизии и отката, и по Source Key
    // работает идемпотентность повторного прогона.
    'Source Key': sourceKey,
    'Seed Source': request.source.kind,
    Notes: buildNotes(request, screen, issues),
  }

  if (options.dryRun) {
    return {
      outcome: 'created',
      poiId: null,
      recordId: null,
      canonIssues: issues,
      screen,
      explanation: 'Прогон без записи: проверки пройдены, запись была бы создана.',
      fields,
    }
  }

  const created = await store.create(fields)

  return {
    outcome: 'created',
    poiId: created.poiId,
    recordId: created.recordId,
    canonIssues: issues,
    screen,
    explanation:
      screen.verdict === 'needs_review'
        ? `Создана как ${created.poiId}, но помечена к проверке: ${screen.reasons.join(' ')}`
        : `Создана как ${created.poiId}.`,
    fields,
  }
}

/**
 * Пакетный приём: один снимок базы на весь пакет, и каждая следующая
 * запись проверяется против уже принятых в этом же прогоне.
 *
 * Без второго условия пакет с внутренним повтором заводит дубли сам в себя —
 * ровно это и делал прежний код при разборе списка мест из одной программы.
 */
export async function ingestPoiBatch(
  requests: PoiIngestRequest[],
  store: PoiStore,
  options: { dryRun?: boolean } = {},
): Promise<PoiIngestResult[]> {
  const pool = await store.listExisting()
  const results: PoiIngestResult[] = []

  for (const request of requests) {
    const result = await ingestPoi(request, store, { ...options, existing: pool })
    results.push(result)
    if (result.outcome === 'created' && result.fields) {
      pool.push({
        poiId: result.poiId ?? `pending-${results.length}`,
        nameRu: String(result.fields['POI Name (RU)'] ?? ''),
        nameEn: (result.fields['POI Name (EN)'] as string) ?? undefined,
        siteCity: (result.fields['Site City'] as string) ?? undefined,
        // Координаты обязаны попасть в пул: иначе две записи одной точки
        // внутри пакета проверяются только по именам, а именно на этом
        // строковое сравнение и слабее всего — источники дают латиницу.
        lat: (result.fields.Latitude as number) ?? undefined,
        lon: (result.fields.Longitude as number) ?? undefined,
        recordId: result.recordId ?? undefined,
      })
    }
  }
  return results
}
