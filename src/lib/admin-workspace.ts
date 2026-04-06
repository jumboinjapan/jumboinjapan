import type { WorkspaceItem } from '@/components/admin/AdminOperationsConsole'
import { getAllPois } from '@/lib/airtable'
import { mapWorkspaceFieldsToDraft } from '@/lib/admin-seo-llm-storage'
import { tours } from '@/data/tours'

export async function getAdminWorkspaceItems(): Promise<WorkspaceItem[]> {
  const pois = await getAllPois()

  return pois
    .map((poi) => ({
      ...poi,
      siteCity: poi.siteCity ?? '',
      draft: mapWorkspaceFieldsToDraft(poi),
    }))
    .sort((left, right) => {
      const leftName = left.nameRu || left.nameEn || left.poiId
      const rightName = right.nameRu || right.nameEn || right.poiId
      return leftName.localeCompare(rightName, 'ru')
    })
}

export function getAdminRouteCount() {
  return tours.filter((tour) => tour.category === 'intercity').length
}
