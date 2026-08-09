'use client'

/**
 * Сторож несохранённых правок — общий для всех экранов админки.
 *
 * До этого ни один экран не предупреждал об уходе: правка текста маршрута,
 * описания точки или FAQ пропадала молча при переключении записи, закрытии
 * вкладки и перезагрузке страницы (инцидент разбора 2026-08-06).
 *
 * Два примитива:
 *   useUnsavedGuard(dirty) — браузерное предупреждение при уходе со страницы;
 *   confirmDiscard(what)   — подтверждение внутри страницы, когда пользователь
 *                            переключается на другую запись.
 *
 * Диалог намеренно нативный: задача волны — перестать терять данные,
 * а не сделать красиво. Свой диалог придёт вместе с редизайном.
 */

import { useEffect, useRef } from 'react'

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Текст задаёт браузер; вернуть свой нельзя со времён Chrome 51.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}

/** Ref с актуальным признаком правок — для обработчиков с пустыми зависимостями. */
export function useDirtyRef(dirty: boolean) {
  const ref = useRef(dirty)
  useEffect(() => {
    ref.current = dirty
  }, [dirty])
  return ref
}

export function confirmDiscard(what: string): boolean {
  return window.confirm(`${what}\n\nПравки будут потеряны. Продолжить?`)
}
