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
    /**
     * Что дало опознание во внешних источниках (см. place-resolve).
     * Отдельно от PoiCanonInput намеренно: канон судит о том, что написал
     * человек или агент, а это — машинные идентификаторы, судить о них
     * нечем. Их дело — доехать до Airtable без искажений.
     */
    resolved?: {
      placeId?: string
      prefectureRu?: string
      prefectureEn?: string
      nameJa?: string
      wikidataQid?: string
      /** Когда координаты взяты у Google: у них срок годности 30 дней. */
      coordsCheckedAt?: string
    }
  }
}

export type PoiIngestOutcome =
  | 'created'
  /**
   * Приём остановлен: сущность неоднозначна, решает человек.
   *
   * До 11.08.2026 этого исхода не существовало, хотя screenNewPoi возвращал
   * 'needs_review'. Гейт был fail-open: сомнение не
   * останавливало запись, а дописывалось строкой в Notes уже созданного POI.
   * Найти такие записи потом было нельзя — в базе они неотличимы от прочих.
   */
  | 'needs_review'
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

/**
 * Версия контракта приёма. КОНСТАНТА, а не параметр: смысл маркера в том,
 * чтобы по записи можно было сказать, каким кодом она заведена. Если версию
 * разрешить передавать вызывающему, она перестаёт быть свидетельством и
 * становится ещё одним полем, которое можно заполнить чем угодно.
 *
 * Меняется вместе с наблюдаемым поведением приёма, а не с каждой правкой.
 */
export const POI_INTAKE_CONTRACT_VERSION = 'poi-intake/v1'

/**
 * Откуда пришла запись: `<вид источника>:<идентификатор>`.
 *
 * Собирается здесь, а не приходит строкой, чтобы значение оставалось
 * перечислимым. `kind` — союз типов, `id` — идентификатор конкретного
 * источника; свободного текста в поле не появится.
 */
export function buildIntakeOrigin(source: PoiIngestRequest['source']): string {
  return `${source.kind}:${source.id}`
}

/**
 * Идентификатор запуска приёма. Один на весь Intake: главный POI,
 * родительская заглушка и заглушки из списка мест обязаны получить
 * одинаковый, иначе по базе нельзя собрать, что приехало одним заходом.
 *
 * Готовый ID принимается ради повторяемых тестов; production его не задаёт.
 */
