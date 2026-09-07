/** Отдельная офлайн-проверка силы JA-0. Правятся только копии вне репозитория. */
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createProductionSandbox } from './production-sandbox.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const modulePath = 'scripts/poi-portals/lib/portal-intake-contract.mjs'
const original = readFileSync(path.join(root, modulePath), 'utf8')
const mutations = [
  ['M1', 'if (sha256Bytes(canonicalJsonBytes(body, PORTAL_INTAKE_SPEC)) !== batchDigest)', 'if (false)', 'устаревший checksum'],
  ['M2', "assertIdentity(body.input.records.map((record) => record.sourceKey), body.records.map((record) => record.sourceKey), 'сохранение исходных записей')", '// removed conservation', 'читатель после пересчёта: потерян отказ'],
  ['M3', "if (hint.confidence !== 'unverified' || hint.verifiedAt !== null)", 'if (false)', 'читатель после пересчёта: повышенная уверенность hint'],
  ['M4', 'const batch = readPortalIntakeBatch(raw, { portalId: portal.id, input: expectedInput })', 'const batch = readPortalIntakeBatch(raw, { portalId: portal.id, input: raw.input })', 'production: источник задаёт вызывающий, а не адаптер'],
  ['M5', '...record.observed,', "...record.observed, address: record.hints.find((hint) => hint.field === 'address')?.value ?? record.observed.address,", 'production: подсказка не заполнила адрес'],
  ['M6', "const refusedQueue = batch.records.filter((record) => record.kind === 'refused')", 'const refusedQueue = []', 'production: все отказы сохраняются при нуле кандидатов'],
  ['M7', 'return deepFreeze(batch)', 'return batch', 'читатель владеет копией'],
  ['M8', 'const value = snapshot(raw)', 'const value = JSON.parse(JSON.stringify(raw))', 'сырой пакет: скрытое поле'],
]

function run(source) {
  const sandbox = createProductionSandbox({ patch: { [modulePath]: source } })
  try {
    mkdirSync(path.join(sandbox.dir, 'tests/fixtures/portal-intake'), { recursive: true })
    for (const rel of ['tests/portal-intake-contract.mjs', 'tests/fixtures/portal-intake/japan-guide-v1.json']) {
      sandbox.writeInSandbox(rel, readFileSync(path.join(root, rel), 'utf8'))
    }
    const result = spawnSync(process.execPath, ['tests/portal-intake-contract.mjs'], {
      cwd: sandbox.dir, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '', GOOGLE_PLACES_API_KEY: '', GOOGLE_MAPS_API_KEY: '' },
    })
    return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
  } finally { sandbox.dispose() }
}
const control = run(original)
if (control.status !== 0) throw new Error(`контроль в песочнице не прошёл: ${control.output}`)
console.log(control.output.trim())
let failed = false
for (const [id, before, after, assertion] of mutations) {
  if (original.split(before).length !== 2) throw new Error(`${id}: якорь не единственный`)
  const result = run(original.replace(before, after))
  const killed = result.status === 1 && result.output.includes(`✗ ${assertion}:`)
  console.log(`${id}: ${killed ? 'KILLED' : 'NOT_PROVEN'} — ${assertion}`)
  if (!killed) { failed = true; console.error(result.output) }
}
if (failed) process.exitCode = 1
