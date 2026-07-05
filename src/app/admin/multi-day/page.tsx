import type { Metadata } from 'next'

import { MultiDayBuilderWorkspace } from '@/components/admin/MultiDayBuilderWorkspace'
import { getProspectById } from '@/lib/prospects'

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

  let clientContext: { recordId: string; name: string } | null = null
  if (params?.client) {
    const prospect = await getProspectById(params.client)
    if (prospect) {
      clientContext = {
        recordId: prospect.recordId,
        name: prospect.name || prospect.prospectId || 'Без имени',
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
