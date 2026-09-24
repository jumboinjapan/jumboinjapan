/** Read-only bridge from registered Intake identities to an ordered route. */
import { buildSourceKey, buildIntakeOrigin } from '../../src/lib/poi-ingest.ts'
import { routePoiIssues } from '../../src/lib/route-poi-readiness.ts'
import { canonicalJsonBytes, assertExactKeys } from './canonical-contract.mjs'

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 10000) throw new Error(`${label}: expected non-empty, trimmed text`)
}
function keys(value, required, optional, label) {
  assertExactKeys(value, [...required, ...optional.filter(k => Object.hasOwn(value ?? {}, k))], label)
}
function list(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Error(`${label}: expected 1–200 entries`)
}
function unique(set, key, label) {
  text(key, label)
  if (set.has(key)) throw new Error(`${label}: duplicate ${key}`)
  set.add(key)
}

export function validateRouteIntakePlan(plan) {
  // Inspect raw values before projection: getters, sparse arrays and hidden keys fail.
  canonicalJsonBytes(plan, 'route-intake-plan/v1')
  keys(plan, ['version', 'routeSlug', 'places', 'steps'], [], 'plan')
  if (plan.version !== 1) throw new Error('Unsupported route intake version')
  text(plan.routeSlug, 'routeSlug')
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(plan.routeSlug)) throw new Error('routeSlug: expected category/slug')
  list(plan.places, 'places'); list(plan.steps, 'steps')
  const places = new Set(), identities = new Set(), steps = new Set(), used = new Set()
  for (const place of plan.places) {
    const bySource = Object.hasOwn(place, 'source')
    keys(place, ['key', 'label', bySource ? 'source' : 'poiId'], [], 'place')
    unique(places, place.key, 'place.key'); text(place.label, 'place.label')
    let identity
    if (bySource) {
      keys(place.source, ['kind', 'id', 'externalKey', 'url'], [], 'source')
      for (const [k, v] of Object.entries(place.source)) text(v, `source.${k}`)
      buildIntakeOrigin(place.source)
      if (/\s|[\u0000-\u001f\u007f]/u.test(place.source.url)) throw new Error('source.url: invalid whitespace')
      const url = new URL(place.source.url)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('source.url: expected public HTTPS URL')
      identity = `source:${buildSourceKey(place.source)}`
    } else {
      if (typeof place.poiId !== 'string' || !/^POI-\d{6}$/.test(place.poiId)) throw new Error('place.poiId: invalid POI ID')
      identity = `poi:${place.poiId}`
    }
    unique(identities, identity, 'place identity; reuse place.key for revisits')
  }
  for (const step of plan.steps) {
    if (step.kind === 'poi') {
      keys(step, ['key', 'kind', 'placeKey'], ['context'], 'step')
      if (!places.has(step.placeKey)) throw new Error(`step ${step.key}: unknown placeKey`)
      if (Object.hasOwn(step, 'context')) text(step.context, 'step.context')
      used.add(step.placeKey)
    } else if (step.kind === 'note') {
      keys(step, ['key', 'kind', 'text'], [], 'step'); text(step.text, 'step.text')
    } else throw new Error('step.kind: expected poi or note')
    unique(steps, step.key, 'step.key')
  }
  if (used.size !== places.size) throw new Error('Unreferenced places: every primary place must have a step')
  return plan
}

/** loadPois must return a fresh full identity/readiness snapshot, not cached display data. */
export async function assembleRouteIntakePlan(raw, { loadPois }) {
  const plan = structuredClone(validateRouteIntakePlan(raw))
  const pois = await loadPois()
  if (!Array.isArray(pois)) throw new Error('Invalid POI snapshot')
  const resolved = new Map(), issues = [], registrationQueue = []
  for (const place of plan.places) {
    const sourceKey = place.source ? buildSourceKey(place.source) : null
    const matches = pois.filter(p => sourceKey ? p.sourceKey === sourceKey : p.poiId === place.poiId)
    if (matches.length !== 1) {
      const code = matches.length ? 'ambiguous_identity' : sourceKey ? 'needs_registration' : 'unknown_poi'
      issues.push({ key: place.key, label: place.label, code, candidates: matches.map(p => p.poiId) })
      if (code === 'needs_registration') registrationQueue.push({ ...place, sourceKey })
      continue
    }
    const poi = matches[0]
    const readiness = routePoiIssues([{ key: place.key, poiId: poi.poiId }], pois)
    if (readiness.length) issues.push(...readiness)
    else resolved.set(place.key, poi)
  }
  // Different selectors can refer to the same POI; make that identity explicit.
  const seen = new Map()
  for (const [key, poi] of resolved) {
    if (seen.has(poi.poiId)) issues.push({ key, code: 'duplicate_place', poiId: poi.poiId, otherKey: seen.get(poi.poiId) })
    else seen.set(poi.poiId, key)
  }
  const report = { version: 1, routeSlug: plan.routeSlug, status: issues.length ? 'blocked' : 'ready', readOnly: true, issues, registrationQueue }
  if (issues.length) return report
  const steps = plan.steps.map((step, index) => {
    if (step.kind === 'note') return { ...step, order: index + 1 }
    const poi = resolved.get(step.placeKey)
    return { ...step, order: index + 1, poiId: poi.poiId, title: poi.nameRu }
  })
  return {
    ...report,
    steps,
    preflight: { version: 1, routeSlug: plan.routeSlug, stops: steps.filter(s => s.kind === 'poi').map(s => ({ key: s.key, poiId: s.poiId })) },
    dayItems: steps.map(s => ({
      id: `${plan.routeSlug}/${s.key}`, order: s.order, itemType: s.kind,
      ...(s.kind === 'poi' ? { poiId: s.poiId } : {}),
      displayTitle: s.kind === 'poi' ? s.title : s.text, displayTitleEn: '',
      shortDescription: s.context ?? '', shortDescriptionEn: '',
      sourceMode: 'manual', locked: false, poiTitle: s.title ?? '', transportSegmentId: null, internalNotes: '',
    })),
  }
}
