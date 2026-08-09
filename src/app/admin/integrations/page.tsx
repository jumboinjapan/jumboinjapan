import type { Metadata } from 'next'

import { IntegrationsWorkspace } from '@/components/admin/IntegrationsWorkspace'

/**
 * Дэшборд внешних API. force-dynamic по той же причине, что и обзорная
 * страница: содержимое зависит от переменных окружения и Airtable, на этапе
 * сборки его пререндерить нельзя и не нужно.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Панель — API',
  description: 'Подключение и мониторинг внешних сервисов.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  },
}

export default function AdminIntegrationsPage() {
  return <IntegrationsWorkspace />
}
