import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import { buildPrintProgram } from '@/lib/print-program'
import { renderTourProgramPdf } from '@/lib/pdf/tour-program-pdf'

/**
 * PDF программы тура: /api/admin/print/pdf/<slug>?client=Оксана
 *
 * Node-рантайм обязателен — pdfkit читает файлы шрифтов с диска.
 * Шрифты и public/ включены в бандл функции через outputFileTracingIncludes
 * в next.config.ts; без этого на Vercel файлы не доедут.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  const { slug } = await context.params
  const routeSlug = decodeURIComponent(slug.join('/'))
  const clientName = request.nextUrl.searchParams.get('client')?.trim() ?? ''

  const program = await buildPrintProgram(routeSlug)
  if (!program) {
    return NextResponse.json({ ok: false, error: 'Программа не найдена' }, { status: 404 })
  }

  try {
    const pdf = await renderTourProgramPdf(program, clientName)
    const fileName = `${routeSlug.split('/').pop() || 'program'}${clientName ? `-${clientName}` : ''}.pdf`

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // inline: открывается во вкладке; гость сам сохранит при желании
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (error) {
    console.error('[print-pdf] render failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Не удалось собрать PDF' }, { status: 500 })
  }
}
