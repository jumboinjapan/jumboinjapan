/** M5 read-only selection. Shared matrix predicate; no writer or automatic route edits. */
import assert from 'node:assert/strict';
import { canonicalJsonBytes, assertExactKeys } from '../../lib/canonical-contract.mjs';
import { readMatrixRecord } from './poi-matrix-catalog.mjs';
import { matchesPoiMatrix } from './poi-matrix.mjs';
import { matrixProperty, matrixLabel } from '../../../src/lib/poi-matrix-registry.ts';
import { readPoiGeography, matchesPoiGeography, POI_REGIONS } from '../../../src/lib/poi-geography.ts';
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts';
export const PLANNING_SPEC = 'poi-planning-query/v1';
import { emptyPlanningQuery } from '../../../src/lib/poi-matrix-view.ts';
import { readPoiFacts } from '../../../src/lib/poi-facts.ts';
export { emptyPlanningQuery };
export function assertPlanningQuery(q) {
    canonicalJsonBytes(q, PLANNING_SPEC);
    assertExactKeys(q, ['spec', 'search', 'geography', 'required', 'preferred', 'page', 'bucket'], 'planning query');
    assert.equal(q.spec, PLANNING_SPEC, 'planningVersion');
    assert(typeof q.search === 'string' && q.search.length <= 200, 'planningSearch');
    assertExactKeys(q.geography, ['region', 'prefecture', 'city'], 'planning geography');
    assert(q.geography.region === 'all' || POI_REGIONS.some(r => r.code === q.geography.region), 'planningRegion');
    assert(q.geography.prefecture === 'all' || typeof q.geography.prefecture === 'string' && canonicalPrefecture(q.geography.prefecture)?.en === q.geography.prefecture, 'planningPrefecture');
    assert(typeof q.geography.city === 'string' && q.geography.city.length > 0 && q.geography.city.length <= 100, 'planningCity');
    matchesPoiMatrix(null, q.required);
    assert(Array.isArray(q.preferred) && new Set(q.preferred).size === q.preferred.length && q.preferred.every(c => matrixProperty(c) && !matrixProperty(c).requiresAgeRange), 'planningPreferences');
    assert(Number.isInteger(q.page) && q.page >= 1 && q.page <= 10000, 'planningPage');
    assert(['matched', 'needsCheck'].includes(q.bucket), 'planningBucket');
    return q;
}
const propertyQuery = (code, ages) => ({ groups: [{ group: matrixProperty(code).group, codes: [code], mode: 'all' }], childAges: ages });
function rejected(property, ages) {
    return property?.state === 'unavailable' || property?.state === 'refuted' && (property.code !== 'children' || ages.some(a => property.ageRange && a >= property.ageRange.min && a <= property.ageRange.max));
}
export function planPoiSelection(records, query, now = new Date().toISOString()) {
    const q = assertPlanningQuery(query), totals = { matched: 0, needsCheck: 0, excluded: 0 }, coverage = { valid: 0, missing: 0, invalid: 0 }, rows = [], seen = new Set(), poiIds = new Set();
    const search = q.search.trim().toLocaleLowerCase('ru');
    for (const record of records) {
        assert(typeof record.id === 'string' && !seen.has(record.id), 'planningDuplicate');
        seen.add(record.id);
        const f = record.fields;
        if (f['Is System'])
            continue;
        assert(typeof f['POI ID'] === 'string' && /^POI-\d{6}$/.test(f['POI ID']) && !poiIds.has(f['POI ID']), 'planningPoiIdentity');
        poiIds.add(f['POI ID']);
        if (search && ![f['POI ID'], f['POI Name (RU)'], f['POI Name (EN)']].some(v => typeof v === 'string' && v.toLocaleLowerCase('ru').includes(search)))
            continue;
        const geography = readPoiGeography(f, f['POI ID'] ?? null);
        if (!matchesPoiGeography({ geography, siteCity: f['Site City'] ?? '' }, q.geography))
            continue;
        const read = readMatrixRecord(f, now), projection = read.projection, properties = projection?.properties ?? [];
        coverage[read.state]++;
        const ages = q.required.childAges, child = properties.find(p => p.code === 'children');
        const forbiddenAge = ages.length > 0 && rejected(child, ages);
        const matches = matchesPoiMatrix(projection, q.required);
        const definiteFailure = q.required.groups.some(g => { const failures = g.codes.map(c => rejected(properties.find(p => p.code === c), ages)); return g.mode === 'all' ? failures.some(Boolean) : failures.every(Boolean); });
        const dossier = read.state === 'valid' ? readPoiFacts(f.Notes ?? '').dossier : null;
        const visitUnavailable = ['temporaryClosed','permanentlyClosed'].includes(dossier?.visit.status);
        const visitNeedsCheck = dossier?.visit.status === 'conflicting';
        const bucket = forbiddenAge || definiteFailure || visitUnavailable ? 'excluded' : read.state==='invalid'||visitNeedsCheck ? 'needsCheck' : matches ? 'matched' : 'needsCheck';
        totals[bucket]++;
        if (bucket === 'excluded')
            continue;
        const preferred = q.preferred.filter(c => matchesPoiMatrix(projection, propertyQuery(c, ages)));
        const required = q.required.groups.flatMap(g => g.codes).filter(c => matchesPoiMatrix(projection, propertyQuery(c, ages)));
        const unchecked = q.required.groups.filter(g => g.mode === 'all' || !matchesPoiMatrix(projection, {groups:[g],childAges:ages})).flatMap(g => g.codes).filter(c => !matchesPoiMatrix(projection, propertyQuery(c, ages)));

        const evidence = [...new Set([...required, ...preferred])].map(code => {
            const p = properties.find(v => v.code === code);
            return { code, label: matrixLabel(code), factIds: p.factIds, conditionFactIds: p.conditionFactIds, facts: [...new Set([...p.factIds, ...p.conditionFactIds])].map(id => { const fact = dossier?.facts.find(f => f.id === id); return { text: fact?.text ?? 'Факт требует проверки', conditions: fact?.conditions ?? '', sources: [...new Set((fact?.references ?? []).map(ref => dossier.sources[ref.source].url))] }; }) };
        });
        rows.push({ recordId: record.id, poiId: f['POI ID'], nameRu: f['POI Name (RU)'] ?? '', bucket, score: preferred.length, evidence, unchecked: unchecked.map(code => ({ code, label: matrixLabel(code), state: properties.find(p => p.code === code)?.state ?? 'unknown' })), matrixState: read.state, visitNeedsCheck, childConditionsUnknown: ages.length > 0 && (!child || child.state !== 'supported' || ages.some(a => !child.ageRange || a < child.ageRange.min || a > child.ageRange.max)), geography });
    }
    rows.sort((a, b) => b.score - a.score || a.nameRu.localeCompare(b.nameRu, 'ru') || a.recordId.localeCompare(b.recordId));
    const selected = rows.filter(r => r.bucket === q.bucket), pageSize = 20;
    return { spec: 'poi-planning-result/v1', items: selected.slice((q.page - 1) * pageSize, q.page * pageSize), totals, coverage, page: q.page, pageSize, pages: Math.ceil(selected.length / pageSize), checkedAt: now };
}
// One adapter from questionnaire v3 and explicit legacy fields. Free prose is not parsed into constraints.
/** @param {any} profile @param {any} legacy */
export function planningFromProfile(profile, legacy = null) {
    const query = emptyPlanningQuery(), explanations = [], notices = [];
    const map = { gastronomy: ['dining'], active: ['walking', 'nature'], photography: ['scenic_view'], art_hunting: ['art'], culture: ['history', 'architecture', 'religion'] };
    const interests = profile?.interests ?? legacy?.interests ?? [];
    if (Array.isArray(interests))
        for (const interest of interests) {
            if (Object.hasOwn(map, interest)) {
                query.preferred.push(...map[interest]);
                explanations.push(`Выше в подборе: ${map[interest].map(code => matrixLabel(code)).join(', ')}. Остальные места остаются в списке.`);
            }
            else if (interest !== 'none')
                notices.push('Есть пожелания, которые нужно уточнить вручную.');
        }
    if (profile?.art_hunting_type === 'modern')
        query.preferred.push('contemporary_art');
    let children = profile?.group?.children;
    if (!children && legacy?.children) {
        try {
            const parsed = JSON.parse(legacy.children);
            if (Array.isArray(parsed))
                children = parsed;
            else notices.push('Возраст детей требует проверки.');
        }
        catch {
            notices.push('Возраст детей указан свободным текстом: проверьте его перед подбором.');
        }
    }
    if (Array.isArray(children)) {
        const ages = children.map(c => typeof c === 'number' ? c : c?.age);
        if (ages.every(a => Number.isInteger(a) && a >= 0 && a <= 17))
            query.required.childAges = ages;
        else
            notices.push('Возраст детей требует проверки.');
    }
    const mobility = profile?.mobility ?? (legacy?.mobility === 'wheelchair' || legacy?.mobility === 'limited' ? ['limited_mobility'] : []);
    if (Array.isArray(mobility) && mobility.some(v => ['limited_mobility', 'elevator_needed'].includes(v))) {
        query.required.groups.push({ group: 'conditions', codes: ['step_free'], mode: 'all' });
        explanations.push('Ограниченная мобильность: отдельно проверяем подтверждённый доступ без ступеней.');
    }
    if (query.required.childAges.length)
        explanations.push('Возраст детей учитывается; неизвестная пригодность отмечается, подтверждённый возрастной запрет исключает место.');
    if (profile?.pace || legacy?.pace)
        notices.push('Темп поездки остаётся ориентиром для гида: свойства места не определяют длительность дня.');
    if (profile?.interests_depth)
        notices.push('Глубина интереса учитывается гидом при распределении времени, а не как запрет других тем.');
    if(profile?.interests_custom||profile?.active_detail?.custom||profile?.notes)notices.push('В анкете есть свободные пожелания. Проверьте их в профиле клиента; они не превращаются в автоматические ограничения.');
    if(profile?.active_detail?.ask_recommend)notices.push('Клиент просит предложить активные занятия: выберите варианты и обсудите их с ним.');
    query.preferred = [...new Set(query.preferred)];
    assertPlanningQuery(query);
    return { spec: 'poi-planning-profile/v1', query, explanations: [...new Set(explanations)], notices: [...new Set(notices)] };
}
