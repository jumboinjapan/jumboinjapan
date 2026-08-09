'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from 'react'
import { CloudUpload, Search, Sparkles, Trash2, X } from 'lucide-react'

import { AdminShell } from '@/components/admin/AdminShell'
import { adminDangerButtonClass, adminPrimaryButtonClass, adminSecondaryButtonClass } from '@/components/admin/ui'
import { ADMIN_STATUS_LABELS } from '@/lib/admin-status'
import { useUnsavedGuard } from '@/components/admin/useUnsavedGuard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatAdminCityLabel } from '@/lib/admin-city-label'
import type { SeoWorkspaceDraft, WorkspaceStatus } from '@/lib/admin-seo-llm-storage'
import {
  POI_ADMIN_TEXT_BUDGET_FIELDS,
  analyzeTextBudget,
  formatTextBudgetGuidance,
  type TextBudgetFieldConfig,
  type TextBudgetStatus,
} from '@/lib/text-budgets'

export type AdminSection = 'overview' | 'poi-text' | 'route-text' | 'route-stops' | 'integrations'

/** Тексты записи. Приходят отдельно от списка — по одной открытой карточке. */
export interface WorkspaceItemDetail {
  descriptionRu: string
  descriptionEn: string
  workingHours: string
  website: string
  draft: SeoWorkspaceDraft | null
}

/* Список намеренно без текстов: 418 записей с описаниями и черновиками —
   это мегабайты в разметке страницы. Пока браузер их разбирал, экран стоял
   нарисованный, но неживой: клик по списку не срабатывал, набранное в поле
   названия стиралось в момент, когда React наконец включался. Тексты грузим
   по выбранной записи. */
export interface WorkspaceItem {
  id: string
  poiId: string
  nameRu: string
  nameEn: string
  category: string[]
  siteCity: string
  /** Состояние записи — нужно фильтрам и счётчикам, поэтому едет со списком. */
  status: WorkspaceStatus
  /** Есть ли живой текст в Airtable — признак для списка, сам текст не нужен. */
  hasSource: boolean
  /** null — тексты ещё не загружены. */
  detail: WorkspaceItemDetail | null
}

interface WorkspaceResponse {
  ok: boolean
  draft: SeoWorkspaceDraft
  syncedFields?: {
    descriptionRu: string
    descriptionEn?: string
  }
  updatedFields?: {
    nameRu: string
    nameEn: string
  }
  deletedFields?: {
    recordId: string
    poiId: string
  }
  generatedDraftRu?: string
  suggestedNameEn?: string
  canonNotes?: string[]
  detail?: WorkspaceItemDetail
  error?: string
}

/** Набранное, но ещё не записанное название POI. */
type PendingTitle = { recordId: string; nameRu: string; nameEn: string } | null

interface AdminOperationsConsoleProps {
  items: WorkspaceItem[]
  routeCount: number
  initialSection: AdminSection
  currentPath: '/admin' | '/admin/seo-llm' | '/admin/resources'
}

const statusStyles: Record<WorkspaceStatus, string> = {
  draft: 'border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
  review: 'border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]',
  approved: 'border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]',
  synced: 'border border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]',
}

/* Подписи берём из общего словаря: те же слова, что в ЧАВО, конструкторе
   и на остановках. Значения (draft/approved/synced) не трогаем — они уходят
   в Airtable как есть. */
const statusLabels: Record<WorkspaceStatus, string> = {
  draft: ADMIN_STATUS_LABELS.draft,
  review: ADMIN_STATUS_LABELS.review,
  approved: ADMIN_STATUS_LABELS.approved,
  synced: ADMIN_STATUS_LABELS.published,
}

const textBudgetStateLabels: Record<TextBudgetStatus, string> = {
  ok: 'В норме',
  warning: 'На пределе',
  unsafe: 'Длиннее нормы',
}

const textBudgetStateStyles: Record<TextBudgetStatus, string> = {
  ok: 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]',
  warning: 'border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
  unsafe: 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
}

function getEffectiveStatus(item: WorkspaceItem): WorkspaceStatus {
  return item.status
}

function getDraft(item: WorkspaceItem) {
  return item.detail?.draft ?? null
}

function getWorkingDraftRu(item: WorkspaceItem) {
  return item.detail?.draft?.workingDraftRu ?? ''
}

function getWorkingDraftEn(item: WorkspaceItem) {
  return item.detail?.draft?.workingDraftEn ?? ''
}

function getApprovedRu(item: WorkspaceItem) {
  return item.detail?.draft?.approvedRu ?? ''
}

function getApprovedEn(item: WorkspaceItem) {
  return item.detail?.draft?.approvedEn ?? ''
}

/** Черновик меняется вместе с состоянием: они всегда должны совпадать. */
function withDraft(item: WorkspaceItem, draft: SeoWorkspaceDraft | null): WorkspaceItem {
  return {
    ...item,
    status: draft?.status ?? item.status,
    detail: item.detail ? { ...item.detail, draft } : item.detail,
  }
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not yet'

  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Not yet'
  }
}

async function fetchWorkspaceDetail(recordId: string): Promise<WorkspaceItemDetail> {
  const response = await fetch(`/api/admin/seo-llm?recordId=${encodeURIComponent(recordId)}`, {
    cache: 'no-store',
  })

  const data = (await response.json()) as WorkspaceResponse

  if (!response.ok || !data.ok || !data.detail) {
    throw new Error(data.error ?? 'Не удалось загрузить запись')
  }

  return data.detail
}

async function postWorkspaceAction(payload: Record<string, unknown>) {
  const response = await fetch('/api/admin/seo-llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = (await response.json()) as WorkspaceResponse

  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? 'Request failed')
  }

  return data
}

