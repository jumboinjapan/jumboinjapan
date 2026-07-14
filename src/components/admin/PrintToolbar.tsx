'use client'

import { Download, Printer } from 'lucide-react'

/**
 * Экранная панель печатной страницы; на печати скрыта (print:hidden).
 *
 * Две кнопки — намеренно разные вещи:
 * — «Скачать PDF»: серверный документ (pdfkit, вшитые шрифты, обложка,
 *   колонтитулы) — то, что отдаём гостю.
 * — «Печать страницы»: быстрая браузерная печать этой же программы, когда PDF
 *   не нужен (сверить состав дня, распечатать себе в дорогу).
 */
export function PrintToolbar({ slug }: { slug: string }) {
  const pdfHref = `/api/admin/print/pdf/${slug}`

  return (
    <div className="print-toolbar print:hidden">
      <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="print-toolbar-button">
        <Download className="size-4" aria-hidden />
        Скачать PDF
      </a>
      <button type="button" onClick={() => window.print()} className="print-toolbar-button print-toolbar-button-ghost">
        <Printer className="size-4" aria-hidden />
        Печать страницы
      </button>
      <p className="print-toolbar-hint">PDF — документ для гостя: обложка, колонтитулы, фирменные шрифты.</p>
    </div>
  )
}
