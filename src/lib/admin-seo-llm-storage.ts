import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

interface SeoWorkspaceDraftStore {
  drafts: Record<string, SeoWorkspaceDraft>
}

const STORAGE_PATH = path.join(process.cwd(), 'storage', 'admin-seo-llm-drafts.json')

function createEmptyStore(): SeoWorkspaceDraftStore {
  return { drafts: {} }
}

async function ensureStorageFile() {
  await mkdir(path.dirname(STORAGE_PATH), { recursive: true })

  try {
    await readFile(STORAGE_PATH, 'utf8')
  } catch {
    await writeFile(STORAGE_PATH, JSON.stringify(createEmptyStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<SeoWorkspaceDraftStore> {
  await ensureStorageFile()

  try {
    const raw = await readFile(STORAGE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SeoWorkspaceDraftStore>

    return {
      drafts: parsed.drafts ?? {},
    }
  } catch {
    return createEmptyStore()
  }
}

async function writeStore(store: SeoWorkspaceDraftStore) {
  await ensureStorageFile()
  await writeFile(STORAGE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function getSeoWorkspaceDrafts() {
  const store = await readStore()
  return store.drafts
}

interface UpsertDraftInput {
  recordId: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
}

export async function upsertSeoWorkspaceDraft(input: UpsertDraftInput) {
  const store = await readStore()
  const existing = store.drafts[input.recordId]
  const updatedAt = new Date().toISOString()

  const workingDraftRu = input.workingDraftRu.trim()
  const approvedRu = input.approvedRu.trim()
  const workingDraftEn = input.workingDraftEn?.trim() ?? existing?.workingDraftEn ?? ''
  const approvedEn = input.approvedEn?.trim() ?? existing?.approvedEn ?? ''

  const status: WorkspaceStatus = approvedRu || approvedEn
    ? 'approved'
    : workingDraftRu || workingDraftEn
      ? 'draft'
      : 'draft'

  const nextDraft: SeoWorkspaceDraft = {
    recordId: input.recordId,
    poiId: input.poiId,
    workingDraftRu,
    approvedRu,
    workingDraftEn,
    approvedEn,
    status,
    updatedAt,
    syncedAt: null,
  }

  store.drafts[input.recordId] = nextDraft
  await writeStore(store)

  return nextDraft
}

interface MarkSyncedInput {
  recordId: string
  poiId: string
  workingDraftRu: string
  approvedRu: string
  workingDraftEn?: string
  approvedEn?: string
}

export async function markSeoWorkspaceDraftSynced(input: MarkSyncedInput) {
  const store = await readStore()
  const timestamp = new Date().toISOString()

  const nextDraft: SeoWorkspaceDraft = {
    recordId: input.recordId,
    poiId: input.poiId,
    workingDraftRu: input.workingDraftRu.trim(),
    approvedRu: input.approvedRu.trim(),
    workingDraftEn: input.workingDraftEn?.trim() ?? '',
    approvedEn: input.approvedEn?.trim() ?? '',
    status: 'synced',
    updatedAt: timestamp,
    syncedAt: timestamp,
  }

  store.drafts[input.recordId] = nextDraft
  await writeStore(store)

  return nextDraft
}