export function AdminOperationsConsole({ items, routeCount }: AdminOperationsConsoleProps) {
  const [workspaceItems, setWorkspaceItems] = useState(items)

  /* Свежие данные с сервера приходят пропсом items — в том числе сразу после
     нашей же записи, потому что updateTitle и approveAndPublish дёргают
     revalidateTag. Раньше этот эффект молча заменял ими локальное состояние.
     Airtable отвечает на чтение не мгновенно, поэтому в ответ часто приезжало
     ПРЕЖНЕЕ название — и поле возвращалось к старому значению на глазах.
     Со стороны это выглядит как «нажал сохранить, и ничего не произошло»,
     хотя запись прошла.

     Тот же дефект чинился в справочнике ресурсов в волне 0; здесь он остался,
     потому что экран POI волна 0 не трогала. */
  const serverItemsRef = useRef(items)
  const localItemsRef = useRef(items)

  useEffect(() => {
    localItemsRef.current = workspaceItems
  }, [workspaceItems])

  useEffect(() => {
    const previousServer = new Map<string, WorkspaceItem>(serverItemsRef.current.map((item) => [item.id, item]))
    const local = new Map<string, WorkspaceItem>(localItemsRef.current.map((item) => [item.id, item]))

    const merged = items.map((incoming) => {
      const mine = local.get(incoming.id)
      const wasOnServer = previousServer.get(incoming.id)
      if (!mine || !wasOnServer) return incoming
      // Запись, которую меняли мы, серверным ответом не перетираем:
      // наша версия новее того, что успел отдать Airtable.
      const changedLocally = JSON.stringify(mine) !== JSON.stringify(wasOnServer)
      // Тексты в списке не приходят вовсе — уже загруженную карточку
      // серверный список обнулять не должен.
      return changedLocally ? mine : { ...incoming, detail: mine.detail }
    })

    serverItemsRef.current = items
    setWorkspaceItems(merged)
  }, [items])

  const stats = useMemo(() => {
    const drafts = workspaceItems.filter((item) => getEffectiveStatus(item) === 'draft').length
    const approved = workspaceItems.filter((item) => getEffectiveStatus(item) === 'approved').length
    const synced = workspaceItems.filter((item) => getEffectiveStatus(item) === 'synced').length
    const cities = new Set(workspaceItems.map((item) => item.siteCity).filter(Boolean)).size

    return {
      total: workspaceItems.length,
      drafts,
      approved,
      synced,
      cities,
    }
  }, [workspaceItems])

  return (
    <AdminShell
      currentPath="/admin/seo-llm"
      title="POI"
      subtitle="Названия, описания и LLM-тексты карточек POI"
      maxWidth="max-w-7xl"
    >
      <StatusStrip stats={stats} routeCount={routeCount} />

      <PoiTextWorkspace items={workspaceItems} onItemsChange={setWorkspaceItems} />
    </AdminShell>
  )
}

function StatusStrip({
  stats,
  routeCount,
}: {
  stats: { total: number; drafts: number; approved: number; synced: number; cities: number }
  routeCount: number
}) {
  return (
    <section className="grid gap-2 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] px-4 py-3 text-sm text-[var(--adm-text-2)] md:grid-cols-5">
      <StatusCell label="POI" value={String(stats.total)} />
      <StatusCell label="Черновиков" value={String(stats.drafts)} />
      <StatusCell label="Утверждено" value={String(stats.approved)} />
      <StatusCell label="На сайте" value={String(stats.synced)} />
      <StatusCell label="Маршрутов" value={String(routeCount)} />
    </section>
  )
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2">
      <span className="text-[var(--adm-text-3)]">{label}</span>
      <span className="font-medium text-[var(--adm-text)]">{value}</span>
    </div>
  )
}

