'use client'

/**
 * Редактор реквизитов документа (2026-07-16). Пока — стандартные оговорки
 * печатной программы тура: глобальные, одинаковые для всех туров. Владелец
 * правит текст, включает/выключает и меняет порядок без разработчика.
 *
 * Хранение — таблица Document Settings (Airtable), API /api/admin/document-settings.
 * Бренд-реквизиты (email, имя гида, домен) сюда сознательно не вынесены —
 * они одинаковы и меняются раз в год, живут в коде (src/lib/brand.ts).
 */

import { useEffect, useState } from 'react'

import { AdminShell } from '@/components/admin/AdminShell'
import { adminInputClass, adminPanelClass, adminPrimaryButtonClass, EmptyNote, SectionTitle } from '@/components/admin/ui'
import { cn } from '@/lib/utils'

interface DisclaimerSetting {
  id: string
  key: string
  title: string
  text: string
  enabled: boolean
  order: number
}

export function DocumentSettingsWorkspace() {
  const [items, setItems] = useState<DisclaimerSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/document-settings')
      .then((r) => r.json())
      .then((data: { disclaimers?: DisclaimerSetting[] }) => {
        if (Array.isArray(data.disclaimers)) setItems(data.disclaimers)
      })
      .catch(() => setToast({ type: 'err', msg: 'Не удалось загрузить настройки' }))
      .finally(() => setLoading(false))
  }, [])

  function update(id: string, patch: Partial<DisclaimerSetting>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function save() {
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/document-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disclaimers: items.map((item) => ({
            id: item.id,
            title: item.title,
            text: item.text,
            enabled: item.enabled,
            order: item.order,
          })),
        }),
      })
      const data = (await res.json()) as { ok?: boolean; disclaimers?: DisclaimerSetting[]; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Ошибка сохранения')
      if (Array.isArray(data.disclaimers)) setItems(data.disclaimers)
      setToast({ type: 'ok', msg: 'Сохранено. Оговорки обновятся в новых документах.' })
    } catch (error) {
      setToast({ type: 'err', msg: error instanceof Error ? error.message : 'Ошибка сохранения' })
    } finally {
      setSaving(false)
    }
  }

  const enabledCount = items.filter((item) => item.enabled).length

  return (
    <AdminShell
      currentPath="/admin/document-settings"
      title="Реквизиты документа"
      subtitle="Оговорки печатной программы — единые для всех туров"
      actions={
        <button type="button" onClick={save} disabled={saving || loading} className={adminPrimaryButtonClass}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      }
    >
      {toast && (
        <div
          className={cn(
            'mt-4 rounded-lg border px-4 py-2.5 text-sm',
            toast.type === 'ok'
              ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]'
              : 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="mt-6">
        <SectionTitle>Оговорки программы ({enabledCount} из {items.length} включены)</SectionTitle>
        <p className="mb-4 max-w-2xl text-sm text-[var(--adm-text-3)]">
          Включённые оговорки печатаются в конце программы (и в PDF, и в превью) в указанном порядке. Тексты
          глобальные — без привязки к конкретному туру.
        </p>

        {loading ? (
          <EmptyNote>Загрузка…</EmptyNote>
        ) : items.length === 0 ? (
          <EmptyNote>Оговорок пока нет — добавьте строку в таблицу Document Settings в Airtable</EmptyNote>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.id} className={cn(adminPanelClass, 'p-4')}>
                <div className="flex items-start justify-between gap-4">
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) => update(item.id, { title: e.target.value })}
                    placeholder="Название (о чём оговорка)"
                    className={cn(adminInputClass, 'max-w-md font-medium')}
                  />
                  <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--adm-text-2)]">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => update(item.id, { enabled: e.target.checked })}
                      className="size-4 accent-[var(--adm-accent)]"
                    />
                    Печатать
                  </label>
                </div>

                <textarea
                  value={item.text}
                  onChange={(e) => update(item.id, { text: e.target.value })}
                  rows={3}
                  placeholder="Текст оговорки"
                  className={cn(adminInputClass, 'mt-3 resize-y')}
                />

                <div className="mt-3 flex items-center gap-2">
                  <label className="text-xs text-[var(--adm-text-3)]">Порядок</label>
                  <input
                    type="number"
                    value={item.order}
                    onChange={(e) => update(item.id, { order: Number(e.target.value) })}
                    className={cn(adminInputClass, 'w-20')}
                  />
                  <span className="text-xs text-[var(--adm-text-3)]">· ключ: {item.key}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
