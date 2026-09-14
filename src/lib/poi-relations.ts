/**
 * Граф связей POI по всему списку: родитель и состав (из `Parent POI`),
 * исходящие связи документа `poi-geography/v1` и их обратная сторона.
 *
 * Обратная сторона ВЫВОДИТСЯ, а не хранится (контракт
 * `docs/poi-intake/poi-geography-contract.md`): «точки посещения горы» — это
 * все записи, у которых `visitPointOf` указывает на гору. Читатель один и тот
 * же для админки и конструктора, чтобы две выборки не разошлись.
 *
 * Состояние связи называется, а не подразумевается: цель может исчезнуть
 * (`dangling`), её `POI ID` и record id могут разойтись после пересоздания
 * (`drift`), ссылка может указывать на саму запись (`self`). Ни одно из этих
 * состояний не прячется под «связи нет».
 */
import { RELATION_KINDS, RELATION_LABELS, type PoiGeographyDocument, type RelationKind, type EvidenceStatus } from './poi-geography-document.ts'

export interface PoiRef {
  recordId: string
  poiId: string
  nameRu: string
}

export interface RelatedPoiNode {
  recordId: string
  poiId: string
  nameRu: string
  /** Record id из `Parent POI`; несколько — дефект данных, он называется. */
  parentRecordIds: readonly string[]
  document: PoiGeographyDocument | null
}

export type RelationState = 'ok' | 'dangling' | 'drift' | 'self'
export const RELATION_STATES = Object.freeze(['ok', 'dangling', 'drift', 'self'] as const)

export interface OutboundRelationView {
  kind: RelationKind
  label: string
  status: EvidenceStatus
  state: RelationState
  target: PoiRef | null
  /** Что записано в документе — для отчёта о повреждённой связи. */
  targetPoiId: string
}

export interface InboundRelationView {
  kind: RelationKind
  label: string
  status: EvidenceStatus
  source: PoiRef
}

export interface PoiRelationsView {
  parent: PoiRef | null
  parentState: 'none' | 'ok' | 'dangling' | 'multiple'
  children: PoiRef[]
  outbound: OutboundRelationView[]
  inbound: InboundRelationView[]
  /** Входящие `visitPointOf` — для конструктора и раздела «Точки посещения». */
  visitPoints: PoiRef[]
}

const ref = (node: RelatedPoiNode): PoiRef => ({ recordId: node.recordId, poiId: node.poiId, nameRu: node.nameRu })

/**
 * Строит представления для всех узлов за один проход. Ключ карты —
 * record id; `poiId` дублируется в карте по идентификатору для читателей,
 * у которых есть только он (конструктор).
 */
export function buildPoiRelations(nodes: readonly RelatedPoiNode[]): Map<string, PoiRelationsView> {
  const byRecord = new Map<string, RelatedPoiNode>()
  const byPoiId = new Map<string, RelatedPoiNode>()
  for (const node of nodes) {
    byRecord.set(node.recordId, node)
    if (node.poiId) byPoiId.set(node.poiId, node)
  }
  const views = new Map<string, PoiRelationsView>()
  const inboundOf = new Map<string, InboundRelationView[]>()
  const childrenOf = new Map<string, PoiRef[]>()

  for (const node of nodes) {
    for (const parentId of node.parentRecordIds) {
      if (!byRecord.has(parentId)) continue
      const list = childrenOf.get(parentId) ?? []
      list.push(ref(node))
      childrenOf.set(parentId, list)
    }
  }

  for (const node of nodes) {
    const outbound: OutboundRelationView[] = []
    for (const relation of node.document?.relations ?? []) {
      const label = RELATION_LABELS[relation.kind].outbound
      const target = byRecord.get(relation.target.recordId) ?? null
      let state: RelationState = 'ok'
      if (relation.target.recordId === node.recordId || relation.target.poiId === node.poiId) state = 'self'
      else if (!target) state = 'dangling'
      else if (target.poiId !== relation.target.poiId) state = 'drift'
      outbound.push({ kind: relation.kind, label, status: relation.status, state, target: state === 'ok' && target ? ref(target) : null, targetPoiId: relation.target.poiId })
      if (state === 'ok' && target) {
        const list = inboundOf.get(target.recordId) ?? []
        list.push({ kind: relation.kind, label: RELATION_LABELS[relation.kind].inbound, status: relation.status, source: ref(node) })
        inboundOf.set(target.recordId, list)
      }
    }
    views.set(node.recordId, { parent: null, parentState: 'none', children: [], outbound, inbound: [], visitPoints: [] })
  }

  for (const node of nodes) {
    const view = views.get(node.recordId)!
    if (node.parentRecordIds.length > 1) view.parentState = 'multiple'
    else if (node.parentRecordIds.length === 1) {
      const parent = byRecord.get(node.parentRecordIds[0]!)
      view.parent = parent ? ref(parent) : null
      view.parentState = parent ? 'ok' : 'dangling'
    }
    view.children = (childrenOf.get(node.recordId) ?? []).sort(byName)
    const inbound = (inboundOf.get(node.recordId) ?? []).sort((a, b) => RELATION_KINDS.indexOf(a.kind) - RELATION_KINDS.indexOf(b.kind) || byName(a.source, b.source))
    view.inbound = inbound
    view.visitPoints = inbound.filter((entry) => entry.kind === 'visitPointOf' && entry.status === 'verified').map((entry) => entry.source)
  }
  return views
}

const byName = (a: PoiRef, b: PoiRef) => (a.nameRu || a.poiId).localeCompare(b.nameRu || b.poiId, 'ru')

export const EMPTY_RELATIONS: PoiRelationsView = Object.freeze({
  parent: null, parentState: 'none', children: [], outbound: [], inbound: [], visitPoints: [],
}) as PoiRelationsView
