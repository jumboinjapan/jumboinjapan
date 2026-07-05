'use client'

import { Printer } from 'lucide-react'

/** Экранная панель печатной страницы; на печати скрыта (print:hidden). */
export function PrintToolbar() {
  return (
    <div className="print-toolbar print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="print-toolbar-button"
      >
        <Printer className="size-4" aria-hidden />
        Печать / сохранить в PDF
      </button>
      <p className="print-toolbar-hint">В диалоге печати выберите «Сохранить как PDF», поля — по умолчанию.</p>
    </div>
  )
}
