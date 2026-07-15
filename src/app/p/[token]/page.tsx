import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { buildPrintProgram } from '@/lib/print-program'
import { resolveSharedProgram } from '@/lib/program-share'
import { PrintProgramDocument } from '@/components/print/PrintProgramDocument'

/**
 * Публичная «живая» программа гостя: jumboinjapan.com/p/<token>.
 *
 * Открывается без логина, но по неугадываемому токену; персональных данных нет
 * (кодовое имя вместо клиента). Живая — всегда актуальная версия из Airtable.
 * Срок жизни и физическая очистка токена — в program-share.ts.
 */

// Всегда свежая: правки маршрута видны гостю сразу, срок ссылки проверяется на лету.
export const dynamic = 'force-dynamic'

// Личная программа — вне поиска и вне AI-ответов (noindex + Disallow /p/ в robots).
export const metadata: Metadata = {
  title: 'Программа тура',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true, 'max-image-preview': 'none' },
  },
}

export default async function SharedProgramPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const shared = await resolveSharedProgram(decodeURIComponent(token))
  // Нет токена / срок вышел / отменён — 404 (ссылка «физически» мертва в срок).
  if (!shared) notFound()

  const program = await buildPrintProgram(shared.slug)
  if (!program) notFound()

  const pdfHref = `/api/p/${encodeURIComponent(token)}/pdf`

  return (
    <div className="print-page">
      <div className="print-toolbar print:hidden">
        <a href={pdfHref} className="print-toolbar-button">
          Скачать PDF
        </a>
        <p className="print-toolbar-hint">
          Живая программа: изменения появляются здесь автоматически. PDF — для сохранения и печати.
        </p>
      </div>

      <PrintProgramDocument program={program} clientLabel={shared.codename} publicView />

      {/* Сдержанная воронка к публичным (индексируемым) страницам направлений. */}
      <nav className="print-doc print:hidden" aria-label="Больше о направлениях">
        <p className="print-label">Больше о направлениях</p>
        <p className="print-body">
          <Link href="/multi-day">Многодневные маршруты</Link> ·{' '}
          <Link href="/intercity">Выездные экскурсии</Link> ·{' '}
          <Link href="/city-tour">Прогулки по Токио</Link>
        </p>
      </nav>
    </div>
  )
}
