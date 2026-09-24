/** Shared selection registration for source readers; no POI creation here. */
import path from 'node:path'
import { open } from 'node:fs/promises'
import { durableDirectory } from './write-journal.mjs'
import { createReviewStore } from '../../../src/lib/poi-review-storage.ts'
import { reviewSelection, syncReviewSelection } from '../../../src/lib/poi-review-lifecycle.ts'

async function saveSelection(file, selection) {
  const handle = await open(file, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(selection, null, 2) + '\n'); await handle.sync() } finally { await handle.close() }
  await durableDirectory(path.dirname(file))
}

export async function registerSourceSelection(subjects, directory, deps = {}) {
  const selection = reviewSelection({ spec: 'poi-review-selection/v1', runId: path.basename(directory), items: subjects.map(subject => ({
    sourceKey: subject.sourceKey, nameRu: subject.nameRu || subject.nameEn || subject.sourceKey,
    nameEn: subject.nameEn || '', sourceUrl: subject.sourceUrl, googleUrl: '', ownerDecision: '',
    batch: path.basename(directory), initialStatus: 'in_progress',
    problem: 'Место включено в сбор. Чтение источника и проверка фактов ещё не завершены.',
    nextStep: 'Агенту: прочитать источник, проверить место и подготовить карточку. При ошибке сохранить её причину в этом обсуждении. Решение владельца пока не требуется.',
  })) })
  // Recovery input is persisted BEFORE the first remote append. Retry only sync,
  // never repeat a POI creation to repair visibility.
  await saveSelection(path.join(directory, 'review-selection.json'), selection)
  const review = deps.reviewStore ?? createReviewStore()
  return syncReviewSelection(review, selection)
}

/** Every selected source must get a reading result, including transport failures. */
export async function finishSourceSelection(outcomes, directory, deps = {}) {
  const { readFile } = await import('node:fs/promises')
  const original = reviewSelection(JSON.parse(await readFile(path.join(directory, 'review-selection.json'), 'utf8')))
  const byKey = new Map(outcomes.map(row => [row.sourceKey, row]))
  if (byKey.size !== outcomes.length || byKey.size !== original.items.length || original.items.some(i => !byKey.has(i.sourceKey))) throw new Error('reviewSelectionCoverageMismatch')
  const completed = reviewSelection({ ...original, items: original.items.map(item => {
    const outcome = byKey.get(item.sourceKey)
    return { ...item, nameRu: outcome.name || item.nameRu, initialStatus: outcome.ok ? 'in_progress' : 'needs_fix',
      problem: outcome.ok ? 'Источник прочитан. Факты и описания ещё требуют подготовки и проверки.' : `Источник прочитан не полностью: ${outcome.reason}`,
      nextStep: outcome.ok ? 'Агенту: разобрать сохранённые материалы, проверить точку, подготовить досье и описания, затем выполнить штатный приём POI.'
        : 'Агенту: устранить ошибку чтения и собрать недостающие материалы. Не просить владельца повторять техническую проверку.',
    }
  }) })
  await saveSelection(path.join(directory, 'review-result.json'), completed)
  return syncReviewSelection(deps.reviewStore ?? createReviewStore(), completed)
}
