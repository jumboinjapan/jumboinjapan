'use client'

/**
 * Инвойсы Global Strategy → INARI TRAVEL (2026-08-07).
 *
 * Владелец вставляет список расходов в том виде, в каком ведёт его по
 * маршруту, ставит число рабочих дней и подкладывает сканы чеков — экран
 * собирает готовый PDF на бланке компании.
 *
 * Три вещи, которые стоит знать при правках:
 *
 * 1. Позиции переводятся на японский по словарю (src/lib/invoice/dictionary.ts)
 *    и получают суффикс 立替金 — всё, кроме работы гида. Непереведённое НЕ
 *    выдумывается: строка остаётся русской и подсвечивается.
 * 2. Исправленные вручную формулировки запоминаются в localStorage этого
 *    браузера, а не в общем словаре: на Vercel файловая система только для
 *    чтения, а заводить ради этого таблицу в Airtable — решение владельца.
 * 3. Готовый PDF нигде не хранится, он просто скачивается.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import {
  EmptyNote,
  Panel,
  SectionTitle,
  StatusChip,
  adminInputClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
} from '@/components/admin/ui'
import { INVOICE_CONFIG } from '@/lib/invoice/config'
import type { InvoiceData, InvoiceRow } from '@/lib/invoice/types'
import { cn } from '@/lib/utils'

const OVERRIDES_KEY = 'jij-invoice-overrides'
const GUIDE_SOURCE = INVOICE_CONFIG.guide.sourceMarker

const PLACEHOLDER = `+       1,200 налог Westin
+       1,710 посещение zuihoden
+         900 проход на мост фукурадзима
-------------
+       3,810`

function yen(value: number): string {
  return `¥${(value || 0).toLocaleString('en-US')}`
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

interface FormState {
  text: string
  guest: string
  dates: string
  days: string
  rate: string
  date: string
}

export function InvoiceWorkspace() {
  const [form, setForm] = useState<FormState>({
    text: '',
    guest: '',
    dates: '',
    days: '1',
    rate: String(INVOICE_CONFIG.guide.dayRate),
    date: '',
  })
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [receipts, setReceipts] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [building, setBuilding] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [edited, setEdited] = useState<Record<string, boolean>>({})

  const fileInput = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  // Дата инвойса и запомненные переводы читаются после монтирования:
  // и то и другое зависит от браузера, на сервере их знать неоткуда.
  useEffect(() => {
    setForm((prev) => (prev.date ? prev : { ...prev, date: todayIso() }))
    try {
      const stored = window.localStorage.getItem(OVERRIDES_KEY)
      if (stored) setOverrides(JSON.parse(stored) as Record<string, string>)
    } catch {
      // повреждённый localStorage не должен ронять экран
    }
  }, [])

  function patch(update: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...update }))
  }

  // ── Разбор ────────────────────────────────────────────────────────────────
  const overridesRef = useRef(overrides)
  useEffect(() => {
    overridesRef.current = overrides
  }, [overrides])

  useEffect(() => {
    if (!form.text.trim() && !form.guest.trim()) {
      setInvoice(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch('/api/admin/invoices/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: form.text,
          guest: form.guest,
          dates: form.dates,
          days: Number(form.days) || 0,
          rate: Number(form.rate) || undefined,
          date: form.date || undefined,
        }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { ok?: boolean; invoice?: InvoiceData; error?: string }) => {
          if (!data.ok || !data.invoice) throw new Error(data.error || 'Не удалось разобрать список')
          const saved = overridesRef.current
          const rows = data.invoice.rows.map((row) =>
            saved[row.source] ? { ...row, desc: saved[row.source] } : row,
          )
          setInvoice({ ...data.invoice, rows })
          setEdited({})
        })
        .catch((error: Error) => {
          if (error.name !== 'AbortError') setToast({ type: 'err', msg: error.message })
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [form.text, form.guest, form.dates, form.days, form.rate, form.date])

  // ── Предпросмотр ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!invoice || !invoice.rows.length) return
    const timer = setTimeout(() => {
      setPreviewing(true)
      fetch('/api/admin/invoices/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoice),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Не удалось отрисовать предпросмотр')
          return res.blob()
        })
        .then((blob) => {
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
          const url = URL.createObjectURL(blob)
          previewUrlRef.current = url
          setPreviewUrl(url)
        })
        .catch((error: Error) => setToast({ type: 'err', msg: error.message }))
        .finally(() => setPreviewing(false))
    }, 500)
    return () => clearTimeout(timer)
  }, [invoice])

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  // ── Правки таблицы ────────────────────────────────────────────────────────
  const updateRow = useCallback((index: number, update: Partial<InvoiceRow>) => {
    setInvoice((prev) => {
      if (!prev) return prev
      const rows = prev.rows.map((row, i) => {
        if (i !== index) return row
        const next = { ...row, ...update }
        next.total = (Number(next.qty) || 0) * (Number(next.unitPrice) || 0)
        return next
      })
      const advancesTotal = rows
        .filter((row) => row.source !== GUIDE_SOURCE)
        .reduce((sum, row) => sum + row.total, 0)
      return { ...prev, rows, advancesTotal, grandTotal: rows.reduce((sum, row) => sum + row.total, 0) }
    })
  }, [])

  function rememberTranslation(row: InvoiceRow) {
    if (!row.source || row.source === GUIDE_SOURCE) return
    const next = { ...overrides, [row.source]: row.desc }
    setOverrides(next)
    try {
      window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next))
      setToast({ type: 'ok', msg: `Запомнил: «${row.source}» → ${row.desc}` })
    } catch {
      setToast({ type: 'err', msg: 'Браузер не дал сохранить перевод' })
    }
  }

  // ── Чеки ──────────────────────────────────────────────────────────────────
  function addFiles(list: FileList | null) {
    if (!list) return
    setReceipts((prev) => {
      const next = [...prev]
      for (const file of Array.from(list)) {
        if (!next.some((existing) => existing.name === file.name && existing.size === file.size)) next.push(file)
      }
      return next
    })
  }

  // ── Сборка ────────────────────────────────────────────────────────────────
  async function build() {
    if (!invoice) return
    setBuilding(true)
    setToast(null)
    try {
      const body = new FormData()
      body.append('invoice', JSON.stringify(invoice))
      receipts.forEach((file) => body.append('receipts', file))

      const res = await fetch('/api/admin/invoices/pdf', { method: 'POST', body })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || 'Не удалось собрать PDF')
      }
      const pages = Number(res.headers.get('X-Receipt-Pages') ?? '0')
      const warned = decodeURIComponent(res.headers.get('X-Invoice-Warnings') ?? '')
      const blob = await res.blob()

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${invoice.number.replace(INVOICE_CONFIG.invoice.numberPrefix, INVOICE_CONFIG.invoice.filePrefix)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setToast({
        type: warned ? 'err' : 'ok',
        msg: warned || `${invoice.number} — ${yen(invoice.grandTotal)}${pages ? `, чеков подшито страниц: ${pages}` : ''}`,
      })
    } catch (error) {
      setToast({ type: 'err', msg: error instanceof Error ? error.message : 'Не удалось собрать PDF' })
    } finally {
      setBuilding(false)
    }
  }

  const unknownSources = useMemo(() => {
    const set = new Set<string>()
    for (const warning of invoice?.warnings ?? []) {
      if (!warning.includes('НЕТ В СЛОВАРЕ')) continue
      const from = warning.indexOf('«')
      const to = warning.indexOf('»')
      if (from >= 0 && to > from) set.add(warning.slice(from + 1, to))
    }
    return set
  }, [invoice])

  return (
    <AdminShell
      currentPath="/admin/invoices"
      title="Инвойсы"
      subtitle="Список расходов и дни работы → готовый PDF на бланке Global Strategy со сшитыми чеками"
      actions={
        <button
          type="button"
          onClick={build}
          disabled={!invoice?.rows.length || building}
          className={adminPrimaryButtonClass}
        >
          {building ? 'Собираю…' : 'Скачать PDF'}
        </button>
      }
    >
      {toast && (
        <div
          className={cn(
            'mt-4 rounded-lg border px-4 py-2.5 text-sm',
            toast.type === 'ok'
              ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
              : 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)] xl:items-start">
        <div className="flex flex-col gap-5">
          <Panel title="Расходы по маршруту">
            <textarea
              value={form.text}
              onChange={(event) => patch({ text: event.target.value })}
              spellCheck={false}
              rows={9}
              placeholder={PLACEHOLDER}
              className={cn(adminInputClass, 'resize-y whitespace-pre font-mono text-[13px] leading-relaxed')}
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--adm-text-3)]">
              Вставляйте как есть — плюсы, запятые в числах, линейка и итог внизу. Итог сверяется с суммой позиций.
              Количество: <code>x3</code> — три штуки на эту сумму, <code>@3</code> — три штуки по этой цене.
            </p>
          </Panel>

          <Panel title="Работа гида">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs text-[var(--adm-text-3)]">Группа или гость</span>
                <input
                  type="text"
                  value={form.guest}
                  onChange={(event) => patch({ guest: event.target.value })}
                  placeholder="Tkachenko"
                  className={adminInputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-[var(--adm-text-3)]">Даты обслуживания</span>
                <input
                  type="text"
                  value={form.dates}
                  onChange={(event) => patch({ dates: event.target.value })}
                  placeholder="18-20/07/2026"
                  className={adminInputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-[var(--adm-text-3)]">Рабочих дней</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.days}
                  onChange={(event) => patch({ days: event.target.value })}
                  className={adminInputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-[var(--adm-text-3)]">Цена за день, ¥</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={form.rate}
                  onChange={(event) => patch({ rate: event.target.value })}
                  className={adminInputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-[var(--adm-text-3)]">Дата инвойса</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => patch({ date: event.target.value })}
                  className={adminInputClass}
                />
              </label>
            </div>
          </Panel>

          <Panel
            title="Чеки"
            actions={
              <button type="button" onClick={() => fileInput.current?.click()} className={adminSecondaryButtonClass}>
                Добавить
              </button>
            }
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
              className="hidden"
            />
            {receipts.length === 0 ? (
              <EmptyNote>
                Фото и PDF подошьются страницами после инвойса. С телефона кнопка «Добавить» открывает камеру.
              </EmptyNote>
            ) : (
              <div className="flex flex-wrap gap-2">
                {receipts.map((file, index) => (
                  <span
                    key={`${file.name}-${file.size}`}
                    className="inline-flex max-w-[240px] items-center gap-2 rounded-full border border-[var(--adm-border)] bg-[var(--adm-inset)] py-1 pl-3 pr-1.5 text-xs text-[var(--adm-text-2)]"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setReceipts((prev) => prev.filter((_, i) => i !== index))}
                      className="text-[var(--adm-text-3)] transition hover:text-[var(--adm-danger-text)]"
                      aria-label={`Убрать ${file.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Позиции инвойса"
            actions={invoice ? <StatusChip tone="neutral">{invoice.number}</StatusChip> : null}
          >
            {!invoice?.rows.length ? (
              <EmptyNote>Вставьте расходы — позиции появятся здесь, их можно будет поправить.</EmptyNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.06em] text-[var(--adm-text-3)]">
                      <th className="pb-2 font-medium">Описание</th>
                      <th className="w-16 pb-2 text-right font-medium">Кол.</th>
                      <th className="w-28 pb-2 text-right font-medium">Цена, ¥</th>
                      <th className="w-28 pb-2 text-right font-medium">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.rows.map((row, index) => {
                      const isGuide = row.source === GUIDE_SOURCE
                      const unknown = unknownSources.has(row.source)
                      return (
                        <tr key={`${row.source}-${index}`} className="border-t border-[var(--adm-border)] align-middle">
                          <td className="py-1 pr-2">
                            <input
                              type="text"
                              value={row.desc}
                              spellCheck={false}
                              onChange={(event) => {
                                updateRow(index, { desc: event.target.value })
                                setEdited((prev) => ({ ...prev, [index]: true }))
                              }}
                              className={cn(
                                adminInputClass,
                                'border-transparent bg-transparent px-2 py-1.5',
                                isGuide && 'text-[var(--adm-accent-text)]',
                                unknown && 'text-[var(--adm-danger-text)]',
                              )}
                            />
                            {edited[index] && !isGuide && (
                              <button
                                type="button"
                                onClick={() => rememberTranslation(row)}
                                className="ml-2 text-xs text-[var(--adm-text-3)] underline underline-offset-4 transition hover:text-[var(--adm-accent-text)]"
                              >
                                запомнить перевод
                              </button>
                            )}
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="number"
                              min={0}
                              value={row.qty}
                              onChange={(event) => updateRow(index, { qty: Number(event.target.value) })}
                              className={cn(adminInputClass, 'border-transparent bg-transparent px-2 py-1.5 text-right')}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="number"
                              min={0}
                              value={row.unitPrice}
                              onChange={(event) => updateRow(index, { unitPrice: Number(event.target.value) })}
                              className={cn(adminInputClass, 'border-transparent bg-transparent px-2 py-1.5 text-right')}
                            />
                          </td>
                          <td className="py-1 pr-1 text-right tabular-nums text-[var(--adm-text-2)]">{yen(row.total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--adm-border-strong)]">
                      <td colSpan={3} className="pt-3 text-xs uppercase tracking-[0.12em] text-[var(--adm-text-3)]">
                        Итого к оплате
                      </td>
                      <td className="pt-3 text-right text-lg font-semibold tabular-nums text-[var(--adm-text)]">
                        {yen(invoice.grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {invoice?.warnings.length ? (
              <div className="mt-4 border-l-2 border-[var(--adm-danger-border)] pl-3">
                {invoice.warnings.map((warning) => (
                  <p key={warning} className="mb-1 text-xs leading-relaxed text-[var(--adm-danger-text)]">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-4">
          <SectionTitle className="flex items-center gap-2">
            Предпросмотр
            {previewing && <span className="text-[10px] normal-case tracking-normal">обновляю…</span>}
          </SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-[var(--adm-border)] bg-white">
            {previewUrl ? (
              <>
                <iframe
                  src={`${previewUrl}#toolbar=0&view=FitH`}
                  title="Предпросмотр инвойса"
                  className="hidden h-[70vh] w-full md:block"
                />
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-4 py-3 text-center text-sm text-[var(--adm-accent-text)] md:hidden"
                >
                  Открыть предпросмотр
                </a>
              </>
            ) : (
              <p className="px-6 py-16 text-center text-sm text-neutral-500">
                Документ появится здесь, как только вы вставите расходы
              </p>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
