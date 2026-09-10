/** Shared storage/API/UI vocabulary. Facts outlive any particular description.
 * This validates structure and provenance links, not the truth of agent prose. */
export const POI_FACTS_SPEC = 'poi-facts/v1'
export const FACT_CATEGORIES = {
  notice: 'Предупреждения', identity: 'Что это за место', composition: 'Состав и связи', visiting: 'Посещение',
  access: 'Как добраться', season: 'Сезонность', experience: 'Что посмотреть',
  history: 'История', culture: 'Культура и предания', route: 'Для программы',
} as const
export type FactCategory = keyof typeof FACT_CATEGORIES
export type PoiFact = {
  id: string; subject: string; category: FactCategory; text: string; conditions: string;
  status: 'reported' | 'verified' | 'legend' | 'interpretation' | 'conflicting' | 'unknown';
  references: { source: number; blockId: string }[];
}
export type PoiFacts = {
  spec: typeof POI_FACTS_SPEC; sourceKey: string; updatedAt: string;
  sources: { url: string; observedAt: string; evidenceDigest: string;
    blocks: { id: string; kind: string; locator: string; section: string }[] }[];
  facts: PoiFact[];
  coverage: { source: number; blockId: string; disposition: 'facts' | 'irrelevant' | 'unresolved'; reason: string }[];
  visit: { status: 'unknown' | 'open' | 'temporaryClosed' | 'permanentlyClosed' | 'conflicting';
    hoursKind: 'unknown' | 'stated' | 'alwaysOpen'; hours: string; factIds: string[]; explanation: string };
  website: { url: string; factIds: string[] } | null;
  copy: { ru: { text: string; factIds: string[] }[]; en: { text: string; factIds: string[] }[] };
}
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(`poiFacts: ${reason}`) }
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !v.includes('\ufffd')
const refKey = (r: { source: number; blockId: string }) => `${r.source}:${r.blockId}`
function urlOk(v: string) { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password } catch { return false } }
function keys(v: object, allowed: string[]) { need(Object.keys(v).sort().join('|') === [...allowed].sort().join('|'), 'unexpected or missing field') }
export function assertPoiFacts(value: unknown): PoiFacts {
  need(value && typeof value === 'object', 'dossier required')
  const d = value as PoiFacts
  keys(d, ['spec','sourceKey','updatedAt','sources','facts','coverage','visit','website','copy'])
  need(d.spec === POI_FACTS_SPEC && /^japan-guide:[A-Za-z0-9_-]+$/.test(d.sourceKey), 'version or identity')
  need(filled(d.updatedAt) && Number.isFinite(Date.parse(d.updatedAt)), 'observation date')
  need(Array.isArray(d.sources) && d.sources.length > 0, 'sources required')
  const blocks = new Map<string, { id: string; kind: string; locator: string; section: string }>()
  d.sources.forEach((s, i) => {
    keys(s, ['url','observedAt','evidenceDigest','blocks'])
    need(urlOk(s.url) && filled(s.observedAt) && Number.isFinite(Date.parse(s.observedAt)), 'source URL/date')
    need(/^sha256:[a-f0-9]{64}$/.test(s.evidenceDigest) && Array.isArray(s.blocks) && s.blocks.length > 0, 'source evidence')
    for (const b of s.blocks) {
      keys(b, ['id','kind','locator','section'])
      const key = `${i}:${b.id}`
      need(filled(b.id) && filled(b.kind) && filled(b.locator) && filled(b.section) && !blocks.has(key), 'duplicate/invalid evidence block')
      blocks.set(key, b)
    }
  })
  need(Array.isArray(d.facts) && d.facts.length > 0, 'facts required')
  const ids = new Set<string>(), referenced = new Set<string>()
  for (const f of d.facts) {
    keys(f, ['id','subject','category','text','conditions','status','references'])
    need(filled(f.id) && !ids.has(f.id), 'duplicate/invalid fact ID'); ids.add(f.id)
    need(filled(f.subject) && filled(f.text) && typeof f.conditions === 'string', 'fact subject/text/conditions')
    need(Object.hasOwn(FACT_CATEGORIES, f.category), 'fact category')
    need(['reported','verified','legend','interpretation','conflicting','unknown'].includes(f.status), 'fact status')
    need(Array.isArray(f.references) && f.references.length > 0, 'fact evidence required')
    for (const r of f.references) { keys(r, ['source','blockId']); need(blocks.has(refKey(r)), 'unknown fact evidence'); referenced.add(refKey(r)) }
  }
  need(Array.isArray(d.coverage) && d.coverage.length === blocks.size, 'every evidence block needs a disposition')
  const covered = new Set<string>()
  for (const c of d.coverage) {
    keys(c, ['source','blockId','disposition','reason'])
    const key = refKey(c)
    need(blocks.has(key) && !covered.has(key), 'duplicate/unknown coverage'); covered.add(key)
    need(['facts','irrelevant','unresolved'].includes(c.disposition), 'coverage disposition')
    need(c.disposition === 'facts' ? referenced.has(key) : filled(c.reason), 'coverage needs facts or explanation')
    // An alert cannot disappear as decorative text or an ignored link.
    need(blocks.get(key)?.kind !== 'notice' || (c.disposition !== 'irrelevant' && d.facts.some(f => f.category === 'notice' && f.references.some(r => refKey(r) === key))), 'notice must be retained as a fact')
  }
  const checkIds = (list: string[], required = true) => {
    need(Array.isArray(list) && (!required || list.length > 0) && new Set(list).size === list.length && list.every(id => ids.has(id)), 'unknown/missing fact reference')
  }
  need(d.visit && ['unknown','open','temporaryClosed','permanentlyClosed','conflicting'].includes(d.visit.status), 'visit status')
  need(['unknown','stated','alwaysOpen'].includes(d.visit.hoursKind) && typeof d.visit.hours === 'string' && filled(d.visit.explanation), 'hours assessment')
  keys(d.visit, ['status','hoursKind','hours','factIds','explanation'])
  checkIds(d.visit.factIds, d.visit.status !== 'unknown' || d.visit.hoursKind !== 'unknown')
  need(d.visit.hoursKind === 'unknown' ? d.visit.hours === '' : filled(d.visit.hours), 'unknown hours cannot mean 24 hours')
  if (d.website !== null) { need(d.website && urlOk(d.website.url), 'website URL'); keys(d.website, ['url','factIds']); checkIds(d.website.factIds) }
  need(d.copy && Array.isArray(d.copy.ru) && Array.isArray(d.copy.en), 'bilingual copy required')
  keys(d.copy, ['ru','en'])
  for (const clauses of [d.copy.ru, d.copy.en]) {
    need(clauses.length > 0, 'copy clauses required')
    for (const c of clauses) { keys(c, ['text','factIds']); need(filled(c.text), 'copy text'); checkIds(c.factIds) }
  }
  return d
}
export const FACTS_START = '\n[JUMBO_POI_FACTS_V1]\n'
export const FACTS_END = '\n[/JUMBO_POI_FACTS_V1]\n'
/** No raw article text here. The payload contains independent facts and locators. */
export function readPoiFacts(notes: string): { dossier: PoiFacts | null; error: string | null } {
  try {
    const start = notes.indexOf(FACTS_START), end = notes.indexOf(FACTS_END)
    if (start < 0 && end < 0) return { dossier: null, error: null }
    need(start >= 0 && end > start && notes.indexOf(FACTS_START, start + 1) < 0 && notes.indexOf(FACTS_END, end + 1) < 0, 'damaged or duplicate storage block')
    return { dossier: assertPoiFacts(JSON.parse(notes.slice(start + FACTS_START.length, end))), error: null }
  } catch (e) { return { dossier: null, error: e instanceof Error ? e.message : 'Invalid fact dossier' } }
}
export function storePoiFacts(notes: string, dossier: PoiFacts): string {
  assertPoiFacts(dossier)
  const old = readPoiFacts(notes)
  need(!old.error, 'cannot replace corrupt dossier')
  const block = FACTS_START + JSON.stringify(dossier) + FACTS_END
  const result = old.dossier
    ? notes.slice(0, notes.indexOf(FACTS_START)) + block + notes.slice(notes.indexOf(FACTS_END) + FACTS_END.length)
    : notes + block
  // Conservative transport limit, not an editorial or fact-count limit. Fail
  // before I/O with all input intact; never truncate a fact or the older notes.
  need(result.length <= 90000, 'storage capacity exceeded; split the dossier explicitly before writing')
  return result
}
