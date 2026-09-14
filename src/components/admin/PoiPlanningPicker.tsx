'use client';
import { useId, useState, useEffect } from 'react';
import type { MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data';
import type { PlanningQuery, PlanningProfile } from '@/lib/poi-matrix-view';
import { matrixRegistry, matrixLabel } from '@/lib/poi-matrix-registry';
import { POI_REGIONS } from '@/lib/poi-geography';
import { emptyPlanningQuery } from '@/lib/poi-matrix-view';
import { adminSecondaryButtonClass } from './ui';
type Result = {
    queryKey:string;
    items: {
        recordId: string;
        poiId: string;
        poi: MultiDayBuilderPoiOption;
        score: number;
        matrixState: string;
        childConditionsUnknown: boolean;
        visitNeedsCheck: boolean;
        evidence: {
            code: string;
            label: string;
            factIds: string[];
            conditionFactIds: string[];
            facts: {
                text: string;
                conditions: string;
                sources: string[];
            }[];
        }[];
        unchecked: {
            code: string;
            label: string;
            state: string;
        }[];
    }[];
    totals: {
        matched: number;
        needsCheck: number;
        excluded: number;
    };
    page: number;
    pages: number;
};
type Preset = {
    name: string;
    query: PlanningQuery;
};
const control = 'min-h-11 w-full rounded-lg border border-[var(--adm-border)] bg-[var(--adm-panel)] px-3 text-sm text-[var(--adm-text)]';
const button = `${adminSecondaryButtonClass} min-h-11 px-3`;
const STORAGE = 'jj-poi-planning-presets-v1';
export function PoiPlanningPicker({ onSelect, profile, disabled = false }: {
    onSelect: (poi: MultiDayBuilderPoiOption) => void;
    profile?: PlanningProfile | null;
    disabled?: boolean;
}) {
    const id = useId(), [open, setOpen] = useState(false), [draft, setDraft] = useState<PlanningQuery>(() => emptyPlanningQuery() as PlanningQuery), [applied, setApplied] = useState<PlanningQuery | null>(null);
    const [result, setResult] = useState<Result | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [ageText, setAgeText] = useState(''), [note, setNote] = useState(''), [retry, setRetry] = useState(0);
    const [presets, setPresets] = useState<Preset[]>([]), [presetName, setPresetName] = useState('');
    const encoded = applied ? JSON.stringify(applied) : '';
    useEffect(() => { try {
        const data = JSON.parse(localStorage.getItem(STORAGE) || '[]');
        if (Array.isArray(data))
            queueMicrotask(() => setPresets(data.filter(p => { try {
                return typeof p.name === 'string' && p.name.length <= 60 && Boolean(p.query?.spec === 'poi-planning-query/v1' && typeof p.query.search === 'string' && p.query.search.length <= 200 && p.query.geography && ['region', 'prefecture', 'city'].every(k => typeof p.query.geography[k] === 'string') && Array.isArray(p.query.required?.groups) && p.query.required.groups.every((g: {
                    group: string;
                    codes: string[];
                    mode: string;
                }) => matrixRegistry.groups.some(v => v.code === g.group) && ['any', 'all'].includes(g.mode) && Array.isArray(g.codes) && g.codes.every(c => matrixRegistry.properties.some(v => v.code === c && v.group === g.group))) && Array.isArray(p.query.required?.childAges) && p.query.required.childAges.every((v: number) => Number.isInteger(v) && v >= 0 && v <= 17) && Array.isArray(p.query.preferred) && p.query.preferred.every((c: string) => matrixRegistry.properties.some(v => v.code === c)));
            }
            catch {
                return false;
            } }).slice(0, 10)));
    }
    catch { /* Storage unavailable: search still works. */ } }, []);
    useEffect(() => {
        if (!encoded)
            return;
        const controller = new AbortController();
        queueMicrotask(() => { if (!controller.signal.aborted) {
            setLoading(true);
            setError('');
            setResult(null);
        } });
        void fetch(`/api/admin/multi-day/pois?selection=${encodeURIComponent(encoded)}`, { signal: controller.signal, cache: 'no-store' })
            .then(async (r) => { const data = await r.json(); if (!r.ok || !Array.isArray(data.items))
            throw Error(); if (!controller.signal.aborted)
            setResult({...data,queryKey:encoded}); })
            .catch(() => { if (!controller.signal.aborted)
            setError('Подбор не загрузился. Повторите попытку.'); })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [encoded, retry]);
    function currentQuery() {
        const parts = ageText.trim() ? ageText.trim().split(/[,;\s]+/) : [];
        if (parts.some(p => !/^\d{1,2}$/.test(p) || Number(p) > 17))
            throw Error('Укажите возраст каждого ребёнка от 0 до 17 лет.');
        const q = { ...draft, page: 1, required: { ...draft.required, childAges: parts.map(Number) } };
        if (q.required.groups.some(g => g.codes.includes('children')) && !parts.length)
            throw Error('Для условия «С детьми» укажите возраст каждого ребёнка.');
        return q;
    }
    function apply() { try {
        setApplied(currentQuery());
        setNote('');
        setError('');
        setRetry(n => n + 1);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    function choose(group: string, code: string, value: string) {
        setDraft(q => {
            const previous = q.required.groups.find(g => g.group === group), remaining = previous?.codes.filter(c => c !== code) ?? [];
            if (value === 'required')
                remaining.push(code);
            return { ...q, preferred: [...q.preferred.filter(c => c !== code), ...(value === 'preferred' ? [code] : [])], required: { ...q.required, groups: [...q.required.groups.filter(g => g.group !== group), ...(remaining.length ? [{ group, codes: remaining, mode: previous?.mode ?? 'any' as const }] : [])] } };
        });
    }
    function load(q: PlanningQuery) { setDraft(q); setAgeText(q.required.childAges.join(', ')); setNote('Условия загружены. Проверьте их и нажмите «Подобрать места».'); }
    function save() { try {
        const q = currentQuery();
        if (!presetName.trim())
            throw Error('Назовите набор условий.');
        const next = [...presets.filter(p => p.name !== presetName.trim()), { name: presetName.trim(), query: q }].slice(-10);
        localStorage.setItem(STORAGE, JSON.stringify(next));
        setPresets(next);
        setNote('Набор сохранён в этом браузере.');
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось сохранить набор.');
    } }
    return <section className="mt-3 border-t border-[var(--adm-border)] pt-3" aria-label="Подбор POI для программы">
  <button type="button" className={button} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>Подобрать по свойствам и региону</button>
  {open && <div id={id} className="mt-3 space-y-4">
   <p className="max-w-prose text-sm text-[var(--adm-text-2)]">Обязательные условия ограничивают выборку. Предпочтения поднимают подходящие места выше. Подбор добавляет только выбранную вами точку; порядок и параметры программы сохраняются.</p>
   {profile && <div className="space-y-2"><button type="button" className={button} onClick={() => load(profile.query)}>Использовать пожелания клиента</button><ul className="list-disc pl-5 text-sm text-[var(--adm-text-2)]">{[...profile.explanations, ...profile.notices].map(s => <li key={s}>{s}</li>)}</ul></div>}
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm">Название или POI ID<input className={control} value={draft.search} onChange={e => setDraft(q => ({ ...q, search: e.target.value }))} maxLength={200}/></label>
    <label className="text-sm">Регион<select className={control} value={draft.geography.region} onChange={e => setDraft(q => ({ ...q, geography: { region: e.target.value, prefecture: 'all', city: 'all' } }))}><option value="all">Все регионы</option>{POI_REGIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
    <label className="text-sm">Возраст детей<input className={control} value={ageText} onChange={e => setAgeText(e.target.value)} placeholder="Например: 6, 12"/><span className="text-xs text-[var(--adm-text-2)]">Без автоматической отметки доступности коляски.</span></label>
   </div>
   <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">{matrixRegistry.groups.map(group => <details key={group.code} className="border-t border-[var(--adm-border)]"><summary className="min-h-11 cursor-pointer py-3 font-medium">{group.labels.ru}</summary>
    {matrixRegistry.properties.filter(p => p.group === group.code).map(p => <label key={p.code} className="mb-2 grid grid-cols-2 items-center gap-2 text-sm"><span>{p.labels.ru}</span><select aria-label={`${p.labels.ru}: важность`} className={control} value={draft.required.groups.some(g => g.codes.includes(p.code)) ? 'required' : draft.preferred.includes(p.code) ? 'preferred' : 'none'} onChange={e => choose(group.code, p.code, e.target.value)}><option value="none">Не учитывать</option><option value="required">Обязательно</option>{!p.requiresAgeRange && <option value="preferred">Предпочтительно</option>}</select></label>)}
    {(draft.required.groups.find(g => g.group === group.code)?.codes.length ?? 0) > 1 && <label className="block text-sm">Обязательные свойства группы<select className={control} value={draft.required.groups.find(g => g.group === group.code)?.mode} onChange={e => setDraft(q => ({ ...q, required: { ...q.required, groups: q.required.groups.map(g => g.group === group.code ? { ...g, mode: e.target.value as 'all' | 'any' } : g) } }))}><option value="all">Все выбранные</option><option value="any">Хотя бы одно</option></select></label>}
   </details>)}</div>
   <div className="flex flex-wrap gap-2" aria-label="Выбранные свойства">{[...draft.required.groups.flatMap(g=>g.codes),...draft.preferred].map(code=><button key={code} type="button" className={button} aria-label={`Убрать ${matrixLabel(code)}`} onClick={()=>choose(matrixRegistry.properties.find(p=>p.code===code)!.group,code,'none')}>{matrixLabel(code)} · {draft.preferred.includes(code)?'желательно':'обязательно'} ×</button>)}</div>
   <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={apply}>Подобрать места</button><button type="button" className={button} onClick={() => { load(emptyPlanningQuery() as PlanningQuery); setApplied(null); setResult(null); setLoading(false); setError(''); }}>Сбросить условия</button></div>
   <details className="border-t border-[var(--adm-border)]"><summary className="min-h-11 cursor-pointer py-3">Мои наборы условий</summary><p className="text-xs text-[var(--adm-text-2)]">До 10 наборов в этом браузере; профиль и контакты клиента не сохраняются.</p><div className="my-2 flex flex-wrap gap-2"><input aria-label="Название набора условий" className={`${control} max-w-xs`} maxLength={60} value={presetName} onChange={e => setPresetName(e.target.value)}/><button type="button" className={button} onClick={save}>Сохранить набор</button></div>{presets.map(p => <div key={p.name} className="flex items-center gap-2"><button type="button" className={button} onClick={() => load(p.query)}>{p.name}</button><button type="button" className={button} aria-label={`Удалить набор ${p.name}`} onClick={() => { try {
            const next = presets.filter(v => v.name !== p.name);
            localStorage.setItem(STORAGE, JSON.stringify(next));
            setPresets(next);
        }
        catch {
            setError('Не удалось удалить набор.');
        } }}>Удалить</button></div>)}</details>
   {note && <p role="status" className="text-sm text-[var(--adm-text-2)]">{note}</p>}
   {applied && <p className="text-sm text-[var(--adm-text-2)]">Применено: {applied.required.groups.map(g => g.codes.map(code => matrixLabel(code)).join(g.mode==='any'?' или ':' и ')).join('; ') || 'без обязательных свойств'}. Предпочтения: {applied.preferred.map(code => matrixLabel(code)).join(', ') || 'не заданы'}.</p>}
   {loading && <p role="status">Проверяем всю базу…</p>}
   {error && <p role="alert">{error} <button type="button" className={button} onClick={apply}>Повторить</button></p>}
   {result && applied && result.queryKey===encoded && !loading && !error && <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{(['matched', 'needsCheck'] as const).map(bucket => <button type="button" className={button} key={bucket} aria-pressed={applied.bucket === bucket} onClick={() => setApplied({ ...applied, bucket, page: 1 })}>{bucket === 'matched' ? 'Подходят' : 'Нужно проверить'} · {result.totals[bucket]}</button>)}<span className="self-center text-sm text-[var(--adm-text-2)]">Исключено по условиям: {result.totals.excluded}</span></div>
    {result.items.length === 0 && <p>Совпадений нет. Измените обязательное условие выше или откройте «Нужно проверить»; условия сами не ослабляются.</p>}
    <ul className="divide-y divide-[var(--adm-border)]">{result.items.map(item => <li key={item.recordId} className="space-y-2 py-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{item.poi.nameRu || item.poiId}</strong><p className="text-xs text-[var(--adm-text-2)]">{item.poi.siteCity} · {item.poiId}</p></div>{applied.bucket === 'matched' && <button type="button" className={button} disabled={disabled} onClick={() => { onSelect(item.poi); setNote(`Выбрано: ${item.poi.nameRu || item.poiId}`); }}>Добавить в программу</button>}</div>
     {item.evidence.length > 0 && <p className="text-sm">Совпадает: {item.evidence.map(e => e.label).join(', ')}.</p>}
     {item.matrixState !== 'valid' && <p className="text-sm text-[var(--adm-text-2)]">{item.matrixState === 'missing' ? 'Матрица ещё не заполнена.' : 'Матрица требует исправления.'}</p>}
     {item.unchecked.length > 0 && <p className="text-sm">Проверить: {item.unchecked.map(p => p.label).join(', ')}.</p>}
     <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/admin/seo-llm?poi=${encodeURIComponent(item.poiId)}`} target="_blank" rel="noreferrer">Открыть факты и условия</a>
     {item.visitNeedsCheck&&<p className="text-sm">Сведения о возможности посещения противоречат друг другу. Проверьте актуальный статус.</p>}
     {item.childConditionsUnknown && <p className="text-sm">Пригодность по возрасту не подтверждена.</p>}
     {item.evidence.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Основания совпадения</summary><ul className="text-xs text-[var(--adm-text-2)]">{item.evidence.map(e => <li key={e.code}><strong>{e.label}</strong>{e.facts.map((f, i) => <div key={i} className="my-2 text-sm"><p>{f.text} {f.conditions}</p>{f.sources.map(url => <a className="mr-3 inline-flex min-h-11 items-center underline" key={url} href={url} target="_blank" rel="noreferrer">Источник</a>)}</div>)}</li>)}</ul></details>}
     {item.poi.visitPoints?.length > 0 && <p className="text-sm text-[var(--adm-text-2)]">Точки посещения: {item.poi.visitPoints.map(p => p.nameRu || p.poiId).join(', ')}. Для добавления найдите выбранную точку отдельно: условия родителя ей не приписываются.</p>}
    </li>)}</ul>
    <div className="flex items-center gap-3"><button type="button" className={button} disabled={applied.page <= 1} onClick={() => setApplied({ ...applied, page: applied.page - 1 })}>Назад</button><span>{applied.page} / {Math.max(1, result.pages)}</span><button type="button" className={button} disabled={applied.page >= result.pages} onClick={() => setApplied({ ...applied, page: applied.page + 1 })}>Далее</button></div>
   </div>}
  </div>}
 </section>;
}
