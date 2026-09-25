#!/usr/bin/env node
/** Verify emitted App Router function traces after next build. No network or writes. */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function inspectRuntimeTrace(traceFile, files, root) {
  const problems = []
  for (const file of files) {
    const target = path.resolve(path.dirname(traceFile), file)
    const relative = path.relative(root, target).split(path.sep).join('/')
    if (/^(tmp(?:-[^/]*)?|tests|backup|_to_delete)\//.test(relative) || relative.startsWith('docs/archive/')) {
      problems.push(relative)
    }
    if (traceFile.split(path.sep).join('/').includes('/api/telegram/webhook/') &&
        (relative.startsWith('public/') || /\/(write-journal|verified-write)\.mjs$/.test(relative))) {
      problems.push(relative)
    }
  }
  return problems
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

export function checkRuntimeBundles(root = process.cwd()) {
  const files = walk(path.join(root, '.next/server/app')).filter(file => file.endsWith('/route.js.nft.json'))
  assert(files.some(file => file.includes('/api/telegram/webhook/')), 'Telegram function trace missing: run next build first')
  const problems = files.flatMap(file => inspectRuntimeTrace(file, JSON.parse(readFileSync(file, 'utf8')).files, root)
    .map(target => `${path.relative(root, file)} → ${target}`))
  assert.equal(problems.length, 0, `Runtime contains operational artifacts:\n${problems.join('\n')}`)
  console.log(`✓ runtime traces: ${files.length} handlers, no temporary/test/archive artifacts; Telegram has no CLI journal or public photos`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkRuntimeBundles()