function PoiTextWorkspace({
  items,
  onItemsChange,
}: {
  items: WorkspaceItem[]
  onItemsChange: Dispatch<SetStateAction<WorkspaceItem[]>>
}) {
  const workspaceItems = items
  const setWorkspaceItems = onItemsChange
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | WorkspaceStatus>('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isGenerating, startGenerateTransition] = useTransition()
  const [isPublishing, startPublishTransition] = useTransition()
  const [isSavingTitle, startTitleSaveTransition] = useTransition()
  const [isDeletingPoi, startDeletePoiTransition] = useTransition()
  const [generationMode, setGenerationMode] = useState<'rewrite' | null>(null)
  /* Сообщения рисовались одной строкой в самом верху <main>, никогда не
     гасли и не различали успех и ошибку. На длинной карточке места редактор
     стоит в середине, панель действий прибита к низу — сообщение наверху
     не видно вовсе. Отсюда «нажимаю, и ничего не происходит»: результат был,
     показывался он за пределами экрана. */
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const setFlashMessage = (text: string) => setFlash({ text, tone: 'ok' })
  const setFlashError = (text: string) => setFlash({ text, tone: 'err' })

  useEffect(() => {
    if (!flash) return
    const timeout = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(timeout)
  }, [flash])
  const [seededDraftIds, setSeededDraftIds] = useState<Record<string, boolean>>({})
  const [suggestedNameEn, setSuggestedNameEn] = useState<string | null>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
  const requestedDetailIds = useRef<Set<string>>(new Set())
  /* Набранное, но не сохранённое название. Редактор названия жил островом:
     любое другое действие — переключение записи, публикация — молча стирало
     набранное, и человек видел одно в поле и другое в списке. Держим правку
     здесь, чтобы её можно было дописать перед любым следующим шагом. */
  const pendingTitleRef = useRef<PendingTitle>(null)

  /* Экран отрисован разметкой с сервера задолго до того, как React к ней
     подключится. До этого момента кнопки нажимаются вхолостую, а набранный
     текст стирается при подключении. Поэтому пока не оживём — говорим это
     прямо и не даём редактировать. */
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(true)
  }, [])

  const cityOptions = useMemo(
    () => Array.from(new Set(workspaceItems.map((item) => item.siteCity).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [workspaceItems],
  )

  const categoryOptions = useMemo(
    () => Array.from(new Set(workspaceItems.flatMap((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [workspaceItems],
  )

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return workspaceItems.filter((item) => {
      const haystack = [item.poiId, item.nameRu, item.nameEn, item.siteCity, item.category.join(' ')].join(' ').toLowerCase()
      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery)
      const matchesStatus = statusFilter === 'all' || getEffectiveStatus(item) === statusFilter
      const matchesCity = cityFilter === 'all' || item.siteCity === cityFilter
      const matchesCategory = categoryFilter === 'all' || item.category.includes(categoryFilter)
      return matchesQuery && matchesStatus && matchesCity && matchesCategory
    })
  }, [categoryFilter, cityFilter, query, statusFilter, workspaceItems])

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? '')
    }
  }, [filteredItems, selectedId])

  const selectedItem = workspaceItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null
  const selectedDetail = selectedItem?.detail ?? null
  const isDetailLoading = Boolean(selectedItem && !selectedDetail)
  const hasSourceText = selectedItem ? selectedItem.hasSource : false
  const selectedStatus = selectedItem ? getEffectiveStatus(selectedItem) : null

  /* Тексты выбранной записи. Список их не везёт — иначе страница весит
     мегабайты и не оживает по десятку секунд. */
  useEffect(() => {
    const recordId = selectedItem?.id
    if (!recordId || selectedItem?.detail || requestedDetailIds.current.has(recordId)) return

    requestedDetailIds.current.add(recordId)
    setDetailLoadingId(recordId)
    let cancelled = false

    fetchWorkspaceDetail(recordId)
      .then((detail) => {
        if (cancelled) return
        setWorkspaceItems((current) =>
          current.map((item) =>
            item.id === recordId ? { ...item, detail, status: detail.draft?.status ?? item.status } : item,
          ),
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        requestedDetailIds.current.delete(recordId)
        setFlashError(error instanceof Error ? error.message : 'Не удалось загрузить запись')
      })
      .finally(() => {
        // Без проверки на cancelled: эффект перезапускается сразу после
        // прихода текстов, и «отменённый» finally оставил бы висеть признак
        // загрузки навсегда.
        setDetailLoadingId((current) => (current === recordId ? null : current))
      })

    return () => {
      cancelled = true
    }
    // Ключ — выбранная запись и факт наличия текстов. setFlashError пересоздаётся
    // каждый рендер, в зависимостях он бы зациклил эффект.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id, selectedItem?.detail])

  function updateItem(recordId: string, updater: (item: WorkspaceItem) => WorkspaceItem) {
    setWorkspaceItems((currentItems) => currentItems.map((item) => (item.id === recordId ? updater(item) : item)))
  }

  async function saveDraft(recordId: string, nextItem: WorkspaceItem) {
    try {
      const data = await postWorkspaceAction({
        action: 'saveDraft',
        recordId: nextItem.id,
        poiId: nextItem.poiId,
        workingDraftRu: getWorkingDraftRu(nextItem),
        approvedRu: getApprovedRu(nextItem),
        workingDraftEn: getWorkingDraftEn(nextItem),
        approvedEn: getApprovedEn(nextItem),
        // Состояние передаём явно: сервер его больше не выдумывает.
        copyStatus: getDraft(nextItem)?.status,
      })

      updateItem(recordId, (item) => withDraft(item, data.draft))
      setFlashMessage('Черновик сохранён')
    } catch (error) {
      setFlashError(error instanceof Error ? error.message : 'Не удалось сохранить черновик')
    }
  }

  async function mutateDraft(recordId: string, fields: Partial<SeoWorkspaceDraft>) {
    const currentItem = workspaceItems.find((item) => item.id === recordId)
    if (!currentItem || !currentItem.detail) return

    const nextApprovedRu = fields.approvedRu ?? getApprovedRu(currentItem)
    const nextApprovedEn = fields.approvedEn ?? getApprovedEn(currentItem)
    const approvedChanged =
      nextApprovedRu !== getApprovedRu(currentItem) || nextApprovedEn !== getApprovedEn(currentItem)
    /* Пока принятые тексты не тронуты — состояние записи не наше дело.
       Иначе набор одной буквы в черновике повышал Review до Approved и сбивал
       Synced, затирая классификацию, которую POI-конвейер расставил по базе. */
    const nextStatus: SeoWorkspaceDraft['status'] = !approvedChanged
      ? currentItem.status
      : nextApprovedRu || nextApprovedEn
        ? 'approved'
        : 'draft'

    const nextItem: WorkspaceItem = withDraft(currentItem, {
      recordId: currentItem.id,
      poiId: currentItem.poiId,
      workingDraftRu: fields.workingDraftRu ?? getWorkingDraftRu(currentItem),
      approvedRu: fields.approvedRu ?? getApprovedRu(currentItem),
      workingDraftEn: fields.workingDraftEn ?? getWorkingDraftEn(currentItem),
      approvedEn: fields.approvedEn ?? getApprovedEn(currentItem),
      // Раньше статус пересчитывался только в approved|draft, поэтому правка
      // черновика у выложенной записи молча теряла признак synced.
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      syncedAt: getDraft(currentItem)?.syncedAt ?? null,
    })

    updateItem(recordId, () => nextItem)
    await saveDraft(recordId, nextItem)
  }

  /** Локальный засев черновика из исходника — без записи в базу. */
  function seedDraftLocally(recordId: string, fields: Partial<SeoWorkspaceDraft>) {
    const currentItem = workspaceItems.find((item) => item.id === recordId)
    if (!currentItem || !currentItem.detail) return
    updateItem(recordId, (item) =>
      withDraft(item, {
        recordId: item.id,
        poiId: item.poiId,
        workingDraftRu: fields.workingDraftRu ?? getWorkingDraftRu(item),
        approvedRu: getApprovedRu(item),
        workingDraftEn: fields.workingDraftEn ?? getWorkingDraftEn(item),
        approvedEn: getApprovedEn(item),
        status: getDraft(item)?.status ?? item.status,
        updatedAt: getDraft(item)?.updatedAt ?? new Date().toISOString(),
        syncedAt: getDraft(item)?.syncedAt ?? null,
      }),
    )
  }

  useEffect(() => {
    if (!selectedItem || !selectedItem.detail || seededDraftIds[selectedItem.id]) return

    const hasDraft = Boolean(getWorkingDraftRu(selectedItem).trim() || getWorkingDraftEn(selectedItem).trim())
    const hasSource = Boolean(selectedItem.detail.descriptionRu.trim() || selectedItem.detail.descriptionEn.trim())
    if (hasDraft || !hasSource) return

    setSeededDraftIds((current) => ({ ...current, [selectedItem.id]: true }))
    // Засев черновика происходит ТОЛЬКО локально. Раньше здесь вызывался
    // mutateDraft, то есть простой просмотр точки писал запись в Airtable:
    // менялась дата правки, двигались счётчики, а достаточно было сменить
    // фильтр — выделение само перескакивало на первую строку списка.
    seedDraftLocally(selectedItem.id, {
      workingDraftRu: selectedItem.detail.descriptionRu,
      workingDraftEn: selectedItem.detail.descriptionEn,
    })
    // Intentionally keyed on selectedItem.id only: this seeds a draft once per
    // selected POI. Adding mutateDraft/seededDraftIds/selectedItem would re-run
    // this on every render (they change every render), not just on selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id, selectedItem?.detail])

  useEffect(() => {
    setSuggestedNameEn(null)
  }, [selectedItem?.id])

  function handleGenerate() {
    if (!selectedItem) return
    const detail = selectedItem.detail
    if (!detail) {
      setFlashError('Запись ещё грузится — секунду')
      return
    }

    setGenerationMode('rewrite')
    startGenerateTransition(async () => {
      try {
        await flushPendingTitle()
        const data = await postWorkspaceAction({
          action: 'generateDraft',
          generationMode: 'rewrite',
          recordId: selectedItem.id,
          poiId: selectedItem.poiId,
          nameRu: selectedItem.nameRu,
          nameEn: selectedItem.nameEn,
          siteCity: selectedItem.siteCity,
          category: selectedItem.category,
          workingHours: detail.workingHours,
          website: detail.website,
          sourceRu: detail.descriptionRu,
          sourceEn: detail.descriptionEn,
          workingDraftRu: getWorkingDraftRu(selectedItem),
          approvedRu: getApprovedRu(selectedItem),
          workingDraftEn: getWorkingDraftEn(selectedItem),
          approvedEn: getApprovedEn(selectedItem),
        })

        updateItem(selectedItem.id, (item) => withDraft(item, data.draft))
        if (data.suggestedNameEn) {
          setSuggestedNameEn(data.suggestedNameEn)
        }
        const canonNotes = data.canonNotes ?? []
        setFlashMessage(
          canonNotes.length
            ? `Текст переписан. Разошлось с каноном: ${canonNotes.join('; ')}`
            : 'Текст переписан в черновик',
        )
      } catch (error) {
        setFlashError(error instanceof Error ? error.message : 'Не удалось переписать текст')
      } finally {
        setGenerationMode(null)
      }
    })
  }

  function handleApproveAndPublish() {
    if (!selectedItem) return
    if (!selectedItem.detail) {
      setFlashError('Запись ещё грузится — секунду')
      return
    }
    const draftRu = getWorkingDraftRu(selectedItem).trim()
    if (!draftRu) {
      setFlashError('Публиковать нечего: русский черновик пуст')
      return
    }

    startPublishTransition(async () => {
      try {
        await flushPendingTitle()
        const data = await postWorkspaceAction({
          action: 'approveAndPublish',
          recordId: selectedItem.id,
          poiId: selectedItem.poiId,
          workingDraftRu: getWorkingDraftRu(selectedItem),
          workingDraftEn: getWorkingDraftEn(selectedItem),
        })

        setWorkspaceItems((currentItems) =>
          currentItems.map((item) => {
            if (item.id !== selectedItem.id || !item.detail) return item
            const nextDraft = data.draft ?? item.detail.draft
            return {
              ...item,
              hasSource: true,
              status: nextDraft?.status ?? item.status,
              detail: {
                ...item.detail,
                descriptionRu: data.syncedFields?.descriptionRu ?? item.detail.descriptionRu,
                descriptionEn: data.syncedFields?.descriptionEn ?? item.detail.descriptionEn,
                draft: nextDraft,
              },
            }
          }),
        )
        const publishedEn = getWorkingDraftEn(selectedItem).trim()
        setFlashMessage(
          publishedEn
            ? 'Опубликовано: русский и английский тексты на сайте'
            : 'Опубликован русский текст. Английский не тронут — черновик пуст',
        )
      } catch (error) {
        setFlashError(error instanceof Error ? error.message : 'Не удалось утвердить и опубликовать')
      }
    })
  }

  async function saveTitle(recordId: string, nameRu: string, nameEn: string) {
    const item = workspaceItems.find((entry) => entry.id === recordId)
    if (!item) return
    if (!nameRu.trim() && !nameEn.trim()) return
    if (nameRu === item.nameRu && nameEn === item.nameEn) return

    try {
      const data = await postWorkspaceAction({
        action: 'updateTitle',
        recordId,
        poiId: item.poiId,
        nameRu,
        nameEn,
      })

      setWorkspaceItems((currentItems) =>
        currentItems.map((entry) =>
          entry.id === recordId
            ? {
                ...entry,
                nameRu: data.updatedFields?.nameRu ?? entry.nameRu,
                nameEn: data.updatedFields?.nameEn ?? entry.nameEn,
              }
            : entry,
        ),
      )
      if (pendingTitleRef.current?.recordId === recordId) {
        pendingTitleRef.current = null
      }
      setSuggestedNameEn(null)
      setFlashMessage('Название сохранено в Airtable')
    } catch (error) {
      setFlashError(error instanceof Error ? error.message : 'Не удалось сохранить название')
    }
  }

  function handleTitleSave(nameRu: string, nameEn: string) {
    if (!selectedItem) return
    const recordId = selectedItem.id
    startTitleSaveTransition(() => saveTitle(recordId, nameRu, nameEn))
  }

  /* Набранное название дописываем перед любым следующим действием.
     Уход из поля сохраняет и сам, но клик по кнопке в нижней панели может
     обогнать это сохранение — здесь страховка. */
  async function flushPendingTitle() {
    const pending = pendingTitleRef.current
    if (!pending) return
    pendingTitleRef.current = null
    await saveTitle(pending.recordId, pending.nameRu, pending.nameEn)
  }

  function handleDeletePoi() {
    if (!selectedItem) return

    const confirmation = window.prompt(`Delete ${selectedItem.poiId}? Type the exact POI ID to confirm.`)
    if (confirmation !== selectedItem.poiId) {
      if (confirmation !== null) {
        setFlashError('Удаление отменено: код POI не совпал')
      }
      return
    }

    startDeletePoiTransition(async () => {
      try {
        const data = await postWorkspaceAction({
          action: 'deletePoi',
          recordId: selectedItem.id,
          poiId: selectedItem.poiId,
        })

        setWorkspaceItems((currentItems) => currentItems.filter((item) => item.id !== (data.deletedFields?.recordId ?? selectedItem.id)))
        setFlashMessage(`POI ${data.deletedFields?.poiId ?? selectedItem.poiId} deleted from Airtable`)
      } catch (error) {
        setFlashError(error instanceof Error ? error.message : 'Не удалось удалить POI')
      }
    })
  }

  return (
    <main className="space-y-4 pb-28">
      <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,0.72fr))]">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 focus-within:border-[var(--adm-accent-border)]">
            <Search className="size-4 text-[var(--adm-text-3)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти по названию, городу, категории"
              className="w-full bg-transparent text-sm text-[var(--adm-text)] outline-none placeholder:text-[var(--adm-text-3)]"
            />
          </label>

          <FilterSelect
            label="Состояние"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'all' | WorkspaceStatus)}
            options={[
              { value: 'all', label: 'Любое' },
              { value: 'draft', label: statusLabels.draft },
              { value: 'review', label: statusLabels.review },
              { value: 'approved', label: statusLabels.approved },
              { value: 'synced', label: statusLabels.synced },
            ]}
          />
          <FilterSelect
            label="Город"
            value={cityFilter}
            onChange={setCityFilter}
            options={[
              { value: 'all', label: 'Все города' },
              ...cityOptions.map((city) => ({ value: city, label: formatAdminCityLabel(city) })),
            ]}
          />
          <FilterSelect
            label="Категория"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: 'all', label: 'Все категории' },
              ...categoryOptions.map((category) => ({ value: category, label: category })),
            ]}
          />
        </div>

        <div className="mt-3 text-sm text-[var(--adm-text-3)]">{filteredItems.length} results</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)]">
          <div className="max-h-[70vh] overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-[var(--adm-text-2)]">Ничего не нашлось.</div>
            ) : (
              <div className="divide-y divide-[var(--adm-border)]">
                {filteredItems.map((item) => {
                  const isActive = item.id === selectedId
                  const status = getEffectiveStatus(item)

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        /* Дописываем набранное название до смены записи.
                           Полагаться на уход из поля нельзя: он не срабатывает,
                           когда окно браузера не в фокусе, — прогон поймал это
                           на живой панели. */
                        void flushPendingTitle()
                        setSelectedId(item.id)
                      }}
                      className={cn(
                        'grid w-full gap-1 px-4 py-3 text-left transition',
                        isActive ? 'bg-[var(--adm-active)]' : 'hover:bg-[var(--adm-hover)]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-[var(--adm-text)]">{item.nameRu || item.nameEn || 'Без названия'}</div>
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', statusStyles[status])}>
                          {statusLabels[status]}
                        </span>
                      </div>
                      <div className="truncate text-xs uppercase tracking-[0.14em] text-[var(--adm-text-3)]">{item.poiId || 'Без кода'}</div>
                      <div className="truncate text-xs text-[var(--adm-text-3)]">
                        {formatAdminCityLabel(item.siteCity) || 'Город не указан'}{item.category[0] ? ` • ${item.category[0]}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {!selectedItem ? (
          <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4 text-sm text-[var(--adm-text-2)]">
            No POI selected.
          </section>
        ) : (
          <section className="space-y-4">
            <div className="grid gap-2 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-3 text-sm md:grid-cols-5">
              <MetaCell label="Состояние" value={selectedStatus ? statusLabels[selectedStatus] : statusLabels.draft} tone={selectedStatus ? statusStyles[selectedStatus] : statusStyles.draft} />
              <MetaCell label="POI" value={selectedItem.poiId || '—'} />
              <MetaCell label="Город" value={formatAdminCityLabel(selectedItem.siteCity) || '—'} />
              <MetaCell label="Правка" value={formatTimestamp(selectedDetail?.draft?.updatedAt)} />
              <MetaCell label="Ушло на сайт" value={formatTimestamp(selectedDetail?.draft?.syncedAt)} />
            </div>

            <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4">
              <TitleEditor
                recordId={selectedItem.id}
                nameRu={selectedItem.nameRu}
                nameEn={selectedItem.nameEn}
                isSaving={isSavingTitle}
                isReady={ready}
                pendingRef={pendingTitleRef}
                onSave={handleTitleSave}
              />
            </section>

            <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4">
              {isDetailLoading ? (
                <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 py-6 text-sm text-[var(--adm-text-2)]">
                  {/* До гидратации запрос ещё не уходил: говорить «не загрузились»
                      в этот момент — врать на пустом месте. */}
                  {!ready || detailLoadingId === selectedItem.id
                    ? 'Загружаю тексты записи…'
                    : 'Тексты записи не загрузились. Обновите страницу.'}
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <TextPanel
                    title="В Airtable сейчас"
                    description="Живой текст записи"
                    value={selectedDetail?.descriptionRu ?? ''}
                    secondaryValue={selectedDetail?.descriptionEn ?? ''}
                    readOnly
                    tone="reference"
                    badge="Только чтение"
                    primaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.sourceRu}
                    secondaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.sourceEn}
                    helper={hasSourceText ? 'Живой текст из Airtable. Пустой черновик начинается с него.' : 'У записи нет исходного текста.'}
                  />
                  <TextPanel
                    title="Черновик"
                    description="Рабочая версия"
                    value={getWorkingDraftRu(selectedItem)}
                    secondaryValue={getWorkingDraftEn(selectedItem)}
                    tone="editable"
                    readOnly={!ready}
                    badge={!ready ? 'Экран ещё загружается' : isGenerating ? 'Черновик от ИИ…' : 'Сохраняется при уходе из поля'}
                    primaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.workingDraftRu}
                    secondaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.workingDraftEn}
                    helper="Черновик начинается с живого текста записи. Перепишите его ИИ или руками, потом утвердите."
                    onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                    onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                  />
                  {/* Approved panel hidden as internal state; Approve & publish handles promotion + sync */}
                </div>
              )}
            </section>

            <CollapsiblePanel title="История правок">
              <div className="grid gap-2 md:grid-cols-2">
                <CompactStat label="Правка черновика" value={formatTimestamp(selectedDetail?.draft?.updatedAt)} />
                <CompactStat label="Ушло на сайт" value={formatTimestamp(selectedDetail?.draft?.syncedAt)} />
                <CompactStat label="На странице" value={selectedStatus === 'synced' ? statusLabels.synced : statusLabels.draft} />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Что ещё известно о записи">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <CompactStat label="Название RU" value={selectedItem.nameRu || '—'} />
                <CompactStat label="Название EN" value={selectedItem.nameEn || '—'} />
                {suggestedNameEn && !selectedItem.nameEn ? (
                  <div className="col-span-1 md:col-span-2 xl:col-span-2 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2 text-sm">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--adm-text-3)] mb-1">Предложение агента</div>
                    <div className="text-[var(--adm-text)]">Suggested Name EN: {suggestedNameEn}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-[var(--adm-border)] bg-[var(--adm-active)] px-2.5 py-0.5 text-xs hover:bg-[var(--adm-active)]"
                        onClick={() => {
                          handleTitleSave(selectedItem.nameRu, suggestedNameEn)
                          setSuggestedNameEn(null)
                        }}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-[var(--adm-border)] bg-[var(--adm-active)] px-2.5 py-0.5 text-xs hover:bg-[var(--adm-active)]"
                        onClick={() => setSuggestedNameEn(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}
                <CompactStat label="Категория" value={selectedItem.category.join(', ') || '—'} />
                <CompactStat label="Часы работы" value={selectedDetail?.workingHours || '—'} />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Ссылки">
              {selectedDetail?.website ? (
                <a href={selectedDetail.website} target="_blank" rel="noreferrer" className="text-sm text-[var(--adm-on-accent)] underline underline-offset-4">
                  {selectedDetail.website}
                </a>
              ) : (
                <div className="text-sm text-[var(--adm-text-3)]">Внешний сайт не указан.</div>
              )}
            </CollapsiblePanel>
          </section>
        )}
      </div>

      {selectedItem ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 md:px-6">
          {flash ? (
            <div
              role="status"
              className={cn(
                'mx-auto mb-2 flex w-full max-w-7xl items-center gap-3 rounded-xl border px-4 py-2.5 text-sm',
                flash.tone === 'err'
                  ? 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]'
                  : 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]',
              )}
            >
              <span className="flex-1">{flash.text}</span>
              <button type="button" onClick={() => setFlash(null)} aria-label="Скрыть" className="opacity-70 hover:opacity-100">
                <X className="size-4" />
              </button>
            </div>
          ) : null}
          <div className="mx-auto w-full max-w-7xl rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-3 shadow-[0_-18px_50px_rgba(3,8,20,0.42)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 text-sm text-[var(--adm-text-2)]">
                <div className="truncate text-[var(--adm-text)]">{selectedItem.nameRu || selectedItem.nameEn || 'Запись не выбрана'}</div>
                {!ready ? (
                  <div className="truncate text-xs text-[var(--adm-text-3)]">Экран ещё загружается — кнопки заработают через секунду</div>
                ) : isDetailLoading ? (
                  <div className="truncate text-xs text-[var(--adm-text-3)]">Загружаю тексты записи…</div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Три кнопки были почти одного веса, а подписи двух из них
                    в дневной теме не читались вовсе: «Утвердить» — почти белым
                    по светлому тинту (1,16:1), «Удалить» — rose-100 по rose-500/10
                    (1,01:1, то есть текста нет). Оба набора классов писались
                    под ночную тему и в дневной никогда не открывались.
                    Теперь: главное действие золотое и заметное, вспомогательное
                    обычное, разрушительное — по токенам опасности и последним
                    в ряду, с отступом. */}
                <Button
                  type="button"
                  variant="outline"
                  className={cn(adminSecondaryButtonClass, 'min-h-11')}
                  onClick={() => handleGenerate()}
                  disabled={!ready || isDetailLoading || isGenerating || isPublishing}
                >
                  <Sparkles className="size-4" />
                  {isGenerating && generationMode === 'rewrite' ? 'Пишу черновик…' : 'Переписать текст'}
                </Button>
                <Button
                  type="button"
                  className={cn(adminPrimaryButtonClass, 'min-h-11 font-semibold')}
                  onClick={handleApproveAndPublish}
                  disabled={!ready || isDetailLoading || isPublishing || isGenerating || !getWorkingDraftRu(selectedItem).trim()}
                >
                  <CloudUpload className="size-4" />
                  {isPublishing ? 'Публикую…' : 'Утвердить и опубликовать'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(adminDangerButtonClass, 'min-h-11 ml-auto lg:ml-3')}
                  onClick={handleDeletePoi}
                  disabled={!ready || isDeletingPoi || isPublishing || isGenerating}
                >
                  <Trash2 className="size-4" />
                  {isDeletingPoi ? 'Удаляю…' : 'Удалить POI'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--adm-text-3)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-accent-border)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--adm-text-3)]">{label}</div>
      <div className="mt-1 truncate text-sm text-[var(--adm-text)]">
        {tone ? <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}>{value}</span> : value}
      </div>
    </div>
  )
}

function CollapsiblePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--adm-text)]">{title}</summary>
      <div className="border-t border-[var(--adm-border)] px-4 py-4">{children}</div>
    </details>
  )
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2 text-sm">
      <div className="text-[var(--adm-text-3)]">{label}</div>
      <div className="truncate text-[var(--adm-text)]">{value}</div>
    </div>
  )
}

function TitleEditor({
  recordId,
  nameRu,
  nameEn,
  isSaving,
  isReady,
  pendingRef,
  onSave,
}: {
  recordId: string
  nameRu: string
  nameEn: string
  isSaving: boolean
  isReady: boolean
  pendingRef: React.MutableRefObject<PendingTitle>
  onSave: (nameRu: string, nameEn: string) => void
}) {
  const [draftNameRu, setDraftNameRu] = useState(nameRu)
  const [draftNameEn, setDraftNameEn] = useState(nameEn)

  useEffect(() => {
    setDraftNameRu(nameRu)
    setDraftNameEn(nameEn)
  }, [recordId, nameRu, nameEn])

  const hasAnyTitle = Boolean(draftNameRu.trim() || draftNameEn.trim())
  const isDirty = draftNameRu !== nameRu || draftNameEn !== nameEn
  const canSave = isReady && hasAnyTitle && isDirty && !isSaving
  /* Стирание существующего названия само по уходу из поля не сохраняется:
     промах по клавише не должен обнулять запись, на которую ссылаются
     карточки маршрутов. Такое сохраняется только явным нажатием. */
  const wipesExistingName =
    (!draftNameRu.trim() && Boolean(nameRu.trim())) || (!draftNameEn.trim() && Boolean(nameEn.trim()))

  /* Набранное видно снаружи: нижняя панель дописывает его перед публикацией
     и перед переписыванием текста. Раньше правка жила только внутри этого
     блока и пропадала от любого соседнего действия. */
  useEffect(() => {
    pendingRef.current =
      isDirty && hasAnyTitle && !wipesExistingName ? { recordId, nameRu: draftNameRu, nameEn: draftNameEn } : null
    return () => {
      pendingRef.current = null
    }
  }, [pendingRef, recordId, draftNameRu, draftNameEn, isDirty, hasAnyTitle, wipesExistingName])

  // Закрытие вкладки с несохранённым названием — с предупреждением браузера.
  useUnsavedGuard(isDirty && hasAnyTitle)

  function commit(source: 'blur' | 'button') {
    if (!canSave) return
    if (source === 'blur' && wipesExistingName) return
    onSave(draftNameRu, draftNameEn)
  }

  /* Постоянной кнопки «Сохранить» здесь больше нет.
     Название пишется при уходе из поля — тем же правилом, что и черновик
     описания двумя сантиметрами ниже. Две соседние формы с разными
     правилами и были причиной потери: одна сохранялась сама, у другой была
     кнопка, и человек считал, что сохраняет всё нижняя панель. Она не
     сохраняет — она публикует на сайт, это другое действие.
     Кнопка осталась ровно на один случай: стереть название начисто.
     Такое молча не проходит — на записи держатся карточки маршрутов. */
  const status = isSaving ? 'saving' : wipesExistingName && isDirty ? 'wipe' : isDirty && hasAnyTitle ? 'dirty' : 'clean'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">POI title</div>
          <h2 className="mt-1 text-base font-semibold text-[var(--adm-text)]">Правка названия POI</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--adm-text-2)]">
            {isReady
              ? 'Сохраняется при уходе из поля — как черновик описания ниже. Название пишется прямо в Airtable и сразу попадает в карточки маршрутов, подборки и поиск по панели.'
              : 'Экран ещё загружается. Подождите секунду — иначе набранное потеряется.'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status === 'saving' ? (
            <span className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-xs font-medium text-[var(--adm-text-2)]">
              Сохраняю…
            </span>
          ) : null}
          {status === 'dirty' ? (
            <span className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] px-3 text-xs font-medium text-[var(--adm-warn-text)]">
              Не сохранено
            </span>
          ) : null}
          {status === 'wipe' ? (
            <Button
              type="button"
              variant="outline"
              className={cn(adminDangerButtonClass, 'min-h-9 shrink-0 whitespace-nowrap')}
              onClick={() => commit('button')}
              disabled={!isReady || isSaving}
            >
              <Trash2 className="size-4" />
              Стереть название
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InputField
          label="Название RU"
          value={draftNameRu}
          onChange={setDraftNameRu}
          onCommit={() => commit('blur')}
          readOnly={!isReady}
          placeholder="Например, Центр всемирного наследия горы Фудзи в префектуре Яманаси"
        />
        <InputField
          label="Название EN"
          value={draftNameEn}
          onChange={setDraftNameEn}
          onCommit={() => commit('blur')}
          readOnly={!isReady}
          placeholder="Английское название — не обязательно"
        />
      </div>
    </div>
  )
}

function InputField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  /** Уход из поля или Enter — там же, где сохраняется черновик описания. */
  onCommit?: () => void
  placeholder: string
  readOnly?: boolean
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--adm-text-3)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommit?.()
          }
        }}
        readOnly={readOnly}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-xl border border-[var(--adm-border)] bg-[var(--adm-inset)] px-4 text-sm text-[var(--adm-text)] outline-none transition placeholder:text-[var(--adm-text-3)] focus:border-[var(--adm-accent-border)]"
      />
    </label>
  )
}

interface TextPanelProps {
  title: string
  description: string
  value: string
  secondaryValue?: string
  readOnly?: boolean
  tone?: 'reference' | 'editable' | 'approved'
  badge?: string
  helper?: string
  primaryBudget?: TextBudgetFieldConfig
  secondaryBudget?: TextBudgetFieldConfig
  onChange?: (value: string) => void
  onSecondaryChange?: (value: string) => void
  headerAction?: React.ReactNode
}

function TextPanel({
  title,
  description,
  value,
  secondaryValue = '',
  readOnly = false,
  tone = 'editable',
  badge,
  helper,
  primaryBudget,
  secondaryBudget,
  onChange,
  onSecondaryChange,
  headerAction,
}: TextPanelProps) {
  const panelToneStyles: Record<NonNullable<TextPanelProps['tone']>, { shell: string; badge: string; field: string }> = {
    reference: {
      shell: 'border-[var(--adm-border)] bg-[var(--adm-hover)]',
      badge: 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)]',
      field: 'border-[var(--adm-border)] bg-[var(--adm-inset)] read-only:bg-[var(--adm-inset)]',
    },
    editable: {
      shell: 'border-[var(--adm-border)] bg-[var(--adm-hover)]',
      badge: 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]',
      field: 'border-[var(--adm-border)] bg-[var(--adm-inset)] focus:border-[var(--adm-accent-border)] read-only:bg-[var(--adm-inset)]',
    },
    approved: {
      shell: 'border-[var(--adm-border)] bg-[var(--adm-hover)]',
      badge: 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]',
      field: 'border-[var(--adm-border)] bg-[var(--adm-inset)] focus:border-[var(--adm-ok-border)] read-only:bg-[var(--adm-inset)]',
    },
  }

  const toneStyles = panelToneStyles[tone]

  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-2xl border', toneStyles.shell)}>
      <div className="flex min-h-16 items-start justify-between gap-3 border-b border-[var(--adm-border)] px-5 py-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--adm-text)]">{title}</h3>
          <p className="text-xs leading-5 text-[var(--adm-text-3)]">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          {badge ? <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]', toneStyles.badge)}>{badge}</span> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-5">
        <TextAreaField
          label="RU"
          value={value}
          readOnly={readOnly}
          emptyLabel={readOnly ? 'Исходного текста RU нет' : 'Русский текст — сюда'}
          fieldClassName={toneStyles.field}
          budget={primaryBudget}
          onChange={onChange}
        />

        <TextAreaField
          label="EN"
          value={secondaryValue}
          readOnly={readOnly}
          emptyLabel={readOnly ? 'Исходного текста EN нет' : 'Английский текст — сюда'}
          fieldClassName={toneStyles.field}
          budget={secondaryBudget}
          onChange={onSecondaryChange}
        />
      </div>

      <div className="min-h-12 border-t border-[var(--adm-border)] px-5 py-3 text-xs leading-5 text-[var(--adm-text-3)]">{helper ?? (readOnly ? 'Только для чтения.' : 'Здесь можно править.')}</div>
    </div>
  )
}

function TextAreaField({
  label,
  value,
  readOnly,
  emptyLabel,
  fieldClassName,
  budget,
  onChange,
}: {
  label: string
  value: string
  readOnly: boolean
  emptyLabel: string
  fieldClassName: string
  budget?: TextBudgetFieldConfig
  onChange?: (value: string) => void
}) {
  // Local state keeps typing smooth — parent is only notified on blur to avoid
  // re-render-on-every-keystroke cursor-jump issues.
  const [localValue, setLocalValue] = useState(value)

  // Sync external updates (e.g. after generation) into local state.
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const hasValue = localValue.trim().length > 0
  const budgetAnalysis = budget ? analyzeTextBudget(localValue, budget.profile) : null

  return (
    <label className="block space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--adm-text-3)]">{label}</span>

        {budgetAnalysis ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-right">
            <span className="text-[11px] text-[var(--adm-text-3)]">{hasValue ? `${budgetAnalysis.chars} зн.` : 'пусто'}</span>
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', textBudgetStateStyles[budgetAnalysis.status])}>
              {textBudgetStateLabels[budgetAnalysis.status]}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-[var(--adm-text-3)]">{hasValue ? `${localValue.trim().length} зн.` : 'пусто'}</span>
        )}
      </div>

      {budgetAnalysis ? (
        <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2 text-[11px] leading-5 text-[var(--adm-text-3)]">
          <div>{formatTextBudgetGuidance(budgetAnalysis.profile)}</div>
          <div className="text-[var(--adm-text-3)]">Ориентир, а не запрет: длиннее — карточка обрежет.</div>
        </div>
      ) : null}

      <textarea
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => {
          if (localValue !== value) onChange?.(localValue)
        }}
        readOnly={readOnly}
        placeholder={emptyLabel}
        className={cn(
          'min-h-[220px] w-full rounded-xl border px-4 py-3 text-sm leading-6 text-[var(--adm-text)] outline-none placeholder:text-[var(--adm-text-3)]',
          fieldClassName,
        )}
      />
    </label>
  )
}
