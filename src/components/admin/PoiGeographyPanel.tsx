'use client'

import type { PoiRelationsView, PoiRef } from '@/lib/poi-relations'
import type { PoiScopeArea } from '@/lib/poi-geography'
import type { EvidenceStatus } from '@/lib/poi-geography-document'

/** Территория охвата для карточки: подпись и состояние проверки, без источников. */
export interface WorkspaceTerritory {
  prefectureLabel: string
  municipalityJa: string | null
  status: EvidenceStatus
}

const STATUS_LABEL: Record<EvidenceStatus, string> = { verified: 'подтверждено', reported: 'по источнику, не подтверждено' }

function PoiLink({ item, onOpen }: { item: PoiRef; onOpen: (recordId: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(item.recordId)}
      className="inline-flex min-h-11 items-center gap-1 text-left text-sm text-[var(--adm-text)] underline underline-offset-4 hover:text-[var(--adm-text-2)]">
      {item.nameRu || item.poiId}<span className="text-xs text-[var(--adm-text-2)]"> {item.poiId}</span>
    </button>
  )
}

/**
 * Четыре раздела карточки, каждый — отдельно, чтобы принадлежность,
 * тематическая связь и точки посещения не сливались в одну «связано с».
 * Соседство по префектуре здесь не показывается: фильтр находит его сам,
 * а связью оно не является.
 */
export function PoiGeographyPanel({
  pointPrefecture, scope, territories, scopeError, relations, onOpen,
}: {
  pointPrefecture: string
  scope: PoiScopeArea[]
  territories: WorkspaceTerritory[]
  scopeError: string | null
  relations: PoiRelationsView
  onOpen: (recordId: string) => void
}) {
  const viewsOf = relations.inbound.filter((entry) => entry.kind === 'viewOf')
  const unconfirmedVisits = relations.inbound.filter((entry) => entry.kind === 'visitPointOf' && entry.status === 'reported')
  const dedicated = relations.inbound.filter((entry) => entry.kind === 'dedicatedTo')
  return (
    <section className="grid gap-3 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4 text-sm md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-[var(--adm-text)]">Географический охват</h3>
        <p className="mt-1 text-[var(--adm-text-2)]">Точка: {pointPrefecture || 'префектура требует проверки'}</p>
        {scopeError ? <p className="mt-1 text-[var(--adm-danger-text)]">Документ охвата повреждён: {scopeError}</p> : null}
        {territories.length ? (
          <ul className="mt-1 space-y-0.5">
            {territories.map((t) => (
              <li key={`${t.prefectureLabel}|${t.municipalityJa ?? ''}`} className="text-[var(--adm-text)]">
                {t.prefectureLabel}{t.municipalityJa ? ` · ${t.municipalityJa}` : ''}
                <span className="text-xs text-[var(--adm-text-2)]"> — {STATUS_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
        ) : !scopeError ? <p className="mt-1 text-xs text-[var(--adm-text-2)]">Охват не описан: запись находится по префектуре точки.</p> : null}
        {scope.length ? <p className="mt-1 text-xs text-[var(--adm-text-2)]">В фильтрах: {scope.map((s) => s.prefectureLabel).join(', ')}</p> : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--adm-text)]">Родитель и состав</h3>
        {relations.parentState === 'ok' && relations.parent ? <p className="mt-1">Входит в состав: <PoiLink item={relations.parent} onOpen={onOpen} /></p> : null}
        {relations.parentState === 'dangling' ? <p className="mt-1 text-[var(--adm-danger-text)]">Parent POI указывает на отсутствующую запись.</p> : null}
        {relations.parentState === 'multiple' ? <p className="mt-1 text-[var(--adm-danger-text)]">У записи несколько родителей — состав нужно разобрать.</p> : null}
        {relations.parentState === 'none' ? <p className="mt-1 text-xs text-[var(--adm-text-2)]">Родителя нет.</p> : null}
        {relations.children.length ? (
          <>
            <p className="mt-2 text-xs text-[var(--adm-text-2)]">В составе · {relations.children.length}</p>
            <ul className="space-y-0.5">{relations.children.map((c) => <li key={c.recordId}><PoiLink item={c} onOpen={onOpen} /></li>)}</ul>
          </>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--adm-text)]">Связанные места</h3>
        {relations.outbound.length === 0 && viewsOf.length === 0 && dedicated.length === 0
          ? <p className="mt-1 text-xs text-[var(--adm-text-2)]">Связей не записано. Соседство по карте связью не считается.</p>
          : null}
        <ul className="mt-1 space-y-0.5">
          {relations.outbound.map((entry) => (
            <li key={`${entry.kind}|${entry.targetPoiId}`}>
              <span className="text-[var(--adm-text-2)]">{entry.label}: </span>
              {entry.state === 'ok' && entry.target ? <PoiLink item={entry.target} onOpen={onOpen} /> : (
                <span className="text-[var(--adm-danger-text)]">
                  {entry.targetPoiId} — {entry.state === 'dangling' ? 'цели нет в базе' : entry.state === 'drift' ? 'идентификаторы цели разошлись' : 'ссылка на себя'}
                </span>
              )}
              {entry.status === 'reported' ? <span className="text-xs text-[var(--adm-text-2)]"> · {STATUS_LABEL.reported}</span> : null}
            </li>
          ))}
          {viewsOf.map((entry) => <li key={`in-view|${entry.source.recordId}`}><span className="text-[var(--adm-text-2)]">{entry.label}: </span><PoiLink item={entry.source} onOpen={onOpen} />{entry.status === 'reported' ? <span className="text-xs text-[var(--adm-text-2)]"> · {STATUS_LABEL.reported}</span> : null}</li>)}
          {dedicated.map((entry) => <li key={`in-ded|${entry.source.recordId}`}><span className="text-[var(--adm-text-2)]">{entry.label}: </span><PoiLink item={entry.source} onOpen={onOpen} />{entry.status === 'reported' ? <span className="text-xs text-[var(--adm-text-2)]"> · {STATUS_LABEL.reported}</span> : null}</li>)}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--adm-text)]">Точки посещения</h3>
        {relations.visitPoints.length ? (
          <ul className="mt-1 space-y-0.5">{relations.visitPoints.map((p) => <li key={p.recordId}><PoiLink item={p} onOpen={onOpen} /></li>)}</ul>
        ) : <p className="mt-1 text-xs text-[var(--adm-text-2)]">Подтверждённых точек посещения пока нет.</p>}
        {unconfirmedVisits.length > 0 && <ul className="mt-2">{unconfirmedVisits.map((entry) => <li key={entry.source.recordId}><PoiLink item={entry.source} onOpen={onOpen} /><span className="text-xs text-[var(--adm-text-2)]"> · требует проверки, в подбор не включено</span></li>)}</ul>}
      </div>
    </section>
  )
}
