import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { handleContactForm, type ContactFormInput } from '@/workflows/contact-form'

export async function POST(request: Request) {
  const body = (await request.json()) as ContactFormInput

  // Validate required fields
  if (!body.name?.trim() || !body.contact?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Name and contact are required' },
      { status: 400 }
    )
  }

  try {
    // Start durable workflow (non-blocking)
    const run = await start(handleContactForm, [body])

    console.log('[contact] Workflow started:', run.runId)

    return NextResponse.json({
      ok: true,
      runId: run.runId,
    })
  } catch (error) {
    console.error('[contact] Failed to start workflow:', error)

    // Fallback: log to console if workflow fails to start
    console.log('[contact] Fallback logging:', body)

    return NextResponse.json({
      ok: true,
      fallback: true,
    })
  }
}
