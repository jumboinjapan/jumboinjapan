import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve as resolveAlias } from './support/alias-loader.mjs'
import { mergeCityTourStops, selectPhotoFallback } from '../src/lib/city-tour-stop-merge.ts'
import { cityTourHiddenSpotsStops } from '../src/data/city-tour-hidden-spots.ts'

/* Граница applyCityTourStopOverrides импортирует `@/…`, чего голый node не
   понимает. Хук-резолвер делает её загружаемой, не меняя её код, — иначе
   проводка файла-подстраховки осталась бы непокрытой (долг R1-F4).

   Граница берётся динамическим импортом намеренно: статические импорты
   разрешаются до первой строки кода, то есть раньше, чем встанут хуки. */
registerHooks({ resolve: resolveAlias })
const { applyCityTourStopOverrides } = await import('../src/lib/city-tour-overrides.ts')
const photoFallbackFile = JSON.parse(readFileSync(
  new URL('../src/data/route-stop-photos.generated.json', import.meta.url), 'utf8'))

let passed = 0
const fail = (label, actual, expected) => {
  throw new Error(`${label}: получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`)
}
const equal = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(label, actual, expected)
  passed += 1
}

const stop = (title, index) => ({
  id: `stop-${index}`,
  number: String(index + 1),
  title,
  text: `Текст ${index + 1}`,
  duration: '~30 минут',
})

const overrides = [
  ['Сибамата', 1],
  ['Янака Гинза', 2],
  ['Акихабара', 3],
  ['Омоидэ Ёкотё', 4],
  ['Голден Гай', 5],
].map(([title, order]) => ({
  poiNameSnapshot: title,
  titleOverride: title,
  order,
  status: 'Active',
  isHelper: false,
}))

/* P0: Airtable не может добавить пятую остановку в четырёхстрочную модель.
   Это было состояние страницы до правки: обе раздельные строки в базе не
   меняли публичный состав маршрута. */
const legacyBase = [
  'Сибамата',
  'Янака Гинза',
  'Акихабара',
  'Голден Гай / Омоидэ Йокотё',
].map(stop)
const legacyResult = mergeCityTourStops(legacyBase, overrides)
equal('P0: пять Route Stops не расширяют четырёхстрочную модель', legacyResult.length, 4)
equal('P0: объединённая остановка остаётся в выдаче', legacyResult.at(-1).title, 'Голден Гай / Омоидэ Йокотё')

const snapshotMatch = mergeCityTourStops([stop('Снимок', 0)], [{
  poiNameSnapshot: 'Снимок',
  titleOverride: 'Название из Airtable',
  descriptionOverride: 'Текст из Airtable',
  status: 'Active',
}])
equal('POI Name Snapshot самостоятельно находит строку',
  [snapshotMatch[0].title, snapshotMatch[0].text],
  ['Название из Airtable', 'Текст из Airtable'])

const titleMatch = mergeCityTourStops([stop('Название', 0)], [{
  poiNameSnapshot: 'Устаревший снимок',
  titleOverride: 'Название',
  descriptionOverride: 'Текст по title override',
  status: 'Active',
}])
equal('Stop Title Override самостоятельно находит строку', titleMatch[0].text, 'Текст по title override')

const nbspMatch = mergeCityTourStops([stop('Асакуса и\u00A0Сэнсо-дзи', 0)], [{
  poiNameSnapshot: 'Асакуса и Сэнсо-дзи',
  descriptionOverride: 'Совпало после нормализации',
  status: 'Active',
}])
equal('неразрывный пробел не ломает сопоставление', nbspMatch[0].text, 'Совпало после нормализации')

const fallbackMatch = mergeCityTourStops(
  [stop('Мэйдзи и\u00A0Сибуя', 0)],
  [],
  { 'Мэйдзи и Сибуя': { photo: '/fallback.jpg', alt: 'Фото из fallback' } },
)
equal('fallback фотографии использует ту же нормализацию',
  [fallbackMatch[0].photo, fallbackMatch[0].alt],
  ['/fallback.jpg', 'Фото из fallback'])

const reordered = mergeCityTourStops(
  [stop('Первая', 0), stop('Вторая', 1)],
  [
    { poiNameSnapshot: 'Первая', order: 2, status: 'Active' },
    { poiNameSnapshot: 'Вторая', order: 1, status: 'Active' },
  ],
)
equal('поле № управляет порядком сопоставленных остановок',
  reordered.map((row) => row.title), ['Вторая', 'Первая'])

const excluded = mergeCityTourStops(
  [stop('Inactive', 0), stop('Helper', 1)],
  [
    { poiNameSnapshot: 'Inactive', descriptionOverride: 'НЕ ПОКАЗЫВАТЬ', status: 'Inactive' },
    { poiNameSnapshot: 'Helper', descriptionOverride: 'НЕ ПОКАЗЫВАТЬ', status: 'Active', isHelper: true },
  ],
)
equal('Inactive не накладывает публичный override', excluded[0].text, 'Текст 1')
equal('helper не накладывает публичный override', excluded[1].text, 'Текст 2')

equal('публичная модель содержит пять остановок', cityTourHiddenSpotsStops.length, 5)
equal(
  'порядок публичной модели',
  cityTourHiddenSpotsStops.map((row) => row.title),
  ['Сибамата', 'Янака Гинза', 'Акихабара', 'Омоидэ Ёкотё', 'Голден Гай'],
)

