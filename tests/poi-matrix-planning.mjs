import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as planning from '../scripts/poi-portals/lib/poi-matrix-planning.mjs';
import { buildPoiMatrix, matchesPoiMatrix } from '../scripts/poi-portals/lib/poi-matrix.mjs';
import { readMatrixRecord } from '../scripts/poi-portals/lib/poi-matrix-catalog.mjs';
import { storePoiFacts } from '../src/lib/poi-facts.ts';
import fixtures from './fixtures/poi-matrix-examples.json' with { type: 'json' };
let checks = 0;
const check = async (name, fn) => { try {
    await fn();
    checks++;
}
catch (e) {
    throw new Error(`${name}: ${e.message}`, { cause: e });
} };
const now = fixtures.observedAt;
const record = (f, i = 0) => ({ id: `rec${String(i).padStart(14, '0')}`, fields: { ...f.context.fields, ...(f.kind === 'legacy' ? {} : { Notes: storePoiFacts('', f.context.dossier), 'POI Matrix': JSON.stringify(buildPoiMatrix(f.claims, f.context)) }) } });
const records = fixtures.fixtures.map(record);
const query = (group, codes, mode = 'any') => ({ ...planning.emptyPlanningQuery(), required: { groups: [{ group, codes, mode }], childAges: [] } });
const run = (q, rs = records, time = now) => planning.planPoiSelection(rs, q, time);
await check('PLANNING full population before pagination', () => {
    const first = run(planning.emptyPlanningQuery()), second = run({ ...planning.emptyPlanningQuery(), page: 2 });
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 20);
    assert.equal(first.totals.matched, 40);
    assert.equal(new Set([...first.items, ...second.items].map(r => r.poiId)).size, 40);
    const target = second.items.at(-1);
    assert.equal(run({ ...planning.emptyPlanningQuery(), search: target.poiId }).items[0].poiId, target.poiId);
    assert.deepEqual(run(planning.emptyPlanningQuery(), [...records].reverse()), first);
});
for (const [group, codes, mode] of [['functions', ['exhibition', 'garden_visit'], 'any'], ['themes', ['history', 'architecture'], 'all'], ['kinds', ['kind_aquarium'], 'any']])
    await check(`PLANNING shared predicate ${group}/${mode}`, () => {
        const q = query(group, codes, mode), expected = records.filter(r => matchesPoiMatrix(readMatrixRecord(r.fields, now).projection, q.required)).map(r => r.fields['POI ID']);
        const found = [...run(q).items, ...run({ ...q, page: 2 }).items].map(r => r.poiId);
        assert.deepEqual(found.sort(), expected.sort());
        assert(expected.length > 0);
    if(mode==='any')assert(run(q).items.every(r=>r.unchecked.length===0),'satisfied OR group needs no extra checks');
        assert.equal(Object.values(run(q).totals).reduce((a, b) => a + b, 0), 40);
    });
