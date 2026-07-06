import type { Metadata } from 'next'

import { MultiDayBuilderWorkspace, type BuilderClientContext } from '@/components/admin/MultiDayBuilderWorkspace'
import { buildFactFindUrl, getProspectById } from '@/lib/prospects'

// Билдер — единственный инструмент монтирования туров; client workshop
// (/admin/clients/[id]) открывает его с контекстом через query:
//   ?client=recX — сохранённый маршрут привяжется к карточке клиента,
//   ?route=slug — автозагрузка привязанного маршрута на редактирование.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Multi-Day Route Builder',
  robots: { index: false, follow: false },
}

export default async function MultiDayBuilderPage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string; route?: string }>
}) {
  const params = searchParams ? await searchParams : undefined

  let clientContext: BuilderClientContext | null = null
  if (params?.client) {
    const prospect = await getProspectById(params.client)
    if (prospect) {
      clientContext = {
        recordId: prospect.recordId,
        name: prospect.name || prospect.prospectId || 'Без имени',
        // Профиль туриста рендерится сквозной шторкой поверх билдера — состав
        // группы и пожелания под рукой при сборке дней (не нужно уходить в
        // отдельную вкладку с карточкой клиента).
        profile: prospect.factFindAnswers,
        factFindCompletedAt: prospect.factFindCompletedAt,
        factFindUrl: prospect.factFindToken ? buildFactFindUrl(prospect.factFindToken) : null,
      }
    }
  }

  return (
    <MultiDayBuilderWorkspace
      clientContext={clientContext}
      initialRouteSlug={params?.route?.trim() || null}
    />
  )
}
