/**
 * Определение свежести источника.
 *
 * ГЛАВНАЯ ПРОБЛЕМА, РАДИ КОТОРОЙ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ.
 * Замерено 6 августа 2026 по всем восьми зафиксированным источникам:
 * шесть из них не публикуют НИКАКОГО машиночитаемого сигнала свежести —
 * ни sitemap с lastmod, ни JSON-LD dateModified, ни заголовка Last-Modified.
 *
 *   japan-guide.com        sitemap ✗   ld+json ✗   Last-Modified ✗
 *   japan.travel           sitemap таймаут          ld+json ✗
 *   visit-hokkaido.jp      sitemap ✗   ld+json ✗
 *   shikoku-tourism.com    sitemap ✗   robots.txt ✗ ld+json ✗
 *   en.japantravel.com     sitemap ✗   ld+json ✗   (и robots блокирует AI)
 *   jtb.co.jp              ld+json 1 блок, дат нет
 *   japanstartshere.com    sitemap ✓   dateModified ✓  ← полный сигнал
 *   kyushujourneys.com     sitemap ✓ lastmod 100%      ← есть сигнал
 *
 * Значит требование «свежее доминирует над старым» нельзя выполнить,
 * доверяя заявленным датам: у большинства источников их просто нет.
 * Свежесть приходится ИЗМЕРЯТЬ САМИМ — снимать отпечаток содержимого при
 * каждом прогоне и смотреть, что и когда реально изменилось.
 *
 * Отсюда две шкалы:
 *   declared  что источник сам о себе заявил (может врать и часто врёт:
 *             CMS обновляет lastmod при любой правке шаблона)
 *   measured  что мы увидели своими глазами между прогонами
 *             (на первом прогоне неизвестна — это нормально, см. ниже)
 *
 * measured сильнее declared. Источник, у которого страницы не меняются
 * два года, — старый, что бы ни писал его sitemap.
 */

import { createHash } from 'node:crypto'

// ── Вежливость к серверу ────────────────────────────────────────────────
// Урок дела 岡崎市立中央図書館 (Librahack, 2010): в Японии главный риск
// скрейпинга — не авторское право, а состав «воспрепятствования
// деятельности». Человека задержали при частоте 1 запрос в секунду, потому
// что на другой стороне оказалась хрупкая система. Поэтому: строго
// последовательно, пауза между запросами, честный User-Agent с контактом.
export const POLITE_DELAY_MS = 2000
export const USER_AGENT =
  'JumboInJapanBot/1.0 (+https://jumboinjapan.com; hello@jumboinjapan.com)'

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── robots.txt ──────────────────────────────────────────────────────────

/**
 * Разбор robots.txt. Возвращает правила для нашего агента И отдельно —
 * список поимённо заблокированных AI-агентов: если источник закрыл
 * ClaudeBot или GPTBot, это заявленная позиция по AI, и обходить её
 * подменой User-Agent мы не будем.
 */
export function parseRobots(text) {
  const AI_AGENTS = [
    'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web',
    'anthropic-ai', 'claude-searchbot', 'google-extended', 'perplexitybot',
    'ccbot', 'bytespider', 'cohere-ai', 'applebot-extended', 'meta-externalagent',
    'diffbot', 'img2dataset', 'scrapy',
  ]
  if (!text || /^\s*<!doctype|^\s*<html/i.test(text)) {
    return { present: false, disallow: [], aiBlocked: [], sitemaps: [] }
  }

  const lines = text.split(/\r?\n/)
  let current = []
  const groups = new Map()
  const sitemaps = []
  let lastWasAgent = false

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      if (!lastWasAgent) current = []
      current.push(value.toLowerCase())
      lastWasAgent = true
      for (const agent of current) if (!groups.has(agent)) groups.set(agent, [])
    } else if (key === 'disallow') {
      lastWasAgent = false
      for (const agent of current) groups.get(agent)?.push(value)
    } else if (key === 'allow') {
      lastWasAgent = false
    } else if (key === 'sitemap') {
      sitemaps.push(value)
    }
  }

  const aiBlocked = AI_AGENTS.filter((a) => (groups.get(a) ?? []).some((d) => d === '/' ))
  return {
    present: true,
    disallow: (groups.get('*') ?? []).filter(Boolean),
    aiBlocked,
    sitemaps,
  }
}

export function isDisallowed(pathname, disallow) {
  return disallow.some((rule) => rule && pathname.startsWith(rule.replace(/\*$/, '')))
}

// ── Заявленная свежесть ─────────────────────────────────────────────────