const merged = mergeCityTourStops(cityTourHiddenSpotsStops, overrides)
equal('обе вечерние остановки сопоставляются независимо', merged.map((row) => row.title),
  ['Сибамата', 'Янака Гинза', 'Акихабара', 'Омоидэ Ёкотё', 'Голден Гай'])
equal('после разделения карточки не схлопываются', new Set(merged.map((row) => row.id)).size, 5)

const publicCopy = JSON.stringify(cityTourHiddenSpotsStops)
equal('в модели нет Йокотё', publicCopy.includes('Йокотё'), false)
equal('в модели нет Ёкочо', publicCopy.includes('Ёкочо'), false)


// ── Выбор раздела подстраховки: чистая функция на НАСТОЯЩЕМ файле ──────────
/* Файл читается тот же, что импортирует production, а не выдуманный: раздел,
   подставленный не тому маршруту, показал бы чужие фотографии, и поймать это
   на самодельной фикстуре нельзя — там любые ключи «правильные». */
const SLUGS = ['city-tour/day-one', 'city-tour/day-two', 'city-tour/hidden-spots']
equal('в настоящем файле ровно три известных маршрута',
  Object.keys(photoFallbackFile.bySlug).sort(), [...SLUGS].sort())

for (const slug of SLUGS) {
  const section = selectPhotoFallback(photoFallbackFile, slug)
  equal(`раздел ${slug} найден и непуст`,
    Boolean(section) && Object.keys(section).length > 0, true)
}

equal('разделы трёх маршрутов не совпадают между собой',
  new Set(SLUGS.map((slug) => JSON.stringify(selectPhotoFallback(photoFallbackFile, slug)))).size, 3)

equal('неизвестный слаг не отдаёт раздел',
  selectPhotoFallback(photoFallbackFile, 'city-tour/no-such-route'), undefined)
equal('без слага раздела нет', selectPhotoFallback(photoFallbackFile), undefined)
equal('пустой слаг раздела не даёт', selectPhotoFallback(photoFallbackFile, ''), undefined)
equal('ключ из прототипа не считается разделом',
  [selectPhotoFallback(photoFallbackFile, '__proto__'),
    selectPhotoFallback(photoFallbackFile, 'constructor'),
    selectPhotoFallback(photoFallbackFile, 'toString')],
  [undefined, undefined, undefined])
equal('файл без bySlug раздела не даёт', selectPhotoFallback({}, 'city-tour/day-one'), undefined)

// ── Проводка САМОЙ границы, а не только helper ────────────────────────────
/* Ниже проверяется applyCityTourStopOverrides целиком: что она читает тот
   самый файл и передаёт в него именно свой routeSlug. До появления
   хука-резолвера это не проверялось ничем. */
const codeStop = (title) => ({ id: 'x', number: '1', title, text: 'текст из кода', duration: '~30 минут' })

/* Порядок здесь не косметический. «Гиндза» есть ТОЛЬКО в разделе day-one, а
   «Акихабара» — только в hidden-spots, и разделы не пересекаются ни одним
   заголовком. Поэтому подмена слага на зашитый валится на первом утверждении,
   а отказ читать файл — на втором: у каждой поломки свой случай, а не общий. */
const foreignSection = applyCityTourStopOverrides([codeStop('Гиндза')], [], 'city-tour/hidden-spots')
equal('граница не подставляет раздел чужого маршрута',
  [foreignSection[0].photo, foreignSection[0].alt], [undefined, undefined])

const wired = applyCityTourStopOverrides([codeStop('Акихабара')], [], 'city-tour/hidden-spots')
equal('граница берёт фото из настоящего файла-подстраховки',
  [wired[0].photo, wired[0].alt],
  ['/tours/city-tour-hidden-spots/akihabara-main.jpg', 'Вечерняя Акихабара'])

const foreignSlug = applyCityTourStopOverrides([codeStop('Акихабара')], [], 'city-tour/day-one')
equal('свой routeSlug не подменяется соседним', [foreignSlug[0].photo, foreignSlug[0].alt],
  [undefined, undefined])

const noSlug = applyCityTourStopOverrides([codeStop('Акихабара')], [])
equal('без слага граница фото не подставляет', noSlug[0].photo, undefined)

const nbspThroughBoundary = applyCityTourStopOverrides(
  [codeStop('Асакуса и\u00A0Сэнсо-дзи')], [], 'city-tour/day-two')
equal('неразрывный пробел не ломает подстраховку и на границе',
  nbspThroughBoundary[0].photo, '/tours/city-tour-day-two/sensoji.jpg')

const airtableWins = applyCityTourStopOverrides(
  [codeStop('Акихабара')],
  [{ poiNameSnapshot: 'Акихабара', photoPath: '/из-airtable.jpg', photoAlt: 'из Airtable', status: 'Active' }],
  'city-tour/hidden-spots',
)
equal('фото из Airtable выигрывает у подстраховки',
  [airtableWins[0].photo, airtableWins[0].alt], ['/из-airtable.jpg', 'из Airtable'])

console.log(`city-tour overrides: ${passed} проверок пройдено`)
