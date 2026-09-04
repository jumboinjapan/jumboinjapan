/**
 * Хранилище POI в памяти — ЕДИНСТВЕННОЕ, которому writer верит без живой
 * схемы, и верит по тождеству, а не по объявлению.
 *
 * Зачем (10f-P R2, находка 1). Пока «снимок» отличался от живого хранилища
 * строкой `writeTarget: 'memory'`, любой объект с эффектным `create` мог
 * объявить себя снимком и пройти мимо проверки живой схемы. Объявление —
 * не свойство: свойство «не пишет в Airtable» есть только у кода, который в
 * Airtable писать не умеет, то есть у этого модуля.
 *
 * Поэтому writer различает хранилища так: объект создан ЭТОЙ фабрикой, и его
 * `listExisting` / `findBySourceKey` / `create` — те самые функции, которые
 * фабрика ему выдала. Обёртка со своим `create` (spread, prototype, Proxy)
 * тождества не проходит и считается эффектным хранилищем: для неё живая
 * схема обязательна. Наблюдать за снимком можно через `observe` — это
 * наблюдение, эффект оно не подменяет и подменить не может.
 *
 * Собрать эффектное хранилище с этим брендом изнутри процесса нельзя иначе,
 * как изменив этот файл, — и это уже правка кода writer'а, а не объявление.
 */

import type { PoiLike } from './poi-matching.ts'

export interface MemoryPoiStoreRow extends PoiLike {
  sourceKey?: string | null
}

export type MemoryStoreEvent =
  | { kind: 'read'; method: 'listExisting' | 'findBySourceKey' }
  | { kind: 'create'; fields: Record<string, unknown> }

export interface MemoryPoiStoreOptions {
  /** Наблюдатель: зовётся ДО действия; исключение из него действие отменяет. */
  observe?: (event: MemoryStoreEvent) => void
}

export interface MemoryPoiStore {
  listExisting(): Promise<PoiLike[]>
  findBySourceKey(sourceKey: string): Promise<PoiLike | null>
  create(fields: Record<string, unknown>): Promise<{ poiId: string; recordId: string }>
}

interface Identity {
  listExisting: MemoryPoiStore['listExisting']
  findBySourceKey: MemoryPoiStore['findBySourceKey']
  create: MemoryPoiStore['create']
}

/* Тождество: объект → его собственные функции. Снаружи не пополняется. */
const IDENTITY = new WeakMap<object, Identity>()

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function createMemoryPoiStore(rows: readonly MemoryPoiStoreRow[], options: MemoryPoiStoreOptions = {}): MemoryPoiStore {
  const observe = options.observe ?? (() => {})
  const pool: PoiLike[] = rows.map((row) => {
    const copy: PoiLike = { ...row }
    delete (copy as { sourceKey?: unknown }).sourceKey
    return copy
  })
  const bySourceKey = new Map<string, PoiLike>()
  rows.forEach((row, i) => { if (filled(row.sourceKey)) bySourceKey.set(row.sourceKey, pool[i]) })
  let next = pool.reduce((max, p) => {
    const m = /^POI-(\d{6})$/.exec(p.poiId ?? '')
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  const identity: Identity = {
    // Копия, а не сам пул: пакет ведёт свой список принятых записей, и общая
    // ссылка складывала бы каждую созданную запись дважды.
    async listExisting() { observe({ kind: 'read', method: 'listExisting' }); return [...pool] },
    async findBySourceKey(sourceKey) {
      observe({ kind: 'read', method: 'findBySourceKey' })
      // Пустой ключ не совпадает ни с чем: иначе запись без ключа источника
      // объявила бы «уже принято» первой же записи без ключа в снимке.
      if (!filled(sourceKey)) return null
      return bySourceKey.get(sourceKey) ?? null
    },
    async create(fields) {
      observe({ kind: 'create', fields })
      next += 1
      const poiId = `POI-${String(next).padStart(6, '0')}`
      const entry: PoiLike = {
        poiId,
        nameRu: String(fields['POI Name (RU)'] ?? ''),
        nameEn: (fields['POI Name (EN)'] as string | undefined) ?? undefined,
        siteCity: (fields['Site City'] as string | undefined) ?? undefined,
        placeId: (fields['Google Place ID'] as string | undefined) ?? undefined,
        lat: (fields.Latitude as number | undefined) ?? undefined,
        lon: (fields.Longitude as number | undefined) ?? undefined,
        recordId: `snapshot-${poiId}`,
      }
      pool.push(entry)
      // Ключ источника обязан попасть в индекс: иначе повтор того же ключа
      // внутри одного пакета создал бы вторую запись.
      const sourceKey = fields['Source Key']
      if (filled(sourceKey)) bySourceKey.set(sourceKey, entry)
      return { poiId, recordId: entry.recordId as string }
    },
  }
  const store: MemoryPoiStore = { ...identity }
  IDENTITY.set(store, identity)
  return store
}

/**
 * Хранилище в памяти — по тождеству: объект создан здесь И его методы — те,
 * что выданы фабрикой. Любая подмена метода делает объект эффектным.
 */
export function isMemoryPoiStore(store: unknown): boolean {
  if (typeof store !== 'object' || store === null) return false
  const identity = IDENTITY.get(store)
  if (!identity) return false
  const s = store as Record<string, unknown>
  return s.listExisting === identity.listExisting
    && s.findBySourceKey === identity.findBySourceKey
    && s.create === identity.create
}
