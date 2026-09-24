import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createIntakeReview, intakeReviewItem, recordReviewProgress, syncReviewSelection } from '../src/lib/poi-review-lifecycle.ts'
import { createReviewStore } from '../src/lib/poi-review-storage.ts'
import { projectReview, isReviewArchived, ownerReviewEvent } from '../src/lib/poi-review.ts'
import { ingestPoi } from '../src/lib/poi-ingest.ts'
import { createAirtablePoiStore } from '../scripts/poi-portals/lib/airtable-store.mjs'
import { reviewService } from './fixtures/poi-review-service.mjs'
const request = { source: { kind: 'external-agent', id: 'new-portal', externalKey: 'test-1', url: 'https://example.org/place' }, poi: { nameRu: 'Музей', siteCity: '' } }
const result = { outcome: 'created', poiId: 'POI-123456', recordId: 'rec12345678901234', explanation: '', fields: {}, canonIssues: [], screen: null }
function setup() {
  const service = reviewService()
  const store = createReviewStore({ token: 'fake', baseId: 'fake', fetchImpl: service.fetchImpl })
  let reads = 0
  const hook = createIntakeReview({ reviewStore: store, readCreated: async id => { reads++; return { recordId: id, fields: { 'POI ID': result.poiId, 'Source Key': 'new-portal:test-1' } } } })
  return { service, store, hook, reads: () => reads }
}
test('REGISTRATION_FAILURE_PREVENTS_POI_WORK', async () => {
  let work = 0
  const hook = createIntakeReview({ reviewStore: { append: async () => { throw Error('offline') } }, readCreated: async () => null })
  await assert.rejects(hook(request, 'run-1', async () => { work++; return result }), /offline/)
  assert.equal(work, 0)
})
test('CREATED_IS_READ_BACK_AND_REPLAY_DOES_NOT_DUPLICATE_EVENTS', async () => {
  const s = setup()
  await s.hook(request, 'run-1', async () => result)
  assert.equal(s.reads(), 1)
  const [row] = (await s.store.load()).filter(r => r.sourceKey === 'new-portal:test-1')
  assert.equal(row.status, 'done'); assert.equal(isReviewArchived(row), true)
  await s.hook(request, 'run-1', async () => result)
  assert.equal(s.service.records.length, 2)
})
test('PIPELINE_DOES_NOT_ACKNOWLEDGE_OWNER_OR_ERASE_DECISION', async () => {
  const item = { ...intakeReviewItem(request, 'run-1'), ownerDecision: 'Сохранить отдельной карточкой.' }
  const owner = ownerReviewEvent({ id: randomUUID(), sourceKey: item.sourceKey, kind: 'comment', text: 'Проверьте часы' }, '2026-09-01T01:00:00.000Z')
  const progress = { id: randomUUID(), sourceKey: item.sourceKey, kind: 'progress', actor: 'agent', at: '2026-09-01T02:00:00.000Z', item: { ...item, ownerDecision: '', initialStatus: 'done' } }
  const [row] = projectReview([item], [owner, progress])
  assert.equal(row.needsAgentReply, true); assert.equal(isReviewArchived(row), false)
  assert.equal(row.ownerDecision, item.ownerDecision)
  assert.equal(row.history[0].text, owner.text)
  assert.throws(() => ownerReviewEvent({ id: randomUUID(), sourceKey: item.sourceKey, kind: 'progress', item }), /недоступно|Неизвестное поле/)
})
test('MISMATCH_AND_LOST_WRITE_RESPONSE_STAY_VISIBLE_WITHOUT_RETRY', async () => {
  const s = setup(); let writes = 0
  const hook = createIntakeReview({ reviewStore: s.store, readCreated: async () => null })
  await assert.rejects(hook(request, 'mismatch', async () => { writes++; return result }), /Mismatch/)
  await assert.rejects(s.hook(request, 'lost', async () => { writes++; throw Error('lost response') }), /lost response/)
  assert.equal(writes, 2)
  assert.equal((await s.store.load()).find(r => r.sourceKey === 'new-portal:test-1').status, 'needs_fix')
})
test('FINISH_FAILURE_NEVER_REPEATS_CREATE', async () => {
  let events = 0, writes = 0
  const hook = createIntakeReview({ reviewStore: { append: async e => { if (++events > 1) throw Error('offline'); return e } }, readCreated: async id => ({ recordId: id, fields: { 'POI ID': result.poiId, 'Source Key': 'new-portal:test-1' } }) })
  await assert.rejects(hook(request, 'failure', async () => { writes++; return result }), /очередь не обновилась/)
  assert.equal(writes, 1)
})
test('WHOLE_SELECTION_VALIDATED_AND_ALL_UNREAD_CANDIDATES_REGISTERED', async () => {
  const s = setup(), item = intakeReviewItem(request, 'selection')
  const selection = { spec: 'poi-review-selection/v1', runId: 'selection', items: [item, { ...item, sourceKey: 'tour:stop-2' }] }
  await assert.rejects(syncReviewSelection(s.store, { ...selection, items: [item, { ...item, sourceUrl: 'javascript:x' }] }))
  assert.equal(s.service.records.length, 0)
  await syncReviewSelection(s.store, selection)
  await syncReviewSelection(s.store, selection)
  assert.equal(s.service.records.length, 2)
  await assert.rejects(syncReviewSelection(s.store, { ...selection, items: [item, item] }), /Duplicate/)
})
test('REAL_CORE_REPORTS_REJECTION_AND_DRY_RUN_HAS_NO_REVIEW_EFFECT', async () => {
  const s = setup()
  const store = { reviewIntake: s.hook, listExisting: async () => [], findBySourceKey: async () => null, create: async () => { throw Error('must not create') } }
  const rejected = await ingestPoi(request, store, { runId: 'core' })
  assert.equal(rejected.outcome, 'rejected_canon')
  assert.equal((await s.store.load()).find(r => r.sourceKey === 'new-portal:test-1').status, 'needs_fix')
  const count = s.service.records.length
  await ingestPoi(request, store, { runId: 'dry', dryRun: true })
  assert.equal(s.service.records.length, count)
})
test('PRODUCTION_CLI_STORE_INSTALLS_TRACKING_AND_DRY_FACTORY_DOES_NOT', () => {
  const options = { token: 'fake', baseId: 'fake', fetchImpl: async () => { throw Error('unexpected') } }
  assert.equal(typeof createAirtablePoiStore(options).reviewIntake, 'function')
  assert.equal(createAirtablePoiStore({ ...options, dryRun: true }).reviewIntake, undefined)
})
test('DUPLICATE_DOES_NOT_CLOSE_FACT_COMPARISON', async () => {
  const s = setup()
  await s.hook(request, 'duplicate', async () => ({ ...result, outcome: 'already_ingested' }))
  const row = (await s.store.load()).find(r => r.sourceKey === 'new-portal:test-1')
  assert.equal(row.status, 'needs_fix'); assert.match(row.nextStep, /сравнить/); assert.equal(s.reads(), 0)
})
test('RECOVERY_EVENT_ID_IS_SAME_ACROSS_CLIENTS', async () => {
  const s = setup(), item = intakeReviewItem(request, 'recover')
  const a = await recordReviewProgress(s.store, 'recover', item)
  const b = await recordReviewProgress(s.store, 'recover', item)
  assert.equal(a.id, b.id); assert.equal(s.service.records.length, 1)
})

test('AUTOMATION_PRESERVES_EXPLICIT_OWNER_DEFERRAL', () => {
  const item = intakeReviewItem(request, 'owner-defers')
  const status = ownerReviewEvent({ id: randomUUID(), sourceKey: item.sourceKey, kind: 'status', status: 'deferred' }, '2026-09-01T01:00:00.000Z')
  const progress = { id: randomUUID(), sourceKey: item.sourceKey, kind: 'progress', actor: 'agent', at: '2026-09-01T02:00:00.000Z', item: { ...item, initialStatus: 'in_progress' } }
  assert.equal(projectReview([item], [status, progress])[0].status, 'deferred')
})

test('WHOLE_INTAKE_BATCH_REGISTERED_BEFORE_FIRST_WRITE_FAILURE', async () => {
  const s = setup()
  const requests = [request, { ...request, source: { ...request.source, externalKey: 'test-2' } }]
  await s.hook.register(requests, 'batch-before-write')
  await assert.rejects(s.hook(requests[0], 'batch-before-write', async () => { throw Error('write stopped') }))
  const rows = await s.store.load()
  assert.equal(rows.find(r => r.sourceKey === 'new-portal:test-2').status, 'in_progress')
})