export function newIntakeRunId(): string {
  return crypto.randomUUID()
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
    // Тёзка, снятая расстоянием. В базе она остаётся законной отдельной
    // записью, но пара показывается: если координаты у одной из двух всё же
    // неверны, увидеть это можно только здесь.
    screen.geoRefutedDuplicate
      ? `ТЁЗКА (расстояние сняло дубль): ${screen.geoRefutedDuplicate.candidate.poiId} «${screen.geoRefutedDuplicate.candidate.nameRu}» — ${Math.round((screen.geoRefutedDuplicate.distanceM ?? 0) / 100) / 10} км`
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
 * @param options.runId   идентификатор запуска. Задаётся ВЫШЕ по стеку, чтобы
 *   все записи одного Intake получили один и тот же. Не задан — рождается
 *   здесь, и тогда запуск состоит из одной записи.
 */
export async function ingestPoi(
  request: PoiIngestRequest,
  store: PoiStore,
  options: { dryRun?: boolean; force?: boolean; existing?: PoiLike[]; runId?: string } = {},
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

  // ОДИН place_id — ОДИН POI. Проверка отдельно от матчера имён потому,
  // что это тождество, а не сходство: имена могут расходиться сколь угодно
  // («Мыс Сирэтоко» и «Круиз к мысу Сирэтоко»), но если Google считает их
  // одним местом, то в базе им место одно. Правило нашлось на живой базе:
  // мыс и круиз делили place_id и ВЗАИМНО подтверждали координаты друг
  // друга, потому что у города не было других опор.
  const incomingPlaceId = request.poi.resolved?.placeId?.trim()
  if (incomingPlaceId && !options.force) {
    const clash = existing.find((p) => p.placeId && p.placeId === incomingPlaceId)
    if (clash) {
      return {
        outcome: 'blocked_duplicate',
        poiId: clash.poiId,
        recordId: clash.recordId ?? null,
        canonIssues: issues,
        screen,
        explanation: `Тот же объект Google уже заведён как ${clash.poiId} «${clash.nameRu}» (place_id ${incomingPlaceId}). Если это разные места, у одного из них place_id проставлен неверно.`,
        fields: null,
      }
    }
  }

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

  // ── 3б. Неоднозначность останавливает приём ───────────────────────────
  // Исход возвращается ДО построения полей и до store.create: причина
  // сомнения обязана жить в структурированном результате, а не примечанием
  // рядом с записью, которой не должно было появиться.
  //
  // Вердикт дают три ветки: совпадение выше порога блокировки при разных
  // городах, серая зона 0,72–0,9 и непохожие имена в пределах 60 м. Пара,
  // опровергнутая расстоянием, сюда НЕ попадает — она выбывает из разбора
  // ещё в матчере и уходит флагом в screen.geoRefutedDuplicate.
  //
  // force проходит поверх: он и заведён как осознанное подтверждение
  // владельца, а needs_review слабее уверенного дубля.
  if (screen.verdict === 'needs_review' && !options.force) {
    return {
      outcome: 'needs_review',
      poiId: null,
      recordId: null,
      canonIssues: issues,
      screen,
      explanation: `Нужна проверка человеком, запись не заведена. ${screen.reasons.join(' ')}`,
      fields: null,
    }
  }

  // ── 4. Поля ───────────────────────────────────────────────────────────
  const parentRecordId = screen.parent?.candidate.recordId
  const fields: Record<string, unknown> = {
    // Маркеры приёма идут в ИСХОДНЫЙ набор полей, а не дописываются вторым
    // PATCH-ом. Отдельный PATCH может не дойти — упасть, потеряться в
    // ретраях, — и тогда запись существует без следа о том, как она попала
    // в базу. Ровно такую запись потом нельзя отличить от заведённой мимо
    // конвейера, а весь смысл маркера в этом различении.
    'Intake Run ID': options.runId ?? newIntakeRunId(),
    'Intake Origin': buildIntakeOrigin(request.source),
    'Intake Contract Version': POI_INTAKE_CONTRACT_VERSION,
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
    // Пустое значение здесь означало бы «работает» — а это неправда, которую
    // потом никак не отличить от проверенной. Канон подставляет «Не проверено».
    'Operating Status': value.operatingStatus ?? 'Не проверено',
    'Season Window': value.seasonWindow || null,
    // Идентификаторы и то, что выведено из них. Без place_id ежемесячный
    // прогон обновления координат запись ПРОПУСКАЕТ, а «Работает»
    // проставить нечем — петля контроля закрытий не замыкается.
    ...(request.poi.resolved?.placeId ? { 'Google Place ID': request.poi.resolved.placeId } : {}),
    ...(request.poi.resolved?.prefectureRu ? { 'Prefecture (RU)': request.poi.resolved.prefectureRu } : {}),
    ...(request.poi.resolved?.prefectureEn ? { 'Prefecture (EN)': request.poi.resolved.prefectureEn } : {}),
    ...(request.poi.resolved?.nameJa ? { 'Name (JA)': request.poi.resolved.nameJa } : {}),
    ...(request.poi.resolved?.wikidataQid ? { 'Wikidata QID': request.poi.resolved.wikidataQid } : {}),
    ...(request.poi.resolved?.coordsCheckedAt ? { 'Coords Checked At': request.poi.resolved.coordsCheckedAt } : {}),
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
      // Сюда с вердиктом 'needs_review' попадают только через force:
      // без него приём остановлен выше и запись не создаётся.
      screen.verdict === 'needs_review'
        ? `Создана как ${created.poiId} по force, поверх остановки: ${screen.reasons.join(' ')}`
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
  options: { dryRun?: boolean; runId?: string } = {},
): Promise<PoiIngestResult[]> {
  const pool = await store.listExisting()
  const results: PoiIngestResult[] = []
  // Пакет — это один запуск. ID рождается здесь и один на все записи:
  // иначе по базе нельзя ответить, что приехало одним прогоном коллектора.
  const runId = options.runId ?? newIntakeRunId()

  for (const request of requests) {
    const result = await ingestPoi(request, store, { ...options, runId, existing: pool })
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
