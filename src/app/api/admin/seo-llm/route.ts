import { NextRequest, NextResponse } from 'next/server'

import { generatePoiDraft } from '@/lib/admin-draft-generator'
import { markSeoWorkspaceDraftSynced, upsertSeoWorkspaceDraft } from '@/lib/admin-seo-llm-storage'
import { syncAirtablePoiApprovedText } from '@/lib/airtable'

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
    const generationMode = getString(body.generationMode)
    const nameRu = getString(body.nameRu)
    const nameEn = getString(body.nameEn)
    const siteCity = getString(body.siteCity)
    const workingHours = getString(body.workingHours)
    const website = getString(body.website)
    const sourceRu = getString(body.sourceRu)
    const sourceEn = getString(body.sourceEn)
    const category = Array.isArray(body.category) ? body.category.filter((value): value is string => typeof value === 'string') : []

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

      await syncAirtablePoiApprovedText({
        recordId,
        workingDraftRu,
        approvedRu: normalizedApprovedRu,
        workingDraftEn,
        approvedEn: normalizedApprovedEn,
      })

      const draft = await markSeoWorkspaceDraftSynced(
        {
          recordId,
          poiId,
          workingDraftRu,
          approvedRu: normalizedApprovedRu,
          workingDraftEn,
          approvedEn: normalizedApprovedEn,
        },
        { persist: false },
      )

      return NextResponse.json({
        ok: true,
        draft,
        syncedFields: {
          descriptionRu: normalizedApprovedRu,
          ...(normalizedApprovedEn ? { descriptionEn: normalizedApprovedEn } : {}),
        },
      })
    }

    if (action === 'generateDraft') {
      if (generationMode !== 'rewrite') {
        return NextResponse.json({ ok: false, error: 'generationMode must be rewrite' }, { status: 400 })
      }

      const generatedDraft = await generatePoiDraft({
        mode: generationMode,
        nameRu,
        nameEn,
        siteCity,
        category,
        workingHours,
        website,
        sourceRu,
        sourceEn,
        currentDraftRu: workingDraftRu,
        currentDraftEn: workingDraftEn,
        approvedRu,
        approvedEn,
      })

      const draft = await upsertSeoWorkspaceDraft({
        recordId,
        poiId,
        workingDraftRu: generatedDraft.draftRu,
        approvedRu,
        workingDraftEn: generatedDraft.draftEn,
        approvedEn,
      })

      return NextResponse.json({ ok: true, draft, generatedDraftRu: generatedDraft.draftRu, generatedDraftEn: generatedDraft.draftEn })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
