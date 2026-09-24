'use client'
import { matrixLabel } from '@/lib/poi-matrix-registry'
import { MATRIX_STATE_LABELS, type MatrixDetailView, type MatrixPropertyView } from '@/lib/poi-matrix-view'
import type { PoiFacts } from '@/lib/poi-facts'

export function PoiMatrixLabels({properties}:{properties:MatrixPropertyView[]}) {
  const supported=properties.filter(p=>p.state==='supported')
  return supported.length?<span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--adm-text-2)]">{supported.slice(0,4).map(p=><span key={p.code}>{matrixLabel(p.code)}</span>)}{supported.length>4&&<span>Ещё {supported.length-4}</span>}</span>:null
}

export function PoiMatrixPanel({matrix,dossier}:{matrix:MatrixDetailView|undefined;dossier:PoiFacts|null}) {
  return <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4" aria-label="Свойства и основания">
    <h3 className="font-medium text-[var(--adm-text)]">Свойства места</h3>
    {!matrix||matrix.state==='missing'?<p className="mt-2 text-sm text-[var(--adm-text-2)]">Матрица ещё не заполнена. Основной тип сохранён; остальные свойства пока не проверены.</p>:matrix.state==='invalid'?<p role="alert" className="mt-2 text-sm text-[var(--adm-danger-text)]">Матрица не прошла проверку по текущему досье. Свойства не участвуют в подборе; агенту нужно сверить их заново.</p>:<div className="mt-2 space-y-2">
      <p className="text-sm text-[var(--adm-text-2)]">Оценка агента по собранным фактам. Редакторское одобрение отдельно.</p>
      {!matrix.projection?.properties.length&&<p className="text-sm text-[var(--adm-text-2)]">Свойства пока не установлены.</p>}
      {matrix.projection?.properties.map(property=><details key={property.code} className="border-t border-[var(--adm-border)] py-1 text-sm text-[var(--adm-text)]">
        <summary className="min-h-11 cursor-pointer py-3">{matrixLabel(property.code)} · {MATRIX_STATE_LABELS[property.state]??'Не проверено'}{property.ageRange?` · ${property.ageRange.min}–${property.ageRange.max} лет`:''}</summary>
        <ul className="space-y-3 pb-3">{[...new Set([...property.factIds,...property.conditionFactIds])].map(id=>{
          const fact=dossier?.facts.find(f=>f.id===id)
          if(!fact||!dossier)return <li key={id}>Основание недоступно. Обновите карточку.</li>
          return <li key={id} className="max-w-prose leading-relaxed"><p>{fact.text}</p>{fact.conditions&&<p>Условия: {fact.conditions}</p>}
            <p className="text-[var(--adm-text-2)]">{fact.references.map((reference,index)=>{
              const source=dossier.sources[reference.source]
              return <span key={index}>{index>0?' · ':''}<a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Источник {index+1}</a> — {new Date(source.observedAt).toLocaleDateString('ru-RU')}</span>
            })}</p>
          </li>
        })}</ul>
      </details>)}
    </div>}
  </section>
}
