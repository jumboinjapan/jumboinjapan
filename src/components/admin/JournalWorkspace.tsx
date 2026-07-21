'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AdminWorkspaceNav } from './AdminWorkspaceNav'

/**
 * /admin/journal — приёмная Журнала.
 *
 * Владелец загружает MD-заметки (файлом или текстом) → создаётся запись в
 * Airtable Journal со Status=Draft и Agent Status=Queued. Очередь разбирает
 * Cowork-агент (скилл копирайтера): исследует тему, обогащает фактами,
 * пишет Body от первого лица → ставит Ready for Review. Владелец вычитывает
 * в Airtable и переводит Status в Published.
 */

interface JournalRecordSummary {
  id: string
  title: string
  slug: string
  status: string
  agentStatus: string
  publishedDate: string
  hasSourceNotes: boolean
  hasBody: boolean
}

const AGENT_STATUS_LABELS: Record<string, string> = {
  Queued: 'В очереди у агента',
  'In Progress': 'Агент работает',
  'Ready for Review': 'Готово к вычитке',
  Done: 'Завершено',
}

export function JournalWorkspace() {
  const [records, setRecords] = useState<JournalRecordSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/journal')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { records: JournalRecordSummary[] }
      setRecords(data.records)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleFile(file: File) {
    const text = await file.text()
    setNotes(text)
    if (!title) setTitle(file.name.replace(/\.(md|txt)$/i, ''))
  }

  async function submit() {
    if (!notes.trim()) return
    setSubmitting(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || undefined, sourceNotes: notes }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMessage('Черновик создан и поставлен в очередь агенту.')
      setTitle('')
      setNotes('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      void load()
    } catch (e) {
      setMessage(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <AdminWorkspaceNav currentPath="/admin/journal" />
      <h1 className="mt-6 text-2xl font-semibold text-[var(--adm-text)]">Журнал</h1>
      <p className="mt-2 max-w-3xl text-sm text-[var(--adm-text-2)]">
        Загрузите заметки (MD-файл или текст) — агент исследует тему, обогатит фактами и напишет
        статью вашим голосом. Готовые тексты появляются в Airtable со статусом «Ready for Review»;
        после вычитки переведите Status в Published и обновите кэш сайта.
      </p>

      <section className="mt-6 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--adm-text-3)]">
          Новые заметки для агента
        </p>
        <div className="mt-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Рабочее название (не обязательно — возьмётся из # заголовка)"
            className="w-full rounded-lg border border-[var(--adm-border)] bg-transparent px-3 py-2 text-sm text-[var(--adm-text)]"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={10}
            placeholder={
              'Вставьте MD-заметки или сырой текст: что видели, что запомнилось, факты, имена, даты…\n\nЧем конкретнее сырьё — тем точнее статья.'
            }
            className="w-full rounded-lg border border-[var(--adm-border)] bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-[var(--adm-text)]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="text-sm text-[var(--adm-text-2)] file:mr-3 file:rounded-lg file:border file:border-[var(--adm-border)] file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[var(--adm-text)]"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !notes.trim()}
              className="inline-flex h-9 items-center rounded-lg bg-[var(--adm-accent)] px-4 text-sm font-medium text-[var(--adm-on-accent)] transition hover:bg-[var(--adm-accent-hover)] disabled:opacity-50"
            >
              {submitting ? 'Отправка…' : 'В очередь агенту'}
            </button>
            {message && <span className="text-sm text-[var(--adm-text-2)]">{message}</span>}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--adm-text-3)]">
            Статьи и очередь
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm text-[var(--adm-accent-text)] hover:underline"
          >
            Обновить
          </button>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-[var(--adm-text-3)]">Загрузка…</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-400">{error}</p>
        ) : records.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--adm-text-3)]">
            Записей пока нет — загрузите первые заметки выше
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--adm-border)]">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--adm-text)]">
                    {r.title || 'Без названия'}
                  </p>
                  <p className="text-[12px] text-[var(--adm-text-3)]">
                    {r.status}
                    {r.agentStatus ? ` · ${AGENT_STATUS_LABELS[r.agentStatus] ?? r.agentStatus}` : ''}
                    {r.slug ? ` · /journal/${r.slug}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] text-[var(--adm-text-3)]">
                  {r.hasBody ? 'текст есть' : r.hasSourceNotes ? 'только заметки' : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