/** Порядок доверия: явная разметка → OG → HTTP-заголовок → видимый текст. */
export function extractDeclaredFreshness(html, headers = {}) {
  const found = []
  const add = (signal, value) => {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) {
      found.push({ signal, iso: d.toISOString() })
    }
  }

  for (const m of html.matchAll(/"dateModified"\s*:\s*"([^"]{4,40})"/g)) add('ld:dateModified', m[1])
  for (const m of html.matchAll(/property="article:modified_time"\s+content="([^"]+)"/g)) {
    add('og:modified_time', m[1])
  }
  for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]{4,40})"/g)) add('ld:datePublished', m[1])

  const lastMod = headers['last-modified'] ?? headers['Last-Modified']
  if (lastMod) add('http:last-modified', lastMod)

  // Видимая дата обновления в тексте — самый слабый сигнал, легко поймать
  // дату новости вместо даты страницы. Берём только с явной подписью.
  for (const m of html.matchAll(
    /(?:last updated|updated on|更新日|最終更新)[:：\s]*([0-9]{4}[-/年][0-9]{1,2}[-/月][0-9]{1,2})/gi,
  )) {
    add('text:updated', m[1].replace(/[年月]/g, '-').replace(/日/, ''))
  }

  if (!found.length) return { available: false, signal: null, iso: null, ageDays: null }

  const PRIORITY = [
    'ld:dateModified', 'og:modified_time', 'http:last-modified',
    'text:updated', 'ld:datePublished',
  ]
  found.sort((a, b) => PRIORITY.indexOf(a.signal) - PRIORITY.indexOf(b.signal))
  const best = found[0]
  return {
    available: true,
    signal: best.signal,
    iso: best.iso,
    ageDays: Math.round((Date.now() - new Date(best.iso).getTime()) / 86400000),
    all: found.slice(0, 5),
  }
}

// ── Измеренная свежесть ─────────────────────────────────────────────────

/**
 * Отпечаток СОДЕРЖАНИЯ, а не разметки. Иначе любая перекатка шаблона,
 * ротация рекламного слота или CSRF-токен показывали бы «страница
 * изменилась», и измерение свежести превратилось бы в шум.
 */
export function contentFingerprint(html) {
  const text = String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
    textLength: text.length,
  }
}

/**
 * Сравнение снимков. На первом прогоне предыдущего нет — это НЕ ошибка,
 * а честное «пока не знаем»: свежесть измеряется временем, а не одним
 * запросом. До накопления второго прогона в весах работает declared.
 */
export function measureDrift(previousSnapshot, currentSamples) {
  if (!previousSnapshot?.samples?.length) {
    return {
      available: false,
      reason: 'нет предыдущего снимка — свежесть будет измерена со второго прогона',
    }
  }
  const prev = new Map(previousSnapshot.samples.map((s) => [s.url, s]))
  let compared = 0
  let changed = 0
  for (const sample of currentSamples) {
    const before = prev.get(sample.url)
    if (!before?.hash) continue
    compared += 1
    if (before.hash !== sample.hash) changed += 1
  }
  if (!compared) return { available: false, reason: 'нет пересечения URL между прогонами' }

  const daysBetween = Math.max(
    1,
    Math.round((Date.now() - new Date(previousSnapshot.capturedAt).getTime()) / 86400000),
  )
  const changeRate = changed / compared
  return {
    available: true,
    compared,
    changed,
    changeRate: Number(changeRate.toFixed(3)),
    daysBetween,
    // Экстраполяция: при такой доле изменений типичная страница обновляется
    // примерно раз в столько дней. Это и есть измеренный возраст факта.
    impliedAgeDays: changeRate > 0 ? Math.round(daysBetween / changeRate) : null,
  }
}

/**
 * Сводит declared и measured в один возраст факта для модели весов.
 * measured сильнее: источник может писать в sitemap сегодняшнюю дату,
 * не меняя ни слова в содержании.
 */
export function effectiveAgeDays({ declared, measured }) {
  if (measured?.available && measured.impliedAgeDays !== null) {
    if (!declared?.available) return { ageDays: measured.impliedAgeDays, basis: 'measured' }
    // Расходятся сильно — верим худшему: заявленная свежесть без реальных
    // изменений содержания это ровно тот случай, ради которого всё это.
    return {
      ageDays: Math.max(measured.impliedAgeDays, declared.ageDays),
      basis: 'measured+declared (взят худший)',
    }
  }
  if (declared?.available) return { ageDays: declared.ageDays, basis: 'declared' }
  return { ageDays: null, basis: 'неизвестна' }
}
