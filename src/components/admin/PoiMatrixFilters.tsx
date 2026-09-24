'use client'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { matrixRegistry, matrixLabel } from '@/lib/poi-matrix-registry'
import type { MatrixQuery, MatrixSearchResult } from '@/lib/poi-matrix-view'
import { adminSecondaryButtonClass } from './ui'

export type MatrixSearchState = {status:'idle'|'loading'|'ready'|'error';active:boolean;result:MatrixSearchResult|null}
const EMPTY:MatrixQuery={groups:[],childAges:[]}
const control='min-h-11 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-panel)] px-3 text-sm text-[var(--adm-text)]'

export function PoiMatrixFilters({onResult,refreshKey}:{onResult:Dispatch<SetStateAction<MatrixSearchState>>;refreshKey:string}) {
  const [open,setOpen]=useState(false)
  const [enabled,setEnabled]=useState(false)
  const [draft,setDraft]=useState<MatrixQuery>(EMPTY)
  const [ages,setAges]=useState('')
  const [ageError,setAgeError]=useState('')
  const [applied,setApplied]=useState<MatrixQuery>(EMPTY)
  const [retry,setRetry]=useState(0)
  const [state,setState]=useState<MatrixSearchState>({status:'idle',active:false,result:null})
  const encoded=JSON.stringify(applied)
  useEffect(()=>{
    if(!enabled)return
    const controller=new AbortController()
    const active=JSON.parse(encoded).groups.length>0
    const loading:MatrixSearchState={status:'loading',active,result:null}
    queueMicrotask(()=>{ if(!controller.signal.aborted){setState(loading);onResult(loading)} })
    void fetch(`/api/admin/poi-matrix?query=${encodeURIComponent(encoded)}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('matrixSearchFailed')
        const data=await response.json()
        if(!data.ok||!Array.isArray(data.matchedIds)||!Array.isArray(data.items))throw new Error('matrixSearchResponse')
        if(controller.signal.aborted)return
        const ready:MatrixSearchState={status:'ready',active,result:data}
        setState(ready);onResult(ready)
      }).catch(()=>{
        if(controller.signal.aborted)return
        const failed:MatrixSearchState={status:'error',active,result:null}
        setState(failed);onResult(failed)
      })
    return ()=>controller.abort()
  },[encoded,onResult,enabled,refreshKey,retry])
  function toggle(group:string,code:string) {
    setDraft(current=>{
      const previous=current.groups.find(g=>g.group===group)
      const codes=previous?.codes.includes(code)?previous.codes.filter(c=>c!==code):[...(previous?.codes??[]),code]
      return {...current,groups:[...current.groups.filter(g=>g.group!==group),...(codes.length?[{group,codes,mode:previous?.mode??'any' as const}]:[])]}
    })
  }
  function apply() {
    const requiresAges=draft.groups.some(g=>g.codes.some(code=>matrixRegistry.properties.find(p=>p.code===code)?.requiresAgeRange))
    const parts=ages.trim()?ages.trim().split(/[,;\s]+/):[]
    if(requiresAges&&(!parts.length||parts.some(a=>!/^\d{1,2}$/.test(a)||Number(a)>17))){
      setAgeError('Укажите возраст каждого ребёнка от 0 до 17 лет, например: 6, 12.');return
    }
    setAgeError('');setApplied({...draft,childAges:requiresAges?parts.map(Number):[]});setRetry(n=>n+1)
  }
  function reset() {setDraft(EMPTY);setApplied(EMPTY);setAges('');setAgeError('');setRetry(n=>n+1)}
  const appliedCodes=applied.groups.flatMap(g=>g.codes)
  return <section className="mt-4 border-t border-[var(--adm-border)] pt-3" aria-label="Свойства мест">
    <button type="button" aria-expanded={open} aria-controls="poi-matrix-filters" onClick={()=>{setEnabled(true);setOpen(current=>!current)}} className={`${adminSecondaryButtonClass} min-h-11 px-4`}>
      {open?'Свойства мест': 'Подобрать по свойствам'}{appliedCodes.length>0?` · ${appliedCodes.length}`:''}
    </button>
    <div hidden={!open} id="poi-matrix-filters" className="mt-3 space-y-4">
      <p className="max-w-prose text-sm text-[var(--adm-text-2)]">Выберите, что важно для посещения. Между группами нужны все условия; внутри группы — любое выбранное, если не указано иначе. Места без подтверждённых сведений не попадут в такую выборку.</p>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {matrixRegistry.groups.map(group=><details key={group.code} className="min-w-0 border-t border-[var(--adm-border)]">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-[var(--adm-text)]">{group.labels.ru}{draft.groups.find(g=>g.group===group.code)?.codes.length ? ` · ${draft.groups.find(g=>g.group===group.code)?.codes.length}` : ''}</summary>
          <fieldset><legend className="sr-only">{group.labels.ru}</legend>
          {matrixRegistry.properties.filter(p=>p.group===group.code).map(property=><label key={property.code} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--adm-text)]">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--adm-accent)]" checked={draft.groups.find(g=>g.group===group.code)?.codes.includes(property.code)??false} onChange={()=>toggle(group.code,property.code)} />
            {property.labels.ru}
          </label>)}
          {(draft.groups.find(g=>g.group===group.code)?.codes.length??0)>1&&<label className="mt-2 block text-xs text-[var(--adm-text-2)]">Совпадение в группе
            <select className={`${control} mt-1 w-full`} value={draft.groups.find(g=>g.group===group.code)?.mode??'any'} onChange={e=>setDraft(q=>({...q,groups:q.groups.map(g=>g.group===group.code?{...g,mode:e.target.value as 'any'|'all'}:g)}))}>
              <option value="any">Любое выбранное</option><option value="all">Все выбранные</option>
            </select>
          </label>}
        </fieldset></details>)}
      </div>
      {draft.groups.some(g=>g.codes.includes('children'))&&<label className="block max-w-sm text-sm text-[var(--adm-text)]">Возраст детей
        <input className={`${control} mt-1 w-full`} value={ages} onChange={e=>setAges(e.target.value)} placeholder="Например: 6, 12" aria-invalid={Boolean(ageError)} aria-describedby="matrix-age-help" />
        <span id="matrix-age-help" className="mt-1 block text-xs text-[var(--adm-text-2)]">{ageError||'Через запятую; проверяем условия для каждого ребёнка.'}</span>
      </label>}
      {JSON.stringify(draft.groups)!==JSON.stringify(applied.groups)&&<p className="text-sm text-[var(--adm-text-2)]">Галочки изменены. Нажмите «Показать места», чтобы обновить подбор.</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={apply} className={`${adminSecondaryButtonClass} min-h-11 px-4`}>Показать места</button>
        <button type="button" onClick={reset} className="min-h-11 text-sm text-[var(--adm-text-2)] underline underline-offset-4">Сбросить свойства</button>
      </div>
    </div>
      {appliedCodes.length>0&&<div className="flex flex-wrap gap-2" aria-label="Применённые свойства">{appliedCodes.map(code=><button type="button" key={code} className={`${control} text-left`} aria-label={`Снять условие: ${matrixLabel(code)}`} onClick={()=>{
        const next={...applied,groups:applied.groups.map(g=>({...g,codes:g.codes.filter(c=>c!==code)})).filter(g=>g.codes.length)}
        setApplied(next);setDraft(current=>({...current,groups:current.groups.map(g=>({...g,codes:g.codes.filter(c=>c!==code)})).filter(g=>g.codes.length)}))
      }}>{matrixLabel(code)}{code==='children'?` (${applied.childAges.join(', ')} лет)`:''} ×</button>)}</div>}
      {applied.groups.some(g=>g.codes.length>1)&&<p className="mt-2 text-xs text-[var(--adm-text-2)]">{applied.groups.filter(g=>g.codes.length>1).map(g=>`${matrixRegistry.groups.find(r=>r.code===g.group)?.labels.ru}: ${g.mode==='all'?'все выбранные':'любое выбранное'}`).join(' · ')}</p>}
      <div role="status" className="text-sm text-[var(--adm-text-2)]">
        {state.status==='loading'&&'Проверяем свойства мест…'}
        {state.status==='error'&&<><span>Свойства не загрузились. {state.active?'Результаты скрыты до повторной проверки.':'Общий каталог доступен.'}</span> <button type="button" onClick={()=>setRetry(n=>n+1)} className="min-h-11 underline underline-offset-4">Повторить</button></>}
        {state.status==='ready'&&state.result&&<>Матрица проверена у {state.result.coverage.valid} мест. Ещё не заполнена: {state.result.coverage.missing}. Требует исправления: {state.result.coverage.invalid}.
          {state.active&&state.result.matchedIds.length===0&&<p className="mt-2">Подтверждённых совпадений нет. Снимите одно из применённых условий выше или сбросьте свойства.</p>}
        </>}
      </div>
  </section>
}