await check('PLANNING preferences rank without exclusion', () => {
    const r = run({ ...planning.emptyPlanningQuery(), preferred: ['art'] });
    assert.equal(r.totals.matched, 40);
    assert(r.items[0].score > 0);
    assert(r.items.slice(1).every((v, i) => v.score <= r.items[i].score));
    const evidence = r.items[0].evidence.find(e => e.code === 'art');
    assert(evidence.facts.length > 0);
    assert(evidence.facts.every(f => f.text && f.sources.length));
});
await check('PLANNING unknown is not a prohibition', () => {
    const q = query('conditions', ['step_free']), r = run(q);
    assert(r.totals.needsCheck > 0);
    const missing = run({ ...q, bucket: 'needsCheck' }).items.find(r => r.matrixState === 'missing');
    assert(missing);
    assert(missing.unchecked.some(c => c.code === 'step_free'));
});
await check('PLANNING corrupted matrix is visible not positive', () => {
    const r = structuredClone(records[0]);
    r.fields['POI Matrix'] = '{';
    const result = run({ ...query('themes', ['art']), bucket: 'needsCheck' }, [r]);
    assert.equal(result.items[0].matrixState, 'invalid');
    assert.equal(result.totals.matched, 0);
});
await check('PLANNING no inherited matrix properties', () => {
    const r = structuredClone(records.find(r => !r.fields['POI Matrix']));
    r.fields['Parent POI'] = [records[0].id];
    assert.equal(run(query('themes', ['art']), [r]).totals.matched, 0);
});
await check('PLANNING geography before counts', () => {
    const rows = records.map(r => ({ id: r.id, fields: { 'POI ID': r.fields['POI ID'], 'Site City': 'Kyoto', 'Prefecture (EN)': 'Kyoto', 'POI Name (RU)': 'Точка' } }));
    const q = planning.emptyPlanningQuery();
    q.geography.region = 'kansai';
    assert.equal(run(q, rows).totals.matched, 40);
    q.geography.region = 'hokkaido';
    assert.equal(run(q, rows).totals.matched, 0);
});
const family = structuredClone(fixtures.fixtures.find(f => f.poiId === 'POI-000927'));
family.claims = [{ code: 'children', state: 'supported', factIds: ['family'], conditionFactIds: ['access'], ageRange: { min: 6, max: 12 }, checkedAt: family.context.now, validUntil: new Date(Date.parse(family.context.now) + 86400000).toISOString(), rationale: 'Synthetic age suitability.' }];
const references = family.context.dossier.facts[0].references;
family.context.dossier.facts.push({ id: 'family', subject: family.context.nameRu, category: 'visiting', status: 'verified', text: 'Synthetic: designed for children aged 6–12.', conditions: '', references }, { id: 'access', subject: family.context.nameRu, category: 'access', status: 'verified', text: 'Synthetic: children attend with an adult.', conditions: 'An accompanying adult is required.', references });
await check('PLANNING suitability range is not age ban', () => {
    const q = planning.emptyPlanningQuery();
    q.required.childAges = [5];
    const r = run(q, [record(family)]);
    assert.equal(r.totals.excluded, 0);
    assert.equal(r.items[0].childConditionsUnknown, true);
    const strict = query('audience', ['children']);
    strict.required.childAges = [5];
    assert.equal(run(strict, [record(family)]).totals.needsCheck, 1);
    strict.required.childAges = [7];
    assert.equal(run(strict, [record(family)]).totals.matched, 1);
});
await check('PLANNING prohibition is bound to stated age range', () => {
    const f = structuredClone(family);
    f.claims[0].state = 'refuted';
    const q = planning.emptyPlanningQuery();
    q.required.childAges = [7];
    assert.equal(run(q, [record(f)]).totals.excluded, 1);
    q.required.childAges = [15];
    assert.equal(run(q, [record(f)]).totals.excluded, 0);
    q.required.childAges = [7];
    assert.equal(run(q, [record(f)], '2030-01-01T00:00:00.000Z').totals.excluded, 0);
});
await check('PLANNING expiry does not silently retain support', () => {
    assert.equal(run(query('functions', ['exhibition']), records, '2030-01-01T00:00:00.000Z').totals.matched, 0);
});
await check('PLANNING distinct physical and business identities', () => {
    assert.throws(() => run(planning.emptyPlanningQuery(), [records[0], records[0]]), /planningDuplicate/);
    assert.throws(() => run(planning.emptyPlanningQuery(), [records[0], { ...records[0], id: 'other' }]), /planningPoiIdentity/);
});
await check('PLANNING malformed selection refused', () => {
    for (const mutate of [q => q.page = 0, q => q.preferred = ['children'], q => q.geography.region = 'toString', q => q.extra = true, q => q.required.groups = [{ group: 'themes', codes: ['exhibition'], mode: 'all' }]]) {
        const q = planning.emptyPlanningQuery();
        mutate(q);
        assert.throws(() => run(q));
    }
});
await check('PROFILE v3 fields are suggestions without PII', () => {
    const result = planning.planningFromProfile({ interests: ['culture', 'art_hunting'], mobility: ['limited_mobility'], group: { children: [{ age: 7 }] }, pace: 'few_moves', interests_depth: 'accent', contact: { email: 'private@example.test' }, notes: 'private notes', name: 'Private Name' });
    assert(result.query.preferred.includes('art'));
    assert(result.query.required.groups[0].codes.includes('step_free'));
    assert.deepEqual(result.query.required.childAges, [7]);
    assert(!JSON.stringify(result).includes('private'));
    assert(!JSON.stringify(result).includes('Private Name'));
    assert(!result.explanations.some(s => s.includes('art_hunting')));
});
await check('PROFILE legacy and free prose cannot invent constraints', () => {
    const legacy = planning.planningFromProfile(null, { interests: ['photography'], mobility: 'wheelchair', children: '[{"age":8}]', pace: 'relaxed' });
    assert.deepEqual(legacy.query.required.childAges, [8]);
    assert.deepEqual(legacy.query.preferred, ['scenic_view']);
    assert.equal(legacy.query.required.groups[0].codes[0], 'step_free');
    const free = planning.planningFromProfile(null, { children: 'два подростка', interests: ['неизвестно'] });
    assert.equal(free.query.required.childAges.length, 0);
    assert.equal(free.query.preferred.length, 0);
    assert(free.notices.length > 0);
    const blank = planning.planningFromProfile({ interests: [], mobility: [], group: { children: [] } }, { interests: ['photography'], children: '[8]' });
    assert.deepEqual(blank.query, planning.emptyPlanningQuery());
});
function loadRoute(imports) {
    const source = fs.readFileSync(new URL('../src/app/api/admin/multi-day/pois/route.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, exports = {};
    vm.runInNewContext(js, { exports, require: id => { assert(Object.hasOwn(imports, id), `Unexpected import: ${id}`); return imports[id]; }, URL, console, JSON });
    return exports.GET;
}
await check('API auth validation read and failures on real handler', async () => {
    let reads = 0, denied = false, broken = false;
    const GET = loadRoute({ 'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } }, '@/lib/admin-guard': { requireAdminSession: async () => denied ? { status: 401 } : null }, '@/lib/airtable': { getPoiRecordsForMatrix: async () => { reads++; if (broken)
                throw Error('secret error'); return records; } }, '@/lib/multi-day-builder-data': { buildMultiDayBuilderPoiOptions: rs => rs.map(r => ({ poiId: r.fields['POI ID'] })), searchMultiDayBuilderPois: async () => ['legacy'] }, '../../../../../../scripts/poi-portals/lib/poi-matrix-planning.mjs': planning });
    const req = q => ({ nextUrl: new URL(`https://test.invalid/?selection=${encodeURIComponent(JSON.stringify(q))}`) });
    denied = true;
    assert.equal((await GET(req(planning.emptyPlanningQuery()))).status, 401);
    assert.equal(reads, 0);
    denied = false;
    assert.equal((await GET(req({}))).status, 400);
    assert.equal(reads, 0);
    const result = await GET(req(planning.emptyPlanningQuery()));
    assert.equal(result.status, 200);
    assert(result.body.items.every(r => r.poi.poiId === r.poiId));
    assert.equal(reads, 1);
    broken = true;
    const failure = await GET(req(planning.emptyPlanningQuery()));
    assert.equal(failure.status, 503);
    assert(!JSON.stringify(failure).includes('secret error'));
    assert.equal((await GET({ nextUrl: new URL('https://test.invalid/?query=abc') })).body[0], 'legacy');
});
await check('UI both consumers use existing add handlers', () => {
    const builder = fs.readFileSync(new URL('../src/components/admin/MultiDayBuilderWorkspace.tsx', import.meta.url), 'utf8'), stops = fs.readFileSync(new URL('../src/components/admin/RouteStopsEditor.tsx', import.meta.url), 'utf8');
    assert.match(builder, /<PoiPlanningPicker onSelect=\{handlePoiSelect\}/);
    assert.match(stops, /<PoiPlanningPicker onSelect=\{handleAddStop\} disabled=\{saving\}/);
    const picker = fs.readFileSync(new URL('../src/components/admin/PoiPlanningPicker.tsx', import.meta.url), 'utf8');
    assert(!picker.includes('poi-matrix-planning.mjs'));
    assert(!picker.includes("method: 'POST'"));
    assert(picker.includes('controller.abort()'));
});
console.log(`poi-matrix-planning: ${checks} checks passed`);
await check('PLANNING closed places never offered by static themes',()=>{
 const f=structuredClone(fixtures.fixtures.find(f=>f.poiId==='POI-000927'))
 for(const status of ['temporaryClosed','permanentlyClosed','conflicting']){
  f.context.dossier.visit.status=status;
  const q=planning.emptyPlanningQuery(),r=run(q,[record(f)]);
  assert.equal(r.totals.matched,0);
  assert.equal(status==='conflicting'?r.totals.needsCheck:r.totals.excluded,1);
 }
})
console.log(`poi-matrix-planning final: ${checks} checks passed`)
