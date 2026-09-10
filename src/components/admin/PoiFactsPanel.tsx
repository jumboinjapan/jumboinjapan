'use client'
import { FACT_CATEGORIES, type PoiFacts } from '@/lib/poi-facts'
const visitLabels = {unknown:'Не проверено',open:'Открыто',temporaryClosed:'Временно закрыто',permanentlyClosed:'Закрыто',conflicting:'Статус требует проверки'}
const sectionLabels: Record<string,string> = {section_main_content:'Об этом месте',section_admission:'Часы и билеты',section_get_there:'Как добраться',section_links:'Официальные ссылки',article:'Текст страницы'}
const statuses = {reported:'Сообщает источник',verified:'Проверено',legend:'Предание',interpretation:'Интерпретация',conflicting:'Есть расхождение',unknown:'Не установлено'}
export function PoiFactsPanel({ dossier, error }: { dossier: PoiFacts | null; error: string | null }) {
  if (error) return <p role="alert" className="text-sm text-[var(--adm-danger-text)]">Досье повреждено. Его нужно восстановить из журнала импорта; описания доступны отдельно.</p>
  if (!dossier) return <p className="text-sm text-[var(--adm-text-2)]">Структурированное досье ещё не собрано. У старых записей факты могут оставаться в заметках; следующий сбор добавит их сюда.</p>
  const unresolved = dossier.coverage.filter(c => c.disposition === 'unresolved')
  return <div className="space-y-5 text-sm text-[var(--adm-text)]">
    <p className="text-[var(--adm-text-2)]">{dossier.facts.length} фактов · Сбор {new Date(dossier.updatedAt).toLocaleDateString('ru-RU')} · <a className="underline underline-offset-4" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(dossier,null,2))}`} download={`${dossier.sourceKey.replace(':','-')}-facts.json`}>Скачать факты JSON</a></p>
    <div className="space-y-2">
      <p className="font-semibold">Посещение: {visitLabels[dossier.visit.status]}</p>
      <p>{dossier.visit.explanation}</p>
      <p>Часы: {dossier.visit.hoursKind === 'unknown' ? 'неизвестны' : dossier.visit.hours}</p>
      {unresolved.length > 0 && <p className="text-[var(--adm-warn-text)]">Требуют проверки: {unresolved.length} блоков. {unresolved.map(c => c.reason).join('; ')}</p>}
    </div>
    {Object.entries(FACT_CATEGORIES).map(([category, label]) => {
      const facts = dossier.facts.filter(f => f.category === category)
      if (!facts.length) return null
      return <section key={category} aria-label={label} className="border-t border-[var(--adm-border)] pt-4">
        <h3 className="mb-3 font-semibold">{label}</h3>
        <ul className="space-y-4">
          {facts.map(f => <li key={f.id} className="max-w-prose">
            <p className="font-medium">{f.subject}</p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">{f.text}</p>
            {f.conditions && <p className="mt-1 text-[var(--adm-text-2)]">Условия: {f.conditions}</p>}
            <p className="mt-1 text-[var(--adm-text-2)]">{statuses[f.status]} · {f.references.map((r, i) => {
              const source = dossier.sources[r.source]
              const block = source.blocks.find(b => b.id === r.blockId)!
              const href = /^section_[A-Za-z0-9_]+$/.test(block.section) ? `${source.url}#${block.section}` : source.url
              return <span key={`${r.source}:${r.blockId}`}>{i > 0 ? ', ' : ''}<a href={href} title={`Фрагмент ${r.blockId}: ${block.locator}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">{sectionLabels[block.section] ?? block.section} · фрагмент {r.blockId}</a> ({new Date(source.observedAt).toLocaleDateString('ru-RU')})</span>
            })}</p>
          </li>)}
        </ul>
      </section>
    })}
  </div>
}
