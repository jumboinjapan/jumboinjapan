import { NextRequest, NextResponse } from 'next/server'

import { buildPrintProgram } from '@/lib/print-program'
import { resolveSharedProgram } from '@/lib/program-share'
import { renderTourProgramPdf } from '@/lib/pdf/tour-program-pdf'

/**
 * Публичный PDF живой программы гостя: /api/p/<token>/pdf
 *
 * Тот же генератор, что во внутренней печати, но доступ — по токену (без
 * админ-логина) и с кодовым именем вместо клиента. Токен-гейт и срок жизни —
 * в resolveSharedProgram (истёкшая/отозванная ссылка → 404).
 *
 * Node-рантайм обязателен — pdfkit читает файлы шрифтов с диска.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const shared = await resolveSharedProgram(decodeURIComponent(token))
  if (!shared) {
    return NextResponse.json({ ok: false, error: 'Ссылка недействительна' }, { status: 404 })
  }

  const program = await buildPrintProgram(shared.slug)
  if (!program) {
    return NextResponse.json({ ok: false, error: 'Программа не найдена' }, { status: 404 })
  }

  try {
    // Кодовое имя вместо реального клиента — на публичном документе нет ПД.
    const pdf = await renderTourProgramPdf(program, shared.codename)
    const fileName = `${shared.slug.split('/').pop() || 'program'}.pdf`

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // attachment: кнопка «Скачать PDF» кладёт файл гостю, а не открывает вкладку.
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (error) {
    console.error('[public-pdf] render failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Не удалось собрать PDF' }, { status: 500 })
  }
}
