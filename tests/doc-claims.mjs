/**
 * Сторож утверждений о состоянии реестров.
 *
 * Зачем он есть. В коммите 10a в канонические реестры добавили по записи, и
 * семь мест — два README, runbook, справка CLI и три комментария — продолжили
 * утверждать, что реестры пусты. Ни один тест этого не заметил: утверждение
 * жило в прозе, а проза ничего не исполняет. Правки хватило бы на один раз;
 * этот набор нужен, чтобы такого раза не было второго.
 *
 * Как он устроен. У каждого утверждения есть образец текста и ПРЕДИКАТ,
 * который говорит, верно ли оно СЕЙЧАС. Совпадение образца там, где предикат
 * ложен, — отказ. Обратное не проверяется: молчание о непустом реестре ложью
 * не является.
 *
 * Разрешения выдаются поимённо и с причиной. Условное сообщение, которое
 * печатается только при пустом реестре, и замороженное значение провода v1 —
 * не ложь, а верный текст в верном месте; но чтобы это стало известно, его
 * надо назвать здесь, а не пропустить молча.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDER_PROFILES } from '../scripts/poi-portals/lib/provider-profile.mjs'
import { PRICING_TABLES } from '../scripts/poi-portals/lib/model-pricing.mjs'
import { ALL_SOURCES } from '../scripts/poi-portals/registry.mjs'
import {
  evaluatePolicy, MODEL_INPUT_FIELDS, POLICY_STATE_ALLOWED,
} from '../scripts/poi-portals/lib/model-plan.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (f) => path.relative(repoRoot, f)
const SKIP = new Set(['node_modules', '.next', '.git', '_to_delete', 'dist', 'build', 'coverage', 'tmp'])
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  if (SKIP.has(name) || name.startsWith('.')) return []
  const full = path.join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [full]
})

/** Проза и исходники, которые владелец читает как описание системы. */
const SCANNED = [
  ...['docs', 'scripts'].map((d) => path.join(repoRoot, d)).filter(existsSync).flatMap(walk),
  ...['README.md', 'AGENTS.md'].map((f) => path.join(repoRoot, f)).filter(existsSync),
].filter((f) => /\.(md|mjs)$/.test(f) && f !== path.join(repoRoot, 'tests/doc-claims.mjs'))

const NOW = new Date('2026-08-17T00:00:00Z')
const anySourceAllows = () => ALL_SOURCES
  .some((s) => evaluatePolicy(s.modelProcessing, { now: NOW, requiredFields: MODEL_INPUT_FIELDS })
    .state === POLICY_STATE_ALLOWED)

/**
 * Утверждения. `holds()` — что должно быть правдой, чтобы текст был честным.
 */
const CLAIMS = [
  {
    id: 'реестр профилей пуст',
    pattern: /(PROVIDER_PROFILES|реестр[\p{L}]*\s+профил[\p{L}]*)[^.\n]{0,60}пуст/giu,
    holds: () => PROVIDER_PROFILES.length === 0,
  },
  {
    id: 'таблица цен не объявлена',
    pattern: /(PRICING_TABLES|реестр[\p{L}]*\s+таблиц|таблиц[\p{L}]*\s+цен)[^.\n]{0,60}пуст/giu,
    holds: () => PRICING_TABLES.length === 0,
  },
  {
    id: 'любая пара профиля отказывает',
    pattern: /люб[\p{L}]+\s+пар[\p{L}]+[^.\n]{0,60}(отказ|не\s+разреш)/giu,
    holds: () => PROVIDER_PROFILES.length === 0,
  },
  {
    id: 'флаг делает план исполняемым',
    pattern: /дела[\p{L}]+\s+план[\p{L}]*\s+исполня[\p{L}]+/giu,
    holds: () => anySourceAllows(),
  },
]

/**
 * Разрешённые вхождения — поимённо и с причиной.
 *
 * Не «список исключений», а список мест, про которые проверено, что текст там
 * верен. Новое вхождение сюда не попадает само: его придётся объяснить.
 */
const ALLOWED = [
  {
    file: 'scripts/poi-portals/lib/provider-profile.mjs',
    needle: 'Реестр пуст: разрешённого провайдера не существует.',
    why: 'условная ветка сообщения: печатается только при PROVIDER_PROFILES.length === 0',
  },
  {
    file: 'scripts/poi-portals/lib/model-plan.mjs',
    needle: "'провайдер не выбран: PROVIDER_PROFILES пуст'",
    why: 'замороженное значение провода v1: входит в подписываемую часть плана',
  },
  {
    file: 'scripts/poi-portals/lib/model-plan.mjs',
    needle: 'канонический реестр профилей был пуст',
    why: 'описание момента, когда версия v1 была определена, — прошедшее время',
  },
  {
    file: 'scripts/poi-portals/lib/model-plan.mjs',
    needle: 'пока реестр был пуст, ошибка не',
    why: 'описание прежнего состояния, прошедшее время',
  },
]

/* Разрешение обязано быть живым: устаревшее указывает на текст, которого уже
   нет, и молча перестаёт что-либо разрешать. */
for (const entry of ALLOWED) {
  const full = path.join(repoRoot, entry.file)
  t(`разрешение живо: ${entry.file} — ${entry.why}`,
    existsSync(full) && readFileSync(full, 'utf8').includes(entry.needle), true)
}

const isAllowed = (file, text, index) => ALLOWED
  .filter((a) => path.join(repoRoot, a.file) === file)
  .some((a) => {
    const at = text.indexOf(a.needle)
    return at >= 0 && index >= at && index < at + a.needle.length
  })

const violations = []
for (const claim of CLAIMS) {
  if (claim.holds()) continue
  for (const file of SCANNED) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(claim.pattern)) {
      if (isAllowed(file, text, m.index)) continue
      const line = text.slice(0, m.index).split('\n').length
      violations.push(`${rel(file)}:${line} — «${claim.id}»: ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`)
    }
  }
}
t('ложных утверждений о состоянии реестров нет', violations.join('\n  '), '')

/* Сторож обязан ловить. Проверка на подставном тексте: иначе набор остался бы
   зелёным и от того, что образцы перестали совпадать вообще с чем-либо. */
const probe = 'Канонический реестр профилей пуст, поэтому любая пара заканчивается отказом.'
const caught = CLAIMS.filter((c) => !c.holds() && [...probe.matchAll(c.pattern)].length)
t('сторож ловит подставное утверждение', caught.length >= 2, true)
t('и при пустом реестре тот же текст был бы честным',
  CLAIMS.filter((c) => c.holds()).length, 0)

/* Состояние, относительно которого всё проверено, названо числом. */
t('в реестре профилей одна запись', PROVIDER_PROFILES.length, 1)
t('в реестре таблиц цен одна запись', PRICING_TABLES.length, 1)
t('ни один источник модельную обработку не разрешает', anySourceAllows(), false)

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ')
  : `✓ утверждения документации о реестрах: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
