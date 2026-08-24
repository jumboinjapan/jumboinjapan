'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Кнопка Google Preferred Sources.
 *
 * Что она делает: посетитель, нажавший её, добавляет jumboinjapan.com в свои
 * предпочитаемые источники Google. После этого Google чаще показывает ИМЕННО
 * ЕМУ страницы сайта в Top Stories и помечает их значком «предпочитаемый
 * источник» в AI Overviews и AI Mode. Персонализация одного пользователя —
 * не общий рост позиций (документация Google, /search/docs/appearance/preferred-sources).
 *
 * Три вещи, ради которых здесь код, а не две строки из документации:
 *
 * 1. LCP. SDK весит ~250 КБ несжатыми. Он не грузится ни при первой отрисовке,
 *    ни даже сразу после неё: наблюдатель включается только после события
 *    `load`, и запрос уходит, когда блок подходит к экрану на 400 px. Тот, кто
 *    до подвала не доскроллил, скрипт не качает вовсе.
 *
 * 2. CLS. SDK при инициализации проставляет контейнеру инлайновый
 *    `min-height: 60px` и вкладывает в него iframe (проверено на publisher.js
 *    v1.0.160). Те же 60 px зарезервированы классом с первой отрисовки —
 *    высота не меняется, сдвига нет.
 *
 *    Ширина: русская подпись на бейдже — «Добавить в список предпочтительных
 *    источников». Замер: при 246 px она встаёт в три строки и обрезается
 *    рамкой iframe, при 280 px помещается в две, при 400 px — в одну.
 *    Отсюда max-w-md: бейджу нужно место, и колонка подвала его не даёт.
 *
 * 3. Блокировщики. Если скрипт не доехал, на месте кнопки не остаётся дыры:
 *    в том же боксе появляется ссылка на страницу настроек Google — это
 *    второй официальный способ из документации (deeplink). Функция сохраняется.
 *
 * Клиентская навигация: `init()` у SDK разбирает только контейнеры без
 * `data-initialized`, поэтому повторный вызов безопасен и нужен — при переходе
 * на статью без перезагрузки скрипт уже отработал и сам новую кнопку не увидит.
 */

const SDK_SRC = 'https://news.google.com/swg/js/v1/publisher.js'
const DEEPLINK = 'https://www.google.com/preferences/source?q=jumboinjapan.com'

/** Сколько ждать iframe, прежде чем показать запасную ссылку. */
const FALLBACK_DELAY_MS = 6000

/** На сколько заранее до подхода к экрану начинать загрузку SDK. */
const PRELOAD_MARGIN = '400px'

// Маркер, по которому SDK находит контейнер. React такого пропса не знает,
// поэтому подмешиваем спредом — иначе не проходит typecheck.
const SDK_ATTRIBUTE = {
  'google-add-preferred-source-btn': '',
} as unknown as React.HTMLAttributes<HTMLDivElement>

interface PreferredSourceApi {
  init: () => void
}

/** До загрузки скрипта это обычный массив, после — объект SDK. Общее у них — push. */
interface PreferredSourceQueue {
  push: (callback: (api: PreferredSourceApi) => void) => unknown
}

type ButtonState = 'pending' | 'ready' | 'fallback'

interface PreferredSourceButtonProps {
  /** Тема бейджа Google. Подвал тёмный, страницы статей светлые. */
  theme?: 'light' | 'dark'
  className?: string
}

export function PreferredSourceButton({ theme = 'light', className }: PreferredSourceButtonProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [sdkRequested, setSdkRequested] = useState(false)
  const [state, setState] = useState<ButtonState>('pending')

  // Загрузку откладываем до момента, когда блок подходит к экрану, и не раньше
  // события `load` — чтобы запрос не конкурировал с отрисовкой основного экрана.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      setSdkRequested(true)
      return
    }

    let observer: IntersectionObserver | undefined
    const startObserving = () => {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setSdkRequested(true)
            observer?.disconnect()
          }
        },
        { rootMargin: PRELOAD_MARGIN },
      )
      observer.observe(host)
    }

    if (document.readyState === 'complete') {
      startObserving()
    } else {
      window.addEventListener('load', startObserving, { once: true })
    }

    return () => {
      observer?.disconnect()
      window.removeEventListener('load', startObserving)
    }
  }, [])

  // SDK помечает разобранный контейнер атрибутом data-initialized — это и есть
  // сигнал «кнопка на месте». Наблюдаем за ним, чтобы снять запасную ссылку,
  // если скрипт доехал позже таймаута.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    if (host.hasAttribute('data-initialized')) {
      setState('ready')
      return
    }

    const observer = new MutationObserver(() => {
      if (host.hasAttribute('data-initialized')) {
        setState('ready')
        observer.disconnect()
      }
    })
    observer.observe(host, { attributes: true, attributeFilter: ['data-initialized'] })
    return () => observer.disconnect()
  }, [])

  // Скрипт запрошен, но кнопка не появилась — показываем запасную ссылку.
  useEffect(() => {
    if (!sdkRequested) return
    const timer = window.setTimeout(() => {
      setState((current) => (current === 'pending' ? 'fallback' : current))
    }, FALLBACK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [sdkRequested])

  // При клиентской навигации SDK уже загружен и сам новый контейнер не найдёт.
  // Очередь PREFERRED_SOURCE работает и до загрузки скрипта (массив), и после
  // (объект с push) — один и тот же вызов покрывает оба случая.
  const requestInit = useCallback(() => {
    const globalScope = window as unknown as { PREFERRED_SOURCE?: PreferredSourceQueue }
    if (!globalScope.PREFERRED_SOURCE) {
      globalScope.PREFERRED_SOURCE = [] as unknown as PreferredSourceQueue
    }
    globalScope.PREFERRED_SOURCE.push((api) => api.init())
  }, [])

  useEffect(() => {
    if (sdkRequested) requestInit()
  }, [sdkRequested, requestInit])

  return (
    <div className={`relative w-full max-w-md min-h-15 ${className ?? ''}`}>
      <div
        {...SDK_ATTRIBUTE}
        ref={hostRef}
        data-theme={theme}
        data-lang="ru"
        className="w-full min-h-15"
      />
      {state === 'fallback' && (
        <a
          href={DEEPLINK}
          target="_blank"
          rel="noreferrer"
          className="absolute inset-0 inline-flex items-center text-meta underline underline-offset-4 opacity-80 transition-opacity hover:opacity-100"
        >
          Настроить предпочтительные источники Google
        </a>
      )}
      {sdkRequested && (
        <Script
          id="google-preferred-source-sdk"
          src={SDK_SRC}
          strategy="afterInteractive"
          onReady={requestInit}
          onError={() => setState((current) => (current === 'ready' ? current : 'fallback'))}
        />
      )}
    </div>
  )
}
