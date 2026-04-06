import {
  type AirtablePoiSeoWorkspace,
  getAllPois,
  updateAirtablePoiSeoWorkspace,
} from '@/lib/airtable'

export type WorkspaceStatus = 'draft' | 'approved' | 'synced'

export interface SeoWorkspaceDraft {
  recordId: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn: string
  approvedEn: string
  status: WorkspaceStatus
  updatedAt: string
  syncedAt: string | null
}

interface UpsertDraftInput {
  recordId: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
}

interface MarkSyncedInput {
  recordId: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
}

function normalizeStatus(value: string, fallback: WorkspaceStatus): WorkspaceStatus {
  switch (value.trim().toLowerCase()) {
    case 'draft':
      return 'draft'
    case 'approved':
      return 'approved'
    case 'synced':
      return 'synced'
    default:
      return fallback
  }
}

function deriveFallbackStatus(workspace: Pick<SeoWorkspaceDraft, 'workingDraftRu' | 'workingDraftEn' | 'approvedRu' | 'approvedEn'>): WorkspaceStatus {
  if (workspace.approvedRu || workspace.approvedEn) {
    return 'approved'
  }

  if (workspace.workingDraftRu || workspace.workingDraftEn) {
    return 'draft'
  }

  return 'draft'
}

export function mapWorkspaceFieldsToDraft(
  poi: Pick<AirtablePoiSeoWorkspace, 'id' | 'poiId' | 'workingDraftRu' | 'approvedRu' | 'workingDraftEn' | 'approvedEn' | 'copyStatus'>,
): SeoWorkspaceDraft | null {
  const workingDraftRu = poi.workingDraftRu.trim()
  const approvedRu = poi.approvedRu.trim()
  const workingDraftEn = poi.workingDraftEn.trim()
  const approvedEn = poi.approvedEn.trim()

  const hasWorkspaceContent = Boolean(workingDraftRu || approvedRu || workingDraftEn || approvedEn || poi.copyStatus.trim())

  if (!hasWorkspaceContent) {
    return null
  }

  const fallbackStatus = deriveFallbackStatus({
    workingDraftRu,
    approvedRu,
    workingDraftEn,
    approvedEn,
  })

  const status = normalizeStatus(poi.copyStatus, fallbackStatus)
  const updatedAt = new Date().toISOString()

  return {
    recordId: poi.id,
    poiId: poi.poiId,
    workingDraftRu,
    approvedRu,
    workingDraftEn,
    approvedEn,
    status,
    updatedAt,
    syncedAt: status === 'synced' ? updatedAt : null,
  }
}

function buildNextDraft(input: UpsertDraftInput | MarkSyncedInput, status: WorkspaceStatus): SeoWorkspaceDraft {
  const timestamp = new Date().toISOString()

  return {
    recordId: input.recordId,
    poiId: input.poiId,
    workingDraftRu: input.workingDraftRu.trim(),
    approvedRu: input.approvedRu.trim(),
    workingDraftEn: input.workingDraftEn?.trim() ?? '',
    approvedEn: input.approvedEn?.trim() ?? '',
    status,
    updatedAt: timestamp,
    syncedAt: status === 'synced' ? timestamp : null,
  }
}

export async function getSeoWorkspaceDrafts() {
  const pois = await getAllPois()

  return pois.reduce<Record<string, SeoWorkspaceDraft>>((accumulator, poi) => {
    const draft = mapWorkspaceFieldsToDraft(poi)

    if (draft) {
      accumulator[poi.id] = draft
    }

    return accumulator
  }, {})
}

export async function upsertSeoWorkspaceDraft(input: UpsertDraftInput) {
  const nextDraft = buildNextDraft(
    input,
    input.approvedRu.trim() || input.approvedEn?.trim() ? 'approved' : 'draft',
  )

  await updateAirtablePoiSeoWorkspace({
    recordId: input.recordId,
    workingDraftRu: nextDraft.workingDraftRu,
    approvedRu: nextDraft.approvedRu,
    workingDraftEn: nextDraft.workingDraftEn,
    approvedEn: nextDraft.approvedEn,
    copyStatus: nextDraft.status,
  })

  return nextDraft
}

export async function markSeoWorkspaceDraftSynced(input: MarkSyncedInput, options?: { persist?: boolean }) {
  const nextDraft = buildNextDraft(input, 'synced')

  if (options?.persist !== false) {
    await updateAirtablePoiSeoWorkspace({
      recordId: input.recordId,
      workingDraftRu: nextDraft.workingDraftRu,
      approvedRu: nextDraft.approvedRu,
      workingDraftEn: nextDraft.workingDraftEn,
      approvedEn: nextDraft.approvedEn,
      copyStatus: nextDraft.status,
    })
  }

  return nextDraft
}
