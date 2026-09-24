/** Shared, append-only intake visibility. Review never authorizes a POI write. */
import { createHash } from 'node:crypto'
import { createReviewStore } from './poi-review-storage.ts'
import { validateReviewItem, type ReviewItem } from './poi-review.ts'
import type { PoiIngestRequest, PoiIngestResult } from './poi-ingest.ts'

export function reviewEventId(runId: string, item: ReviewItem): string {
  const hex = createHash('sha256').update(JSON.stringify(['poi-review-progress/v1', runId, item])).digest('hex')
  // Stable UUID-shaped identity; storage compares intent on replay.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

let lastProgressAt = 0

export async function recordReviewProgress(store: Pick<ReturnType<typeof createReviewStore>, 'append'>, runId: string, input: ReviewItem) {
  if (!runId.trim()) throw new Error('reviewRunIdRequired')
  const item = validateReviewItem(input)
  lastProgressAt = Math.max(Date.now(), lastProgressAt + 1)
  return store.append({ id: reviewEventId(runId, item), sourceKey: item.sourceKey, kind: 'progress', actor: 'agent', at: new Date(lastProgressAt).toISOString(), item })
}

export function intakeReviewItem(request: PoiIngestRequest, runId: string): ReviewItem {
  const source = request.source
  const externalKey = source.externalKey || `request-${createHash('sha256').update(JSON.stringify(request.poi)).digest('hex')}`
  return validateReviewItem({
    sourceKey: `${source.id}:${externalKey}`,
    nameRu: request.poi.nameRu || request.poi.nameEn || 'Название уточняется',
    nameEn: request.poi.nameEn || '',
    sourceUrl: source.url || 'https://jumboinjapan.com/admin/poi-review', googleUrl: '',
    problem: 'Карточка поступила в приём POI. Проверки и запись ещё не завершены.',
    nextStep: 'Агент проверит данные и сохранит результат здесь. Если прогон прервётся, сверит журнал и базу перед повтором.',
    ownerDecision: '', batch: runId, initialStatus: 'in_progress',
  })
}

type StoredRecord = { recordId: string; fields: Record<string, unknown> } | null
export type IntakeReviewHook = ((request: PoiIngestRequest, runId: string, work: () => Promise<PoiIngestResult>) => Promise<PoiIngestResult>) & {
  register?: (requests: PoiIngestRequest[], runId: string) => Promise<unknown>
}

export function createIntakeReview(options: {
  token?: string; baseId?: string; fetchImpl?: typeof fetch
  readCreated: (recordId: string, sourceKey?: string) => Promise<StoredRecord>
  reviewStore?: Pick<ReturnType<typeof createReviewStore>, 'append'>
}): IntakeReviewHook {
  const review = options.reviewStore ?? createReviewStore(options)
  const hook: IntakeReviewHook = async (request, runId, work) => {
    const item = intakeReviewItem(request, runId)
    // A missing queue/table/token stops before the POI side effect.
    await recordReviewProgress(review, runId, item)
    let result: PoiIngestResult
    try {
      result = await work()
      if (result.outcome === 'created') {
        if (!result.recordId || !result.poiId) throw new Error('reviewCreatedIdentityMissing')
        const actual = await options.readCreated(result.recordId, request.source.externalKey ? item.sourceKey : undefined)
        if (!actual || actual.recordId !== result.recordId || actual.fields['POI ID'] !== result.poiId
          || (request.source.externalKey && actual.fields['Source Key'] !== item.sourceKey)) throw new Error('reviewCreatedIdentityMismatch')
      }
    } catch (error) {
      // Never call work again here. A lost response can mean a completed write.
      try {
        await recordReviewProgress(review, runId, { ...item, initialStatus: 'needs_fix',
          problem: 'Приём прервался. Результат записи не подтверждён.',
          nextStep: 'Агенту: проверить журнал и перечитать базу по ключу источника. Не повторять создание до сверки. Подробности ошибки — в отчёте запуска.' })
      } catch (notificationError) {
        throw new AggregateError([error, notificationError], 'Приём прерван; очередь не обновилась. Карточка остаётся в работе. Нужна сверка базы.')
      }
      throw error
    }
    const created = result.outcome === 'created'
    // A duplicate still requires comparison of newly collected facts.
    const compare = result.outcome === 'already_ingested' || result.outcome === 'blocked_duplicate'
    try {
      await recordReviewProgress(review, runId, { ...item,
        initialStatus: created ? 'done' : 'needs_fix',
        problem: created ? `Создана карточка ${result.poiId}. Наличие записи подтверждено отдельным чтением.` : result.explanation || `Приём остановлен: ${result.outcome}.`,
        nextStep: created ? 'Карточка доступна в каталоге POI. Новые замечания можно оставить в этом обсуждении.'
          : compare ? 'Агенту: сравнить собранные факты с существующей карточкой и дополнить её через штатный sync. Повторно POI не создавать.'
          : 'Агенту: устранить указанную причину и повторить проверку. Вопрос владельцу задавать только при необходимости его решения.',
      })
    } catch (error) {
      throw new Error(`Результат приёма ${result.outcome}${result.poiId ? ` (${result.poiId})` : ''} получен, но очередь не обновилась. Перечитать базу; не повторять создание вслепую.`, { cause: error })
    }
    return result
  }
  hook.register = (requests, runId) => requests.length
    ? syncReviewSelection(review, { spec: 'poi-review-selection/v1', runId, items: requests.map(request => intakeReviewItem(request, runId)) })
    : Promise.resolve()
  return hook
}

/** Validate the ENTIRE selection before the first event. Includes rejected/unread candidates. */
export function reviewSelection(value: unknown): { spec: 'poi-review-selection/v1'; runId: string; items: ReviewItem[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('reviewSelectionRequired')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['spec', 'runId', 'items'].includes(k)) || v.spec !== 'poi-review-selection/v1'
    || typeof v.runId !== 'string' || !v.runId.trim() || v.runId.length > 150 || !Array.isArray(v.items) || !v.items.length) throw new Error('reviewSelectionInvalid')
  const items = v.items.map(validateReviewItem)
  if (new Set(items.map(i => i.sourceKey)).size !== items.length) throw new Error('reviewSelectionDuplicate')
  return { spec: 'poi-review-selection/v1', runId: v.runId, items }
}
export async function syncReviewSelection(store: Pick<ReturnType<typeof createReviewStore>, 'append'>, value: unknown) {
  const selection = reviewSelection(value)
  for (const item of selection.items) await recordReviewProgress(store, selection.runId, item)
  return { selected: selection.items.length, verified: selection.items.length }
}
