import { NextRequest, NextResponse } from 'next/server'

import { markSeoWorkspaceDraftSynced, upsertSeoWorkspaceDraft } from '@/lib/admin-seo-llm-storage'
import { updateAirtablePoiText } from '@/lib/airtable'

function getString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const action = getString(body.action)
    const recordId = getString(body.recordId)
    const poiId = getString(body.poiId)
    const workingDraftRu = getString(body.workingDraftRu)
    const approvedRu = getString(body.approvedRu)
    const workingDraftEn = getString(body.workingDraftEn)
    const approvedEn = getString(body.approvedEn)

    if (!recordId || !poiId) {
      return NextResponse.json({ ok: false, error: 'recordId and poiId are required' }, { status: 400 })
    }

    if (action === 'saveDraft') {
      const draft = await upsertSeoWorkspaceDraft({
        recordId,
        poiId,
        workingDraftRu,
        approvedRu,
        workingDraftEn,
        approvedEn,
      })

      return NextResponse.json({ ok: true, draft })
    }

    if (action === 'syncApproved') {
      const normalizedApprovedRu = approvedRu.trim()
      const normalizedApprovedEn = approvedEn.trim()

      if (!normalizedApprovedRu) {
        return NextResponse.json({ ok: false, error: 'Approved RU text is required before syncing' }, { status: 400 })
      }

      await updateAirtablePoiText({
        recordId,
        descriptionRu: normalizedApprovedRu,
        descriptionEn: normalizedApprovedEn ? normalizedApprovedEn : undefined,
      })

      const draft = await markSeoWorkspaceDraftSynced({
        recordId,
        poiId,
        workingDraftRu,
        approvedRu: normalizedApprovedRu,
        workingDraftEn,
        approvedEn: normalizedApprovedEn,
      })

      return NextResponse.json({
        ok: true,
        draft,
        syncedFields: {
          descriptionRu: normalizedApprovedRu,
          ...(normalizedApprovedEn ? { descriptionEn: normalizedApprovedEn } : {}),
        },
      })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
