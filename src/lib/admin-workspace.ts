import type { WorkspaceItem } from '@/components/admin/AdminOperationsConsole'
import { getAllPois } from '@/lib/airtable'
import { getSeoWorkspaceDrafts } from '@/lib/admin-seo-llm-storage'

export async function getAdminWorkspaceItems(): Promise<WorkspaceItem[]> {
  const [pois, drafts] = await Promise.all([getAllPois(), getSeoWorkspaceDrafts()])

  return pois
    .map((poi) => ({
      ...poi,
      siteCity: poi.siteCity ?? '',
      draft: drafts[poi.id] ?? null,
    }))
    .sort((left, right) => {
      const leftName = left.nameRu || left.nameEn || left.poiId
      const rightName = right.nameRu || right.nameEn || right.poiId
      return leftName.localeCompare(rightName, 'ru')
    })
}
