import type { WorkspaceItem, WorkspaceItemDetail } from '@/components/admin/AdminOperationsConsole'
import { getAllPoisForAdminList, getPoiByRecordId } from '@/lib/airtable'
import { mapWorkspaceFieldsToDraft } from '@/lib/admin-seo-llm-storage'
import { tours } from '@/data/tours'

/**
 * Список для экрана POI — намеренно без текстов.
 *
 * Раньше страница отдавала браузеру все 418 записей целиком: описание RU,
 * описание EN, оба черновика и оба принятых текста. Это 1,4 МБ данных в
 * разметке плюс 1,7 МБ самой разметки. Пока браузер это разбирал, экран
 * стоял нарисованный, но мёртвый: клики по списку не работали, набранное
 * в поле названия стиралось в тот момент, когда React наконец оживал.
 * Именно это выглядело как «жму сохранить, и ничего не происходит».
 *
 * Списку нужны только имя, код, город, категория и состояние. Тексты
 * подгружаются по одной записи — той, что открыли.
 */
export async function getAdminWorkspaceItems(): Promise<WorkspaceItem[]> {
  const pois = await getAllPoisForAdminList()

  return pois
    .map((poi): WorkspaceItem => {
      const draft = mapWorkspaceFieldsToDraft(poi)

      return {
        id: poi.id,
        poiId: poi.poiId,
        nameRu: poi.nameRu,
        nameEn: poi.nameEn,
        category: poi.category,
        siteCity: poi.siteCity ?? '',
        status: draft?.status ?? 'draft',
        hasSource: Boolean(poi.descriptionRu.trim() || poi.descriptionEn.trim()),
        detail: null,
      }
    })
    .sort((left, right) => {
      const leftName = left.nameRu || left.nameEn || left.poiId
      const rightName = right.nameRu || right.nameEn || right.poiId
      return leftName.localeCompare(rightName, 'ru')
    })
}

/** Тексты и черновик одной записи — для карточки, открытой в панели. */
export async function getAdminWorkspaceItemDetail(recordId: string): Promise<WorkspaceItemDetail | null> {
  const poi = await getPoiByRecordId(recordId)
  if (!poi) return null

  return {
    descriptionRu: poi.descriptionRu,
    descriptionEn: poi.descriptionEn,
    workingHours: poi.workingHours,
    website: poi.website,
    draft: mapWorkspaceFieldsToDraft(poi),
  }
}

export function getAdminRouteCount() {
  return tours.filter((tour) => tour.category === 'intercity').length
}
