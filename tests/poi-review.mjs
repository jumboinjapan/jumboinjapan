import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import seed from '../src/data/poi-review-seed.json' with { type: 'json' }
import { projectReview, ownerReviewEvent, validateReviewEvent, validateReviewItem } from '../src/lib/poi-review.ts'
import { createReviewStore } from '../src/lib/poi-review-storage.ts'
import { POI_REVIEW_TABLE_NAME } from '../src/lib/airtable-schema.ts'

const key = 'japan-guide:e3879'
const at = '2026-09-09T15:00:00.000Z'
const event = (overrides = {}) => ({ id: randomUUID(), sourceKey: key, kind: 'comment', text: 'Проверить имя и продолжить.', actor: 'owner', at, ...overrides })

test('real batch has 50 unique rows and preserves owner deferrals', () => {
  const rows = projectReview(seed, [])
  assert.equal(rows.length, 50)
  assert.equal(rows.filter(row => row.status === 'done').length, 22)
  assert.equal(rows.filter(row => row.status === 'deferred').length, 4)
  assert.equal(rows.filter(row => row.status === 'needs_decision').length, 2)
  assert.match(rows.find(row => row.sourceKey === 'japan-guide:e3480').ownerDecision, /дочерние/)
})
test('an agent import never erases comments or owner status', () => {
  const original = seed.find(item => item.sourceKey === key)
  const comment = event()
  const status = event({ kind: 'status', text: undefined, status: 'deferred', at: '2026-09-09T15:01:00.000Z' })
  delete status.text
  const update = { id: randomUUID(), sourceKey: key, actor: 'agent', at: '2026-09-09T15:02:00.000Z', kind: 'item', item: { ...original, problem: 'Причина уточнена', initialStatus: 'ready' } }
  const row = projectReview(seed, [update, status, comment]).find(row => row.sourceKey === key)
  assert.equal(row.status, 'deferred')
  assert.equal(row.problem, 'Причина уточнена')
  assert.equal(row.history.filter(e => e.kind === 'comment')[0].text, comment.text)
  assert.equal(row.needsAgentReply, true, 'metadata import must not acknowledge the owner')
})
test('owner messages await agent; an agent response clears the queue flag', () => {
  const a = event(), b = event({ actor: 'agent', at: '2026-09-09T16:00:00.000Z' })
  assert.equal(projectReview(seed, [a]).find(r => r.sourceKey === key).needsAgentReply, true)
  assert.equal(projectReview(seed, [a, b]).find(r => r.sourceKey === key).needsAgentReply, false)
})
test('retry deduplicates the same intent but rejects a reused ID with other content', () => {
  const a = event(), b = { ...a, at: '2026-09-09T15:00:01.000Z' }
  assert.equal(projectReview(seed, [a, b]).find(r => r.sourceKey === key).history.length, 1)
  assert.throws(() => projectReview(seed, [a, { ...b, text: 'Другое решение' }]), /один идентификатор/)
})
test('owner endpoint cannot impersonate agent or change card metadata', () => {
  assert.throws(() => ownerReviewEvent({ id: randomUUID(), sourceKey: key, kind: 'comment', text: 'x', actor: 'agent' }, at), /Неизвестное поле/)
  assert.throws(() => ownerReviewEvent({ id: randomUUID(), sourceKey: key, kind: 'item' }, at), /недоступно/)
  assert.equal(ownerReviewEvent({ id: randomUUID(), sourceKey: key, kind: 'comment', text: 'x' }, at).actor, 'owner')
})
test('rejects unsafe links, unknown statuses, blank comments and mixed event payloads', () => {
  assert.throws(() => validateReviewItem({ ...seed[0], googleUrl: 'javascript:alert(1)' }), /ссылка/)
  assert.throws(() => validateReviewItem({ ...seed[0], initialStatus: '__proto__' }), /статус/)
  assert.throws(() => validateReviewEvent(event({ text: '  ' })), /комментарий/)
  assert.throws(() => validateReviewEvent(event({ status: 'done' })), /действие/)
  assert.throws(() => projectReview(seed, [event({ sourceKey: 'japan-guide:e999999' })]), /отсутствующей/)
})

function fakeAirtable({ failAfterCreate = false } = {}) {
  const records = []
  const calls = []
  let fail = failAfterCreate
  const fetchImpl = async (rawUrl, init = {}) => {
    const url = new URL(rawUrl)
    const basePath = `/v0/test-base/${encodeURIComponent(POI_REVIEW_TABLE_NAME)}`
    assert(url.pathname === basePath || url.pathname.startsWith(basePath + '/'), 'writer must address only the review table')
    assert(['GET', 'POST'].includes(init.method ?? 'GET'), 'no PATCH or DELETE')
    calls.push({ method: init.method ?? 'GET', url: String(url) })
    if (init.method === 'POST') {
      const body = JSON.parse(init.body)
      assert.deepEqual(Object.keys(body.records[0].fields).sort(), ['Event ID', 'Event JSON', 'Source Key'])
      const record = { id: 'rec' + records.length, fields: body.records[0].fields }
      records.push(record)
      if (fail) { fail = false; throw Error('Lost response after commit') }
      return Response.json({ records: [record] })
    }
    if (url.pathname !== basePath) return Response.json(records.find(r => url.pathname.endsWith('/' + r.id)))
    const formula = url.searchParams.get('filterByFormula')
    const all = formula ? records.filter(r => formula.includes(r.fields['Event ID'])) : records
    const start = Number(url.searchParams.get('offset') ?? 0)
    return Response.json({ records: all.slice(start, start + 1), ...(start + 1 < all.length ? { offset: String(start + 1) } : {}) })
  }
  return { fetchImpl, calls, records }
}
test('production store verifies persisted comment and reloads across independent clients', async () => {
  const fake = fakeAirtable()
  const options = { token: 'fake', baseId: 'test-base', fetchImpl: fake.fetchImpl }
  const a = event(), b = event({ text: 'Второй комментарий', actor: 'agent' })
  await Promise.all([createReviewStore(options).append(a), createReviewStore(options).append(b)])
  const fresh = await createReviewStore(options).load()
  assert.equal(fresh.find(r => r.sourceKey === key).history.length, 2)
  assert.equal(fake.calls.filter(c => c.method === 'POST').length, 2)
  assert(fake.calls.some(c => c.url.includes('offset=1')), 'pagination executed')
})
test('lost write response is reconciled on retry, without a second create', async () => {
  const fake = fakeAirtable({ failAfterCreate: true })
  const store = createReviewStore({ token: 'fake', baseId: 'test-base', fetchImpl: fake.fetchImpl })
  const a = event()
  await assert.rejects(store.append(a), /Lost response/)
  const result = await store.append({ ...a, at: '2026-09-09T15:03:00.000Z' })
  assert.equal(result.id, a.id)
  assert.equal(fake.records.length, 1)
  await assert.rejects(store.append({ ...a, text: 'Подмена' }), /другого изменения/)
  assert.equal(fake.records.length, 1)
})
test('unconfigured or unavailable storage never returns an empty success', async () => {
  await assert.rejects(createReviewStore({ token: '', baseId: '' }).load(), /не настроено/)
  await assert.rejects(createReviewStore({ token: 'fake', baseId: 'test-base', fetchImpl: async () => new Response('', { status: 403 }) }).load(), /403/)
})
