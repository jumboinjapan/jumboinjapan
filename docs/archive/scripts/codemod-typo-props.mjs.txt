#!/usr/bin/env node
/**
 * Разовый codemod: подключает типографер к props отображающих компонентов.
 *
 *   function Card({ title, text }: Props) {   →   function Card(props: Props) {
 *                                                   const { title, text } = typoDeep(props)
 *
 * В клиентских компонентах результат мемоизируется по исходным props:
 * typoDeep создаёт новые объекты, а они уходят в зависимости хуков — без
 * useMemo эффект вида useEffect(…, [stops]) срабатывал бы на каждый рендер
 * (в IntercityRouteTimeline такой эффект вызывает setState, то есть это был
 * бы бесконечный цикл, а не просто лишняя работа).
 *
 *   node scripts/codemod-typo-props.mjs           # показать план
 *   node scripts/codemod-typo-props.mjs --write   # применить
 */
import fs from 'node:fs'
import ts from 'typescript'

const WRITE = process.argv.includes('--write')

const TARGETS = [
  ['src/components/sections/CityTourDayPage.tsx', 'CityTourDayPage'],
  ['src/components/sections/ExperienceCard.tsx', 'ExperienceCard'],
  ['src/components/sections/HotelCard.tsx', 'HotelCard'],
  ['src/components/sections/IntercitySummaryStrip.tsx', 'IntercitySummaryStrip'],
  ['src/components/sections/MultiDayBuilderRouteView.tsx', 'MultiDayBuilderRouteView'],
  ['src/components/sections/MultiDayJourneyTree.tsx', 'MultiDayJourneyTree'],
  ['src/components/sections/MultiDayRouteCard.tsx', 'MultiDayRouteCard'],
  ['src/components/sections/MultiDayRouteLanding.tsx', 'MultiDayRouteLanding'],
  ['src/components/sections/PageHero.tsx', 'PageHero'],
  ['src/components/sections/PoiCard.tsx', 'PoiCard'],
  ['src/components/sections/RestaurantCard.tsx', 'RestaurantCard'],
  ['src/components/sections/SectionHeading.tsx', 'SectionHeading'],
  ['src/components/sections/TransportCard.tsx', 'TransportCard'],
  ['src/components/sections/TravelFormatPage.tsx', 'TravelFormatPage'],
  ['src/components/sections/UnderConstruction.tsx', 'UnderConstruction'],
  ['src/components/sections/ServicesFilter.tsx', 'ExperienceServiceCard'],
  ['src/components/sections/ServicesFilter.tsx', 'PracticalServiceCard'],
  ['src/components/TicketDisplayList.tsx', 'TicketDisplayList'],
  ['src/components/resources/ResourcesSectionShell.tsx', 'ResourcesSectionShell'],
  ['src/components/print/PrintProgramDocument.tsx', 'PrintProgramDocument'],
  ['src/components/IntercityRouteTimeline.tsx', 'IntercityRouteTimeline'],
  ['src/components/PoiSheet.tsx', 'PoiSheet'],
  ['src/components/PracticalInfoList.tsx', 'PracticalInfoList'],
  ['src/components/RoutePointModal.tsx', 'RoutePointModal'],
]

// файл → список имён функций
const byFile = new Map()
for (const [file, fn] of TARGETS) {
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(fn)
}

let total = 0
for (const [file, names] of byFile) {
  const src = fs.readFileSync(file, 'utf8')
  const isClient = /^['"]use client['"]/m.test(src)
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  /** @type {Array<{start:number,end:number,text:string}>} */
  const edits = []
  const found = new Set()

  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text) && node.body) {
      const param = node.parameters[0]
      if (!param || !ts.isObjectBindingPattern(param.name)) {
        console.warn(`  ! ${file}#${node.name.text}: первый параметр не деструктуризация — пропуск`)
      } else {
        found.add(node.name.text)
        const bindings = param.name.getText(sf)
        const typeText = param.type ? `: ${param.type.getText(sf)}` : ''
        const indent = '  '
        const wrap = isClient ? 'useMemo(() => typoDeep(props), [props])' : 'typoDeep(props)'
        edits.push({ start: param.getStart(sf), end: param.getEnd(), text: `props${typeText}` })
        edits.push({
          start: node.body.getStart(sf) + 1,
          end: node.body.getStart(sf) + 1,
          text: `\n${indent}const ${bindings} = ${wrap}\n`,
        })
        total++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  for (const name of names) if (!found.has(name)) console.warn(`  ! ${file}: функция ${name} не найдена`)
  if (!edits.length) continue

  // импорты
  const lastImport = sf.statements.filter(ts.isImportDeclaration).at(-1)
  const importPos = lastImport ? lastImport.getEnd() : 0
  if (!/from ['"]@\/lib\/typography['"]/.test(src)) {
    edits.push({ start: importPos, end: importPos, text: `\nimport { typoDeep } from '@/lib/typography'` })
  }
  if (isClient && !/\buseMemo\b/.test(src)) {
    edits.push({ start: importPos, end: importPos, text: `\nimport { useMemo } from 'react'` })
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)

  console.log(`${file}: ${names.join(', ')}${isClient ? ' (клиентский, через useMemo)' : ''}`)
  if (WRITE) fs.writeFileSync(file, out)
}
console.log(`\n${WRITE ? 'Обработано' : 'Будет обработано'} функций: ${total}`)
