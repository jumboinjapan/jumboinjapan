#!/usr/bin/env node
/**
 * Инварианты владельческого гейта Telegram-вебхука (src/lib/telegram-owner-gate.ts).
 *
 * Запуск: node tests/telegram-owner-gate.mjs
 *
 * Смысл теста ровно один: отсутствие настройки не должно ослаблять проверку.
 * До 2026-08-09 незаданный TELEGRAM_OWNER_CHAT_ID открывал приём POI любому
 * пользователю бота — условие `(OWNER && chat !== OWNER)` при пустом OWNER
 * просто вырождалось. Такую регрессию глазами не ловят, поэтому она здесь.
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const source = fs.readFileSync(path.join(root, 'src/lib/telegram-owner-gate.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const { decideOwnerAccess } = await import(dataUrl)

const failures = []
let passed = 0

function check(actual, expected, message) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failures.push(`${message}\n    получено: ${a}\n    ожидалось: ${e}`)
}

const OWNER = '123456789'
const STRANGER = '987654321'

// ── Главное: без настройки закрыто ───────────────────────────────────────────
check(decideOwnerAccess(OWNER, ''), { allowed: false, reason: 'owner-not-configured' },
  'пустой TELEGRAM_OWNER_CHAT_ID закрывает доступ даже самому владельцу')
check(decideOwnerAccess(STRANGER, ''), { allowed: false, reason: 'owner-not-configured' },
  'пустой TELEGRAM_OWNER_CHAT_ID не пропускает постороннего')
check(decideOwnerAccess('', ''), { allowed: false, reason: 'owner-not-configured' },
  'пустые обе стороны — отказ, а не совпадение')
check(decideOwnerAccess(STRANGER, '   '), { allowed: false, reason: 'owner-not-configured' },
  'переменная из одних пробелов считается незаданной')

// ── Обычная работа ───────────────────────────────────────────────────────────
check(decideOwnerAccess(OWNER, OWNER), { allowed: true },
  'владелец проходит')
check(decideOwnerAccess(` ${OWNER} `, OWNER), { allowed: true },
  'пробелы по краям chat id не мешают владельцу')
check(decideOwnerAccess(OWNER, ` ${OWNER} `), { allowed: true },
  'пробелы по краям переменной не мешают владельцу')
check(decideOwnerAccess(STRANGER, OWNER), { allowed: false, reason: 'foreign-chat' },
  'посторонний чат отклоняется')
check(decideOwnerAccess('', OWNER), { allowed: false, reason: 'no-chat-id' },
  'апдейт без chat id отклоняется')

// ── Никаких нестрогих совпадений ─────────────────────────────────────────────
check(decideOwnerAccess('12345678', OWNER), { allowed: false, reason: 'foreign-chat' },
  'префикс чужого id не считается совпадением')
check(decideOwnerAccess(`${OWNER}0`, OWNER), { allowed: false, reason: 'foreign-chat' },
  'id владельца с приписанной цифрой не проходит')
check(decideOwnerAccess(`-${OWNER}`, OWNER), { allowed: false, reason: 'foreign-chat' },
  'групповой чат с отрицательным id не выдаёт себя за владельца')

// ── Итог ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ Провалено ${failures.length} из ${failures.length + passed}:\n`)
  failures.forEach(f => console.error('  • ' + f))
  process.exit(1)
}
console.log(`✅ Гейт Telegram-вебхука: ${passed} проверок пройдено`)
