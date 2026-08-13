#!/usr/bin/env node
/**
 * Тесты матчера POI: дубли, родители, транслитерация.
 *
 *   npm run test:poi-matching
 *
 * Почему тест нужен. Прежняя реализация сравнения имён жила прямо
 * в poi-intake.ts, не была покрыта ничем и молча пропускала дубли:
 * на живой базе из 431 записи нашлись четыре пары одного и того же
 * объекта, две из которых уже опубликованы. Каждый случай ниже —
 * реальная запись из базы или реальная ошибка, найденная при разборе.
 */

import {
  nameSimilarity,
  matchPoi,
  romajiSkeleton,
  containmentRelation,
  haversineMeters,
  screenNewPoi,
  splitNamespace,
  collectionEvidence,
  qualifierRelation,
  nameScript,
  normalizeName,
} from '../src/lib/poi-matching.ts'

let passed = 0
const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) passed += 1
  else failures.push(`${label}\n    ожидалось: ${expected}\n    получено:  ${actual}`)
}

/**
 * @param cityTokens скелеты городов обеих записей. В бою их подставляет
 *   matchPoi; вызывать nameSimilarity без них можно только там, где
 *   город заведомо ни при чём — иначе объекты одного города, у которых
 *   после снятия родовых слов остаётся только топоним, дадут ложное 1.
 */
function checkMatch(label, a, b, shouldMatch, cityTokens = [], threshold = 0.72) {
  const score = nameSimilarity(a, b, cityTokens)
  const matched = score >= threshold
  if (matched === shouldMatch) passed += 1
  else {
    failures.push(
      `${label}\n    «${a}» ⟷ «${b}»\n    ожидалось ${shouldMatch ? 'совпадение' : 'расхождение'}, вес ${score}`,
    )
  }
}

// ── Транслитерация: таблица Поливанова должна покрывать весь алфавит ─────
{
  const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
  const leftovers = [...alphabet].filter((ch) =>
    /[а-яё]/.test(romajiSkeleton(`тест${ch}тест`).replace(/[a-z0-9]/g, '')),
  )
  check('в таблице Поливанова нет пропущенных букв', leftovers.join('') || 'нет', 'нет')
  // Буква «е» отсутствовала в первой версии: «Хаконе» давало «hakon».
  check('«е» транслитерируется', romajiSkeleton('Хаконе'), 'hakone')
  check('родовое слово снимается', romajiSkeleton('Храм Токэйдзи'), 'tokeiji')
  check('макроны и дефисы снимаются', romajiSkeleton('Tōkei-ji Temple'), 'tokeiji')
}

// ── Межалфавитное сопоставление ─────────────────────────────────────────
checkMatch('РУ и латиница с макроном', 'Храм Токэйдзи', 'Tōkei-ji Temple', true)
checkMatch('РУ и латиница без макрона', 'Храм Дзёмёдзи', 'Jomyoji Temple', true)
checkMatch('родовое слово переведено, а не транслитерировано', 'Святилище Мэйдзи', 'Meiji Jingū', true)
checkMatch('родовое слово в конце', 'Канатная дорога Хаконе', 'Hakone Ropeway', true)
checkMatch('скобочное уточнение', 'Храм Хасэ Каннон (Хасэдэра)', 'Hase-dera Temple', true)

// Разница в одну букву внутри слова: «engakuji» ⊂ «sengakuji».
// Без требования границы слова эти два храма сливались.
checkMatch('Энгакудзи ≠ Сэнгакудзи', 'Храм Энгакудзи', 'Sengaku-ji Temple', false)
checkMatch('Тодайдзи ≠ Тосёдайдзи', 'Храм Тодайдзи', 'Tōshōdai-ji Temple', false)
checkMatch('Дзюфукудзи ≠ Кофукудзи', 'Храм Дзюфукудзи', 'Kōfuku-ji Temple', false)

// ── Внутри одного алфавита: родовое слово и ядро — два условия ───────────
checkMatch('одно родовое слово, разные ядра', 'Художественный музей Пола', 'Художественный музей Хаконе', false, ['hakone'])
// Обе записи в Хаконэ: после снятия родовых слов от обеих остаётся «hakone».
// Без передачи городского токена это дало бы ложную единицу.
checkMatch('одно ядро, разные родовые слова', 'Канатная дорога Хаконе', 'Ботанический сад Хаконе', false, ['hakone'])
checkMatch('разные храмы в одном городе', 'Храм Тодайдзи', 'Храм Тосёдайдзи', false)
checkMatch('разные кварталы', 'Квартал Ниси Тяя', 'Квартал Хигаси Тяя', false)
checkMatch('настоящий дубль — разное написание', 'Руины замка Сендай (Замок Аоба)', 'Руины замка Сэндай (Аоба)', true)
checkMatch('настоящий дубль — кавычки и дефис', 'Музей нэбута «Ва-Рассэ»', 'Музей Небута Ва Рассэ', true)

// ── Латиница против латиницы: главный режим коллектора ──────────────────
//
// Правило «родовое слово отдельно от ядра» для английских названий не
// работало вовсе: GENERIC_HEAD привязан к началу строки, а в английском
// родовое слово стоит в конце. Замер до правки — ошибка в обе стороны:
//   «Todai-ji Temple» ⟷ «Todaiji»           0,50  один храм, пропуск
//   «Sengaku-ji Temple» ⟷ «Engaku-ji Temple» 0,86  разные, почти блок
{
  const score = (a, b) => nameSimilarity(a, b)
  // Родовые слова — переводы друг друга. Сравнение строками давало 0.
  check('taisha = shrine', score('Fushimi Inari Taisha', 'Fushimi Inari Shrine'), 1)
  check('jingu = shrine', score('Meiji Jingu', 'Meiji Shrine'), 1)
  // Слова из одной области — НЕ синонимы. Живая база: POI-000047 и
  // POI-000048, канатная дорога и горная железная дорога в Хаконэ.
  check('канатная дорога ≠ горная железная дорога',
    score('Канатная дорога Хаконе', 'Горная железная дорога Хаконе'), 0)
  checkMatch('ropeway ≠ railway', 'Hakone Ropeway', 'Hakone Tozan Railway', false)
  checkMatch('замки разных городов', 'Nijo Castle', 'Osaka Castle', false)

  // Дефисы в ромадзи произвольны: Todai-ji = Todaiji = Todai ji.
  checkMatch('дефис в ромадзи не мешает', 'Todai-ji Temple', 'Todaiji', true)
  checkMatch('и в другой паре', 'Kiyomizu-dera Temple', 'Kiyomizudera', true)

  // Но выше 0,85 такая пара не поднимается: родовое слово снято только
  // с одной стороны, и от названия остаётся ядро. Если ядро — топоним,
  // дубль неотличим от отношения «часть-целое». Живая база: POI-000314
  // «Рыбный рынок Тоёсу» и POI-000324 «Тоёсу (район)» — не дубли.
  check('одностороннее родовое слово не блокирует', score('Todai-ji Temple', 'Todaiji') < 0.9, true)
  check('рынок внутри района — не дубль', score('Toyosu Market', 'Toyosu') < 0.9, true)
}

// ── Отношение «часть — целое» ───────────────────────────────────────────
check('Роппонги ⊃ Роппонги Хиллз', containmentRelation('Роппонги', 'Роппонги Хиллз'), 'a_is_parent')
check('Синдзюку Гёэн ⊂ Синдзюку', containmentRelation('Синдзюку Гёэн', 'Синдзюку'), 'b_is_parent')
check('разные объекты — не отношение', containmentRelation('Храм Тодайдзи', 'Храм Токэйдзи'), null)

// ── Гейт ────────────────────────────────────────────────────────────────
{
  const base = [
    { poiId: 'POI-000024', nameRu: 'Храм Токэйдзи', nameEn: 'Tokeiji Temple', siteCity: 'kamakura' },
    { poiId: 'POI-000219', nameRu: 'Храм Риннодзи', nameEn: 'Rinnoji Temple', siteCity: 'nikko' },
    { poiId: 'POI-000320', nameRu: 'Роппонги', nameEn: 'Roppongi', siteCity: 'tokyo' },
    { poiId: 'POI-000200', nameRu: 'Храм Тодайдзи', nameEn: 'Todaiji Temple', siteCity: 'nara' },
  ]

  check(
    'уверенный дубль в том же городе блокируется',
    screenNewPoi({ nameRu: 'Храм Токэйдзи', siteCity: 'kamakura' }, base).verdict,
    'blocked_duplicate',
  )
  // Тёзок в Японии много: Риннодзи есть и в Никко, и в Сэндае.
  check(
    'тёзка в другом городе идёт на проверку, а не в блок',
    screenNewPoi({ nameRu: 'Храм Риннодзи', siteCity: 'sendai' }, base).verdict,
    'needs_review',
  )
  check(
    'новый объект проходит',
    screenNewPoi({ nameRu: 'Храм Гокуракудзи', siteCity: 'kamakura' }, base).verdict,
    'clear',
  )
  check(
    'часть-целое не блокируется',
    screenNewPoi({ nameRu: 'Роппонги Хиллз', siteCity: 'tokyo' }, base).verdict,
    'clear',
  )
  check(
    'родитель находится по имени',
    screenNewPoi({ nameRu: 'Павильон Дайбуцудэн', siteCity: 'nara' }, base, { nameRu: 'Храм Тодайдзи' })
      ?.parent?.candidate.poiId,
    'POI-000200',
  )
  check(
    'несуществующий родитель не выдумывается',
    screenNewPoi({ nameRu: 'Павильон X', siteCity: 'nara' }, base, { nameRu: 'Храм Которого Нет' }).parent,
    null,
  )
  // Имя города — не основание для совпадения: оно есть у половины записей.
  check(
    'общий топоним не делает записи дублями',
    screenNewPoi({ nameRu: 'Руины замка Сендай', nameEn: 'Sendai Castle Ruins', siteCity: 'sendai' }, [
      { poiId: 'POI-000471', nameRu: 'Храм Риннодзи (Сэндай)', nameEn: 'Rinnoji Temple (Sendai)', siteCity: 'sendai' },
    ]).verdict,
    'clear',
  )

  // ── Межалфавитное совпадение НИКОГДА не блокирует само по себе ────────
  // Это цепочка допущений (транслитерация → снятие родовых слов →
  // схлопывание долгих гласных), и на выходе от названия часто остаётся
  // топоним. Реальные пары из базы, которые так слипались:
  //   «Гора Асахидакэ» ⟷ «Asahidake Onsen Village»
  //   «Toyosu Market»  ⟷ «Тоёсу (район)»
  // Ни одна не дубль. Показываем владельцу, решение за ним.
  const crossOnly = [
    { poiId: 'POI-000398', nameRu: 'Гора Асахидакэ', siteCity: 'daisetsuzan' },
  ]
  check(
    'межалфавитное совпадение уходит на проверку, а не в блок',
    screenNewPoi({ nameRu: '', nameEn: 'Asahidake Onsen Village', siteCity: 'daisetsuzan' }, crossOnly).verdict,
    'needs_review',
  )
  check(
    'но оно обязательно показывается',
    screenNewPoi({ nameRu: '', nameEn: 'Asahidake Onsen Village', siteCity: 'daisetsuzan' }, crossOnly)
      .duplicates.length > 0,
    true,
  )
}

// ── Координаты как независимая ось ──────────────────────────────────────
{
  // Токийская башня → Сэнсодзи. По прямой ≈ 7,8 км: 6,2 км по широте
  // и 4,6 км по долготе (на 35-й параллели градус долготы короче
  // градуса широты почти на пятую часть — ровно то, что считает формула).
  const d = haversineMeters({ lat: 35.6586, lon: 139.7454 }, { lat: 35.7148, lon: 139.7967 })
  check('гаверсинус считает километры', d > 7700 && d < 7900, true)
  check('нет координат — нет расстояния', haversineMeters({ lat: 35.6, lon: null }, { lat: 35.6, lon: 139.7 }), null)
  // Седьмой знак — сантиметры. Порог соседства (60 м) должен быть заметно
  // грубее шума источников, иначе он ловил бы разные обводки одного здания.
  check('соседние знаки — метры', haversineMeters({ lat: 35.6586, lon: 139.7454 }, { lat: 35.6590, lon: 139.7454 }) < 60, true)

  // Ровно тот случай, ради которого координаты и заводились: строковое
  // сравнение между алфавитами ограничено 0,85 и блокировать не умеет.
  const enOnly = [{ poiId: 'POI-000024', nameRu: '', nameEn: 'Tokeiji Temple', siteCity: 'kamakura', lat: 35.3363, lon: 139.5433 }]
  check(
    'межалфавитная пара без координат — только проверка',
    screenNewPoi({ nameRu: 'Храм Токэйдзи', siteCity: 'kamakura' }, enOnly).verdict,
    'needs_review',
  )
  check(
    'та же пара в сорока метрах — блокировка',
    screenNewPoi({ nameRu: 'Храм Токэйдзи', siteCity: 'kamakura', lat: 35.3364, lon: 139.5434 }, enOnly).verdict,
    'blocked_duplicate',
  )

  // Обратное направление важнее: расстояние снимает блокировку, которую
  // имена поставили бы. Тёзок в Японии больше, чем дублей.
  const twins = [{ poiId: 'POI-000701', nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.6574, lon: 139.748 }]
  check(
    'совпадение имён в том же городе без координат — блок',
    screenNewPoi({ nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo' }, twins).verdict,
    'blocked_duplicate',
  )
  // Снятая блокировка не превращается в вопрос к человеку: координаты уже
  // ответили на него в пользу «разные места». Пара уезжает в отдельное поле
  // и в Notes, но приём идёт дальше. С 11.08.2026 это принципиально: вердикт
  // 'needs_review' теперь ОСТАНАВЛИВАЕТ создание, и оставить его здесь
  // значило бы останавливать каждую японскую тёзку.
  const refuted = screenNewPoi({ nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.7101, lon: 139.8107 }, twins)
  check('шесть километров между точками снимают блок', refuted.verdict, 'clear')
  check('и пара остаётся видимой', refuted.geoRefutedDuplicate?.candidate.poiId, 'POI-000701')

  // РЕГРЕССИЯ: далёкая тёзка не должна прятать настоящий дубль.
  // Опровергнутый расстоянием кандидат раньше был верхним по весу и забирал
  // разбор на себя — до второго кандидата дело не доходило. Пока опровержение
  // возвращало 'needs_review', это прикрывалось остановкой; как флаг оно
  // пропустило бы дубль в пятидесяти метрах под вердиктом 'clear'.
  const hidden = [
    { poiId: 'POI-000701', nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.6574, lon: 139.748 },
    { poiId: 'POI-000702', nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.7101, lon: 139.8111 },
  ]
  const both = screenNewPoi({ nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.7101, lon: 139.8107 }, hidden)
  check('далёкая тёзка не скрывает близкий дубль', both.verdict, 'blocked_duplicate')
  check('заблокировал именно ближний', both.blockingDuplicate?.candidate.poiId, 'POI-000702')
  check('дальний остался тёзкой', both.geoRefutedDuplicate?.candidate.poiId, 'POI-000701')

  // Та же расстановка, но второй кандидат без координат и в другом городе —
  // блокировать нельзя, а останавливать нужно. Раньше далёкая тёзка забирала
  // разбор на себя и этот кандидат не рассматривался вовсе.
  const hiddenSoft = [
    { poiId: 'POI-000703', nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.6574, lon: 139.748 },
    { poiId: 'POI-000704', nameRu: 'Храм Дзёдзёдзи', siteCity: 'osaka' },
  ]
  const soft = screenNewPoi({ nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo', lat: 35.7101, lon: 139.8107 }, hiddenSoft)
  check('далёкая тёзка не скрывает кандидата без координат', soft.verdict, 'needs_review')
  check('и он остался верхним живым', soft.duplicates.some((m) => m.candidate.poiId === 'POI-000704'), true)

  // Части одного комплекса стоят в одной точке и остаются разными записями.
  const complex = [{ poiId: 'POI-000702', nameRu: 'Ворота Нандаймон', siteCity: 'nara', lat: 34.689, lon: 135.839 }]
  const near = screenNewPoi({ nameRu: 'Храм Тодайдзи', siteCity: 'nara', lat: 34.6892, lon: 135.8392 }, complex)
  check('непохожие имена рядом не блокируются', near.verdict, 'needs_review')
  check('но сосед показан', near.geoNeighbours[0]?.candidate.poiId, 'POI-000702')

  // Координаты есть только у одной записи — гейт обязан работать как раньше.
  // В базе координат сейчас нет ни у одной из 425 записей, и первые месяцы
  // сбора эта ситуация будет основной.
  const halfKnown = [{ poiId: 'POI-000024', nameRu: 'Храм Токэйдзи', siteCity: 'kamakura' }]
  check(
    'односторонние координаты ничего не ломают',
    screenNewPoi({ nameRu: 'Храм Токэйдзи', siteCity: 'kamakura', lat: 35.3363, lon: 139.5433 }, halfKnown).verdict,
    'blocked_duplicate',
  )
}

// ── Именованная коллекция ───────────────────────────────────────────────
//
// Коллекция — это несколько САМОСТОЯТЕЛЬНЫХ объектов с общим началом имени
// («Дом-проект: …», «Этиго-Цумари: …»). Имя коллекции — имя собственное,
// в справочнике родовых слов его нет, поэтому оно оставалось в сравнении
// целиком и занимало бо́льшую часть строки: разные объекты набирали 0,75–0,80
// и при близких координатах блокировали друг друга.
//
// Правка обязана закрыть ОБЕ стороны. Одного лишь снятия общего префикса
// мало: пара «Дом-проект: Кадоя» ⟷ «Echigo-Tsumari: Kadoya» тогда даёт 0,85
// по одному совпавшему объекту и в 122 м блокируется, а настоящий дубль
// «Kadoya» ⟷ «Kadoya (Naoshima)» падает до 0,6087 и проходит молча.
{
  const score = (a, b) => nameSimilarity(a, b)

  // ── 9. Разбор имени: что считается коллекцией, а что нет ──────────────
  check('коллекция отделяется', splitNamespace('Дом-проект: Кадоя').namespace, 'дом проект')
  check('объект отделяется', splitNamespace('Дом-проект: Кадоя').local, 'кадоя')
  // Дефис внутри слова разделителем НЕ является: иначе «Дом-проект»,
  // «Todai-ji» и «Этиго-Цумари» разрезались бы пополам.
  check('дефис — не разделитель', splitNamespace('Дом-проект').namespace, '')
  check('и в ромадзи тоже', splitNamespace('Todai-ji Temple').namespace, '')

  // ВЫРОЖДЕННЫЕ ЧАСТИ. Ни один из этих случаев не имеет права оставить от
  // имени половину: если часть слишком коротка, коллекции просто нет,
  // а full остаётся полным именем.
  for (const [label, name] of [
    ['пустая часть после двоеточия', 'Дом-проект: '],
    ['двоеточие в конце', 'Дом-проект:'],
    ['двухсимвольная часть — часть заголовка, а не объект',
      'Выставка «Shinjuku Kabukicho Shunga Exhibition: WA»'],
    ['однобуквенные части', 'A: B'],
    ['время в названии', 'Кафе 24:7'],
  ]) {
    const parsed = splitNamespace(name)
    check(`${label}: коллекции нет`, parsed.namespace, '')
    check(`${label}: имя не урезано`, parsed.local, normalizeName(name))
    check(`${label}: full цел`, parsed.full, normalizeName(name))
  }
  // Многочастное имя режется по ПЕРВОМУ двоеточию, и ничего не теряется.
  {
    const parsed = splitNamespace('Триеннале Сэто: Дом-проект: Кадоя')
    check('многочастное: внешняя коллекция', parsed.namespace, 'триеннале сето')
    check('многочастное: остаток целиком', parsed.local, 'дом проект кадоя')
    check('многочастное: full цел', parsed.full, 'триеннале сето дом проект кадоя')
  }

  // ── 1–3. Разные объекты одной коллекции — не дубли ────────────────────
  checkMatch('1. Kadoya ≠ Kinza', 'Art House Project: Kadoya', 'Art House Project: Kinza', false)
  checkMatch("2. Go'o Shrine ≠ Kadoya", "Art House Project: Go'o Shrine", 'Art House Project: Kadoya', false)
  checkMatch('3. Кадоя ≠ Киндза', 'Дом-проект: Кадоя', 'Дом-проект: Киндза', false)
  // Вторая, независимая коллекция в том же снимке: правило структурное.
  checkMatch('зоны Этиго-Цумари тоже разводятся', 'Этиго-Цумари: Мацунояма', 'Этиго-Цумари: Мацудай', false)

  // ── 4. Настоящий дубль внутри коллекции остаётся дублем ───────────────
  check('4. два точных имени', score('Art House Project: Kadoya', 'Art House Project: Kadoya'), 1)
  checkMatch('4. и по-русски', 'Дом-проект: Кадоя', 'Дом-проект: Кадоя', true)

  // ── 5. Уточнение места не имеет права прятать дубль ───────────────────
  // Было 0,6087 — ниже порога показа, то есть запись создавалась вторично
  // и молча. Стало 0,85: показать — да, заблокировать одним лишь именем —
  // никогда; разводит пару расстояние.
  checkMatch('5. Kadoya = Kadoya (Naoshima)', 'Art House Project: Kadoya', 'Art House Project: Kadoya (Naoshima)', true)
  check('5. но само имя не блокирует',
    score('Art House Project: Kadoya', 'Art House Project: Kadoya (Naoshima)') < 0.9, true)
  checkMatch('5. и по-русски', 'Дом-проект: Кадоя', 'Дом-проект: Кадоя (Наосима)', true)
  // Правило живёт в общем сравнении, а не в слое коллекции: имя без
  // двоеточия обязано вести себя так же.
  checkMatch('уточнение работает и без коллекции', 'Кадоя', 'Кадоя (Наосима)', true)

  // ── 6–8. Что мы знаем о равенстве коллекций ───────────────────────────
  check('6. перевод и чужая коллекция строкой неразличимы',
    collectionEvidence('Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya'), 'unverified')
  check('6. и перевод собственной коллекции — тоже',
    collectionEvidence('Дом-проект: Кадоя', 'Art House Project: Kadoya'), 'unverified')
  // Транслитерация — единственное принимаемое доказательство равенства.
  check('доказательство транслитерацией засчитывается',
    collectionEvidence('Этиго-Цумари: Мацудай', 'Echigo-Tsumari: Matsudai'), 'same')
  // 'compared' больше нет: модель обязана различать «равны» и «сравнимы,
  // но различаются», иначе вывод «разные» приходится доставать из общего
  // веса в другом слое, а вес считается по ЛУЧШЕЙ оси.
  check('одинаковые коллекции — доказанное равенство',
    collectionEvidence('Дом-проект: Кадоя', 'Дом-проект: Киндза'), 'same')
  check('сравнимые и различающиеся коллекции',
    collectionEvidence('Дом-проект: Кадоя', 'Этиго-Цумари: Кадоя'), 'different')
  check('без коллекции правило не работает', collectionEvidence('Кадоя', 'Киндза'), 'none')
  // 7. Один объект в двух РАЗНЫХ русских коллекциях — не дубль.
  checkMatch('7. один объект, разные коллекции', 'Дом-проект: Кадоя', 'Этиго-Цумари: Кадоя', false)
  // 8. Один объект в действительно одинаковых коллекциях — дубль.
  checkMatch('8. один объект, одна коллекция', 'Дом-проект: Кадоя', 'Дом-проект: Кадоя', true)
  checkMatch('8. и через доказанную транслитерацией коллекцию',
    'Этиго-Цумари: Мацудай', 'Echigo-Tsumari: Matsudai', true)
  // Коллекция названа почти так же — вопрос к владельцу, а не решение.
  checkMatch('похожие коллекции, тот же объект', 'Дом-проект: Кадоя', 'Арт-дом-проект: Кадоя', true)
  // Недоказанное равенство коллекций само по себе НЕ блокирует.
  check('недоказанная коллекция не даёт блокирующего веса',
    score('Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya') < 0.9, true)
  checkMatch('разные объекты через алфавиты', 'Дом-проект: Кадоя', 'Art House Project: Kinza', false)

  // Замер на локальном снимке 11.08.2026 (состав полей ограничен):
  // распространение правила на односторонний случай поднимало эту пару
  // с 0,3448 до 0,75, а музей стоит внутри зоны.
  checkMatch('музей внутри зоны — не объект зоны', 'Исторический музей Мацудая', 'Этиго-Цумари: Мацудай', false)

  // ── 10. Имена без двоеточия — прежние результаты ──────────────────────
  // Веса зафиксированы по HEAD 40ccb0e. Слой коллекции обязан быть
  // невидимым для имён, которые коллекцию не объявляют.
  for (const [a, b, expected] of [
    ['Храм Токэйдзи', 'Tōkei-ji Temple', 0.85],
    ['Художественный музей Пола', 'Художественный музей Хаконе', 0],
    ['Канатная дорога Хаконе', 'Ботанический сад Хаконе', 0],
    ['Храм Тодайдзи', 'Храм Тосёдайдзи', 0.7],
    ['Todai-ji Temple', 'Todaiji', 0.85],
    ['Toyosu Market', 'Toyosu', 0.85],
    ['Fushimi Inari Taisha', 'Fushimi Inari Shrine', 1],
    ['Роппонги', 'Роппонги Хиллз', 0.75],
    ['Тоёсу (район)', 'Рыбный рынок Тоёсу', 0.3333],
    ['Музей нэбута «Ва-Рассэ»', 'Музей Небута Ва Рассэ', 1],
  ]) {
    check(`10. без двоеточия неизменно: «${a}» ⟷ «${b}»`, score(a, b), expected)
  }
}

// ── Коллекция на уровне гейта ───────────────────────────────────────────
//
// Правка обязана действовать в screenNewPoi, а не только в отчёте
// целостности: через этот же гейт идёт настоящий приём.
{
  const AT = { lat: 34.4622, lon: 134.0322 }
  const M122 = { lat: 34.4633, lon: 134.0322 }
  const M3 = { lat: 34.46222, lon: 134.03222 }
  const rec = (poiId, nameRu, nameEn, geo = AT) => ({ poiId, nameRu, nameEn, siteCity: 'naoshima', ...geo })
  const verdictOf = (input, base) => screenNewPoi(input, base).verdict

  check('расстояние в фикстуре именно 122 м', Math.round(haversineMeters(AT, M122)), 122)

  const kadoya = [rec('POI-000561', '', 'Art House Project: Kadoya')]

  // 1–3. Соседние объекты коллекции в 122 м — законные отдельные записи.
  check('1. Kinza рядом с Kadoya не блокируется',
    verdictOf({ nameRu: '', nameEn: 'Art House Project: Kinza', siteCity: 'naoshima', ...M122 }, kadoya) !== 'blocked_duplicate', true)
  check("2. Go'o Shrine рядом с Kadoya не блокируется",
    verdictOf({ nameRu: '', nameEn: "Art House Project: Go'o Shrine", siteCity: 'naoshima', ...M122 }, kadoya) !== 'blocked_duplicate', true)
  check('3. Киндза рядом с Кадоя не блокируется',
    verdictOf({ nameRu: 'Дом-проект: Киндза', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', '')]) !== 'blocked_duplicate', true)

  // 4. Повторный завод того же объекта блокируется обоими путями.
  check('4. повтор в трёх метрах блокируется',
    verdictOf({ nameRu: '', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...M3 }, kadoya),
    'blocked_duplicate')
  check('4. и без координат, по имени и городу',
    verdictOf({ nameRu: '', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
      [{ poiId: 'POI-000561', nameRu: '', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' }]),
    'blocked_duplicate')

  // 5. Настоящий дубль с уточнением места. С координатами их разводит
  // расстояние — 122 м это одна точка, и вердикт терминальный. Без
  // координат остаётся 'needs_review', который по действующему контракту
  // ОСТАНАВЛИВАЕТ создание (см. tests/poi-ingest.mjs, межалфавитная пара):
  // то есть дубль в обоих случаях не проходит молча.
  check('5. дубль с уточнением места в 122 м блокируется',
    verdictOf({ nameRu: '', nameEn: 'Art House Project: Kadoya (Naoshima)', siteCity: 'naoshima', ...M122 }, kadoya),
    'blocked_duplicate')
  // Русская постановка того же случая. Она проходит через ветку
  // «скобочное уточнение городом» в гейте: без неё пара уезжает
  // в «часть — целое» и дубль исчезает из разбора.
  check('5. дубль с уточнением места, русские имена',
    verdictOf({ nameRu: 'Дом-проект: Кадоя (Наосима)', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', '')]),
    'blocked_duplicate')
  check('5. без координат — остановка, а не пропуск',
    verdictOf({ nameRu: '', nameEn: 'Art House Project: Kadoya (Naoshima)', siteCity: 'naoshima' },
      [{ poiId: 'POI-000561', nameRu: '', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' }]),
    'needs_review')

  // 6. Разные коллекции через разные алфавиты. Совпал только объект —
  // это половина свидетельства, и блокировать ею нельзя. Но и промолчать
  // нельзя: пара уходит владельцу.
  const foreign = screenNewPoi(
    { nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...M122 },
    [rec('POI-000900', '', 'Echigo-Tsumari: Kadoya')],
  )
  check('6. чужая коллекция в 122 м не блокируется', foreign.verdict !== 'blocked_duplicate', true)
  check('6. но и не проходит молча', foreign.verdict, 'needs_review')
  check('6. пара показана владельцу', foreign.unverifiedCollection[0]?.candidate.poiId, 'POI-000900')
  check('6. и не попала в дубли', foreign.duplicates.length, 0)

  // 7. Один объект в двух разных русских коллекциях — не дубль.
  check('7. разные русские коллекции не блокируются',
    verdictOf({ nameRu: 'Этиго-Цумари: Кадоя', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', '')]) !== 'blocked_duplicate', true)

  // 8. Один объект в действительно одной коллекции — дубль.
  check('8. одна коллекция, один объект — блок',
    verdictOf({ nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', '')]),
    'blocked_duplicate')
  check('8. коллекция, доказанная транслитерацией, блокирует',
    verdictOf({ nameRu: 'Этиго-Цумари: Мацудай', siteCity: 'tokamachi', ...M122 },
      [{ poiId: 'POI-000541', nameRu: '', nameEn: 'Echigo-Tsumari: Matsudai', siteCity: 'tokamachi', ...AT }]),
    'blocked_duplicate')

  // 11. Ребёнок и родитель — отношение «часть — целое», не дубль.
  const child = screenNewPoi(
    { nameRu: 'Дом-проект: Гокайсё', nameEn: 'Art House Project: Gokaisho', siteCity: 'naoshima' },
    [{ poiId: 'POI-000566', nameRu: 'Дом-проект', nameEn: 'Art House Project', siteCity: 'naoshima' }],
  )
  check('11. родитель коллекции — не дубль объекта', child.verdict, 'clear')
  check('11. и он предложен как родитель', child.reasons.join(' ').includes('POI-000566'), true)
  const parent = screenNewPoi(
    { nameRu: 'Дом-проект', nameEn: 'Art House Project', siteCity: 'naoshima' },
    [{ poiId: 'POI-000564', nameRu: 'Дом-проект: Гокайсё', nameEn: 'Art House Project: Gokaisho', siteCity: 'naoshima' }],
  )
  check('11. и в обратную сторону тоже', parent.verdict, 'clear')
}


// ── Уточнение в скобках: четыре состояния, и «разные» среди них нет ──────
//
// Прошлая версия объявляла расходящиеся уточнения доказанным различием.
// Предпосылка неверна: у матчера нет provenance имени — скобку мог написать
// портал, файл имён, транслитерация или модель. Воспроизведённая цена:
//   «Art House Project: Kadoya (East)» ⟷ «…(Восток)»       0,4250 → clear
//   «Храм Риннодзи (Главный корпус)»  ⟷ «…(Main Hall)»     0,4186 → clear
// Оба раза это, возможно, один объект с переведённым уточнением, и гейт
// пропускал его молча: вес ниже порога показа, а «различие» считалось
// доказанным.
{
  const score = (a, b) => nameSimilarity(a, b)
  check('уточнение с одной стороны', qualifierRelation('Кадоя', 'Кадоя (Наосима)'), 'one_sided')
  check('уточнения совпали посимвольно', qualifierRelation('Кадоя (Наосима)', 'Кадоя (Наосима)'), 'agree')
  // Доказательство равенства — существующий механизм транслитерации,
  // а не список переводов: «Замок Аоба» и «Аоба» дают скелет aoba.
  check('равенство доказано транслитерацией',
    qualifierRelation('Руины замка Сендай (Замок Аоба)', 'Руины замка Сэндай (Аоба)'), 'agree')
  check('и через алфавиты тоже', qualifierRelation('Кадоя (Наосима)', 'Кадоя (Naoshima)'), 'agree')

  // ПЕРЕВЕДЁННОЕ уточнение — не различие.
  check('перевод уточнения не доказывает различие',
    qualifierRelation('Art House Project: Kadoya (East)', 'Art House Project: Kadoya (Восток)'), 'unverified')
  check('и в другой паре тоже',
    qualifierRelation('Храм Риннодзи (Главный корпус)', 'Храм Риннодзи (Main Hall)'), 'unverified')
  // РАЗНЫЕ строки — тоже не различие: доказывать нечем.
  check('East/West не объявляются доказанно разными',
    qualifierRelation('Art House Project: Kadoya (East)', 'Art House Project: Kadoya (West)'), 'unverified')
  check('Восток/Запад тоже',
    qualifierRelation('Дом-проект: Кадоя (Восток)', 'Дом-проект: Кадоя (Запад)'), 'unverified')
  check('города-различители тоже',
    qualifierRelation('Храм Риннодзи (Сэндай)', 'Храм Риннодзи (Никко)'), 'unverified')
  check('разные основы — уточнения ни при чём',
    qualifierRelation('Кадоя (Наосима)', 'Киндза (Наосима)'), 'none')

  // Подъём до 0,85 остаётся только у доказанных состояний.
  check('одностороннее поднимается', score('Art House Project: Kadoya', 'Art House Project: Kadoya (Naoshima)'), 0.85)
  checkMatch('дубль с доказанным уточнением', 'Руины замка Сендай (Замок Аоба)', 'Руины замка Сэндай (Аоба)', true)
  // Ключевое: вес непроверенной пары НИЖЕ порога показа. Именно поэтому
  // канал не может зависеть от веса.
  check('непроверенная пара весит меньше порога показа',
    score('Art House Project: Kadoya (East)', 'Art House Project: Kadoya (Восток)') < 0.72, true)
}

// ── Письменность: не «кириллица или всё остальное» ──────────────────────
//
// Бинарный helper объявлял латиницей любой некириллический текст. Порталы
// принесут японские строки, и «東大寺» было бы сравнено с «Todaiji» как
// однописьменная пара.
{
  check('латиница', nameScript('Art House Project'), 'latin')
  check('кириллица', nameScript('Дом-проект'), 'cyrillic')
  check('иероглифы', nameScript('東大寺'), 'japanese')
  check('хирагана', nameScript('とうだいじ'), 'japanese')
  check('катакана', nameScript('ナオシマ'), 'japanese')
  check('смешанная строка названа смешанной', nameScript('teamLab Planets (Тоёсу)'), 'mixed')
  check('строка без букв', nameScript('2026'), 'none')
  // Японская коллекция не выдаётся за латинскую: сравнить её нечем,
  // и вывод — «неизвестно», а не «сравнимы».
  check('японская коллекция не объявляется сравнимой с латинской',
    collectionEvidence('東大寺: 南大門', 'Todaiji: Nandaimon'), 'unverified')
}

// ── Уточнения на уровне гейта ───────────────────────────────────────────
{
  const AT = { lat: 34.4622, lon: 134.0322 }
  const M122 = { lat: 34.4633, lon: 134.0322 }
  const M3 = { lat: 34.46222, lon: 134.03222 }
  const FAR = { lat: 37.15, lon: 138.75 }
  const en = (poiId, nameEn, geo) => ({ poiId, nameRu: '', nameEn, siteCity: 'naoshima', ...geo })
  const at = (nameEn, geo) => ({ nameRu: '', nameEn, siteCity: 'naoshima', ...geo })

  // Доказанные состояния ведут себя как раньше.
  check('без уточнения ⟷ (Naoshima), близко — блокируется',
    screenNewPoi(at('Art House Project: Kadoya (Naoshima)', M122),
      [en('POI-000561', 'Art House Project: Kadoya', AT)]).verdict,
    'blocked_duplicate')
  check('то же без координат — остановка',
    screenNewPoi({ nameRu: '', nameEn: 'Art House Project: Kadoya (Naoshima)', siteCity: 'naoshima' },
      [{ poiId: 'POI-000561', nameRu: '', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' }]).verdict,
    'needs_review')
  check('(Naoshima) ⟷ (Naoshima) — дубль',
    screenNewPoi(at('Art House Project: Kadoya (Naoshima)', M3),
      [en('POI-000561', 'Art House Project: Kadoya (Naoshima)', AT)]).verdict,
    'blocked_duplicate')

  // ГЛАВНЫЙ СЛУЧАЙ. Переведённое уточнение в 122 метрах.
  const translated = screenNewPoi(at('Art House Project: Kadoya (Восток)', M122),
    [en('POI-000561', 'Art House Project: Kadoya (East)', AT)])
  check('(East) ⟷ (Восток) в 122 м — остановка, а не тишина', translated.verdict, 'needs_review')
  check('и пара попала в отдельный канал', translated.unverifiedQualifier[0]?.candidate.poiId, 'POI-000561')
  check('и это при весе НИЖЕ порога показа',
    translated.unverifiedQualifier[0]?.score < 0.72, true)
  check('и причина названа', translated.reasons.join(' ').includes('уточнения в скобках'), true)
  check('и в дубли она не попала', translated.duplicates.length, 0)

  // Русско-английская пара «Главный корпус» / «Main Hall» — тот же класс.
  check('переведённое уточнение в другой паре — тоже остановка',
    screenNewPoi({ nameRu: 'Храм Риннодзи (Главный корпус)', siteCity: 'sendai', ...M122 },
      [{ poiId: 'POI-000471', nameRu: 'Храм Риннодзи (Main Hall)', siteCity: 'sendai', ...AT }]).verdict,
    'needs_review')

  // East/West без структурированного доказательства — тот же исход.
  // Раньше он объявлялся доказанно разным и уходил в clear.
  check('(East) ⟷ (West) не объявляется доказанно разной парой',
    screenNewPoi(at('Art House Project: Kadoya (West)', M122),
      [en('POI-000561', 'Art House Project: Kadoya (East)', AT)]).verdict,
    'needs_review')
  check('(Сэндай) ⟷ (Никко) без координат — тоже вопрос владельцу',
    screenNewPoi({ nameRu: 'Храм Риннодзи (Сэндай)', siteCity: 'sendai' },
      [{ poiId: 'POI-000219', nameRu: 'Храм Риннодзи (Никко)', siteCity: 'nikko' }]).verdict,
    'needs_review')

  // Расстояние опровергает и эту гипотезу — через существующий канал.
  const far = screenNewPoi(at('Art House Project: Kadoya (Восток)', FAR),
    [en('POI-000561', 'Art House Project: Kadoya (East)', AT)])
  check('дальше GEO_DIFFERENT_PLACE_M — приём не останавливается', far.verdict, 'clear')
  check('и опровержение наблюдаемо', far.geoRefutedDuplicate?.candidate.poiId, 'POI-000561')
  check('и вопрос снят', far.unverifiedQualifier.length, 0)

  // РЕГРЕССИЯ ПОРЯДКА: далёкая непроверенная пара не прячет близкий дубль.
  const both = screenNewPoi(at('Art House Project: Kadoya (Восток)', FAR), [
    en('POI-000561', 'Art House Project: Kadoya (East)', AT),
    { poiId: 'POI-000562', nameRu: '', nameEn: 'Art House Project: Kadoya (Восток)', siteCity: 'naoshima', lat: 37.1501, lon: 138.75 },
  ])
  check('близкий настоящий дубль не спрятан', both.verdict, 'blocked_duplicate')
  check('и заблокировал именно он', both.blockingDuplicate?.candidate.poiId, 'POI-000562')
  check('а далёкая пара осталась видимой', both.geoRefutedDuplicate?.candidate.poiId, 'POI-000561')
}

// ── Язык коллекции определяется по namespace, а не по всему имени ───────
//
// Алфавит объекта и алфавит коллекции независимы. Раньше сравнимость
// считалась по полному имени, и две ЛАТИНСКИЕ коллекции объявлялись
// несравнимыми только потому, что у одной записи объект написан по-русски.
{
  check('обе коллекции латинские — сравнимы и различаются',
    collectionEvidence('Art House Project: Кадоя', 'Echigo-Tsumari: Kadoya'), 'different')
  check('и вес это показывает', nameSimilarity('Art House Project: Кадоя', 'Echigo-Tsumari: Kadoya'), 0)
  check('обе коллекции кириллические — сравнимы и различаются',
    collectionEvidence('Дом-проект: Kadoya', 'Этиго-Цумари: Kadoya'), 'different')
  check('и вес это показывает', nameSimilarity('Дом-проект: Kadoya', 'Этиго-Цумари: Kadoya'), 0)
  // Транслитерация доказывает равенство независимо от алфавита объекта.
  check('коллекции сходятся транслитерацией при разных алфавитах объекта',
    collectionEvidence('Этиго-Цумари: Matsudai', 'Echigo-Tsumari: Мацудай'), 'same')
  checkMatch('и это дубль', 'Этиго-Цумари: Matsudai', 'Echigo-Tsumari: Мацудай', true)
  // Перевод строкой равенства не доказывает — и не опровергает.
  check('перевод остаётся недоказанным',
    collectionEvidence('Дом-проект: Кадоя', 'Art House Project: Kadoya'), 'unverified')
}

// ── Расстояние опровергает и недоказанную коллекцию ─────────────────────
//
// Недоказанное равенство коллекций — вопрос об ИМЕНАХ. Расстояние отвечает
// на вопрос о МЕСТЕ, и этот ответ сильнее: за пределами GEO_DIFFERENT_PLACE_M
// тождество физического объекта опровергнуто, сколько бы ни спорили имена.
// Держать такую пару остановкой значит спрашивать о том, на что ответ есть.
{
  const AT = { lat: 34.4622, lon: 134.0322 }
  const M122 = { lat: 34.4633, lon: 134.0322 }
  const FAR = { lat: 37.15, lon: 138.75 }
  const foreign = (geo) =>
    screenNewPoi({ nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...geo },
      [{ poiId: 'POI-000900', nameRu: '', nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'tokamachi', ...AT }])

  const near = foreign(M122)
  check('близкая недоказанная пара останавливает приём', near.verdict, 'needs_review')
  check('и показана как недоказанная', near.unverifiedCollection.length, 1)

  const far = foreign(FAR)
  check('далёкая недоказанная пара приём НЕ останавливает', far.verdict, 'clear')
  check('но причина опровержения наблюдаема', far.geoRefutedDuplicate?.candidate.poiId, 'POI-000900')
  check('и она про расстояние', far.reasons.join(' ').includes('км'), true)
  check('и она больше не висит вопросом', far.unverifiedCollection.length, 0)

  // РЕГРЕССИЯ ПОРЯДКА: далёкая недоказанная пара не должна закрыть собой
  // близкий настоящий дубль. Ровно этим 11.08.2026 болела ветка опровержения
  // расстоянием, и повторять это на новой ветке нельзя.
  const both = screenNewPoi({ nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...FAR }, [
    { poiId: 'POI-000900', nameRu: '', nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'tokamachi', ...AT },
    { poiId: 'POI-000561', nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', lat: 37.1501, lon: 138.75 },
  ])
  check('близкий настоящий дубль не спрятан', both.verdict, 'blocked_duplicate')
  check('и заблокировал именно он', both.blockingDuplicate?.candidate.poiId, 'POI-000561')
  check('а далёкая пара осталась видимой', both.geoRefutedDuplicate?.candidate.poiId, 'POI-000900')
}

// ── Свидетельство всех осей, а не только победившей ─────────────────────
//
// Вес считается по ЛУЧШЕЙ паре имён. Пока отношение коллекций и уточнений
// хранилось тоже только от неё, одно сильное совпадение стирало
// противоречие на второй оси. Воспроизведено исполнением:
//   RU одинаковы, EN «Minamidera (West)» / «(East)» → ru↔ru, вес 1,
//     qualifier = none, verdict = blocked_duplicate;
//   RU одинаковы, EN «Art House Project: Kadoya» / «Echigo-Tsumari: Kadoya»
//     → ru↔ru, вес 1, collection = compared, verdict = blocked_duplicate.
// В обоих случаях английское противоречие исчезало целиком.
{
  const AT = { lat: 34.4622, lon: 134.0322 }
  const M122 = { lat: 34.4633, lon: 134.0322 }
  const FAR = { lat: 37.15, lon: 138.75 }
  const rec = (poiId, nameRu, nameEn, geo) => ({ poiId, nameRu, nameEn, siteCity: 'naoshima', ...geo })

  // ── Контракт осей ────────────────────────────────────────────────────
  // ru↔ru и en↔en — независимые выровненные оси, когда обе стороны
  // заполнены. Межалфавитные пары — fallback, а не четвёртый голос.
  const bothFilled = matchPoi(
    { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...M122 },
    [rec('POI-000561', 'Дом-проект: Кадоя', 'Art House Project: Kadoya', AT)],
  )[0]
  check('обе стороны заполнены — две выровненные оси', bothFilled.evidence.length, 2)
  check('и ни одной межалфавитной',
    bothFilled.evidence.every((e) => e.axis === 'ru' || e.axis === 'en'), true)
  const halfFilled = matchPoi(
    { nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...M122 },
    [rec('POI-000900', '', 'Echigo-Tsumari: Kadoya', AT)],
  )[0]
  check('выровненной оси нет — работает межалфавитный fallback',
    halfFilled.evidence.every((e) => e.axis === 'cross'), true)
  check('и он ровно один', halfFilled.evidence.length, 1)

  // 1. RU одинаковы, EN расходятся уточнениями.
  const q = screenNewPoi(
    { nameRu: 'Дом-проект: Минамидэра', nameEn: 'Art House Project: Minamidera (West)', siteCity: 'naoshima', ...M122 },
    [rec('POI-000561', 'Дом-проект: Минамидэра', 'Art House Project: Minamidera (East)', AT)],
  )
  check('1. конфликт уточнений на второй оси не блокирует', q.verdict, 'needs_review')
  check('1. и пара показана', q.unverifiedQualifier[0]?.candidate.poiId, 'POI-000561')
  check('1. и в дубли не попала', q.duplicates.length, 0)
  // 5. Свидетельство пришло НЕ от пары с максимальным весом.
  check('5. вес набран по ru↔ru', q.unverifiedQualifier[0]?.basis, 'ru↔ru')
  check('5. а расходится en↔en',
    q.unverifiedQualifier[0]?.issues[0]?.basis, 'en↔en')
  check('5. и обе оси названы в причине',
    q.reasons.join(' ').includes('по оси ru↔ru') && q.reasons.join(' ').includes('расходится ось en↔en'), true)

  // 2. RU одинаковы, EN относят записи к разным коллекциям.
  const c = screenNewPoi(
    { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...M122 },
    [rec('POI-000562', 'Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya', AT)],
  )
  check('2. конфликт коллекций на второй оси не блокирует', c.verdict, 'needs_review')
  check('2. и пара показана', c.conflictingCollection[0]?.candidate.poiId, 'POI-000562')
  check('2. и в дубли не попала', c.duplicates.length, 0)
  check('2. расхождение названо коллекцией, а не уточнением',
    c.conflictingCollection[0]?.issues[0]?.kind, 'collection_conflict')

  // 3. Обе оси согласны — прежняя блокировка сохраняется.
  check('3. согласные оси блокируются как раньше',
    screenNewPoi(
      { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', 'Art House Project: Kadoya', AT)],
    ).verdict,
    'blocked_duplicate')

  // 4. Заполнено только RU — поведение не изменилось.
  check('4. только RU, имена совпали — блокировка',
    screenNewPoi(
      { nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima', ...M122 },
      [rec('POI-000561', 'Дом-проект: Кадоя', '', AT)],
    ).verdict,
    'blocked_duplicate')
  check('4. и без координат — тот же исход, что и был',
    screenNewPoi(
      { nameRu: 'Дом-проект: Кадоя', siteCity: 'naoshima' },
      [{ poiId: 'POI-000561', nameRu: 'Дом-проект: Кадоя', nameEn: '', siteCity: 'naoshima' }],
    ).verdict,
    'blocked_duplicate')

  // 6. Расстояние опровергает и конфликт осей.
  const far = screenNewPoi(
    { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...FAR },
    [rec('POI-000562', 'Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya', AT)],
  )
  check('6. дальше GEO_DIFFERENT_PLACE_M конфликт снят', far.verdict, 'clear')
  check('6. и опровержение наблюдаемо', far.geoRefutedDuplicate?.candidate.poiId, 'POI-000562')
  check('6. и вопрос больше не висит', far.conflictingCollection.length, 0)

  // 7. Конфликтующий кандидат не прячет второй настоящий дубль.
  const both = screenNewPoi(
    { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...M122 },
    [
      rec('POI-000562', 'Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya', AT),
      rec('POI-000561', 'Дом-проект: Кадоя', 'Art House Project: Kadoya', { lat: 34.46335, lon: 134.0322 }),
    ],
  )
  check('7. настоящий дубль не спрятан конфликтующим кандидатом', both.verdict, 'blocked_duplicate')
  check('7. и заблокировал именно он', both.blockingDuplicate?.candidate.poiId, 'POI-000561')
  check('7. а конфликтующий остался видимым', both.conflictingCollection[0]?.candidate.poiId, 'POI-000562')
}

// ── Составное расхождение: видов несколько, и ни один не отменяет другие ─
//
// Виды расхождений не взаимоисключающие. Пока у каждого была своя ветка
// с `continue`, разбор останавливался на первом найденном:
//   RU «Кадоя (Восток)» ⟷ «Кадоя (Запад)»            уточнения не сверены
//   EN «Art House Project: Kadoya» ⟷ «Echigo-Tsumari: Kadoya»  коллекции разные
// В отчёт уходило только уточнение, разные коллекции не упоминались нигде.
{
  const AT = { lat: 34.4622, lon: 134.0322 }
  const M122 = { lat: 34.4633, lon: 134.0322 }
  const FAR = { lat: 37.15, lon: 138.75 }
  const composite = (geo) => ({
    nameRu: 'Дом-проект: Кадоя (Восток)', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima', ...geo,
  })
  const other = (poiId, geo) => ({
    poiId, nameRu: 'Дом-проект: Кадоя (Запад)', nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'naoshima', ...geo,
  })

  // 1. Оба вида одновременно.
  const near = screenNewPoi(composite(M122), [other('POI-000562', AT)])
  check('составная пара останавливает приём', near.verdict, 'needs_review')
  check('вид «уточнения» наблюдаем', near.unverifiedQualifier.length, 1)
  check('вид «коллекции разные» наблюдаем тоже', near.conflictingCollection.length, 1)
  check('это один и тот же кандидат',
    near.unverifiedQualifier[0]?.candidate.poiId === near.conflictingCollection[0]?.candidate.poiId, true)
  check('и он один в едином канале', near.identityIssues.length, 1)
  check('с обоими видами сразу', near.identityIssues[0]?.issues.length, 2)
  check('виды названы типами',
    near.identityIssues[0]?.issues.map((i) => i.kind).sort().join(','),
    'collection_conflict,qualifier_unverified')
  check('в дубли не попал', near.duplicates.length, 0)
  // Обе причины перечисляют ОБА расхождения, а не только своё.
  check('причина про уточнения помнит про коллекции',
    near.reasons.some((r) => r.includes('уточнения в скобках не сверены') && r.includes('коллекции разные')), true)
  check('и наоборот',
    near.reasons.filter((r) => r.includes('коллекции разные')).length >= 1, true)

  // 3. Та же пара далеко: расстояние снимает ОБА вопроса разом.
  const far = screenNewPoi(composite(FAR), [other('POI-000562', AT)])
  check('составная пара дальше GEO_DIFFERENT_PLACE_M не останавливает', far.verdict, 'clear')
  check('и опровержение наблюдаемо', far.geoRefutedDuplicate?.candidate.poiId, 'POI-000562')
  check('вопрос про уточнения снят', far.unverifiedQualifier.length, 0)
  check('вопрос про коллекции снят тоже', far.conflictingCollection.length, 0)
  check('и единый канал пуст', far.identityIssues.length, 0)

  // 4. Составной конфликт не прячет второй настоящий дубль.
  const both = screenNewPoi(composite(M122), [
    other('POI-000562', AT),
    { poiId: 'POI-000561', nameRu: 'Дом-проект: Кадоя (Восток)', nameEn: 'Art House Project: Kadoya',
      siteCity: 'naoshima', lat: 34.46335, lon: 134.0322 },
  ])
  check('настоящий дубль не спрятан составным конфликтом', both.verdict, 'blocked_duplicate')
  check('и заблокировал именно он', both.blockingDuplicate?.candidate.poiId, 'POI-000561')
  check('а составной конфликт остался в отчёте', both.identityIssues[0]?.candidate.poiId, 'POI-000562')
  check('с обоими видами', both.identityIssues[0]?.issues.length, 2)
}

// ── Родитель: контракт идентичности действует и здесь ───────────────────
//
// Разрешение родителя — второй потребитель matchPoi, и он фильтровал
// кандидатов ТОЛЬКО по весу. Кандидат «Дом-проект: Кадоя» / «Echigo-Tsumari:
// Kadoya» набирал 1 по русскому имени и молча становился Parent POI, хотя
// гейт дублей такую же пару уже не пропускал.
{
  const child = { nameRu: 'Новый отдельный объект', nameEn: 'New Separate Object', siteCity: 'naoshima' }
  const ask = { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya' }
  const conflicting = {
    poiId: 'PARENT-WRONG', recordId: 'recParentWrong',
    nameRu: 'Дом-проект: Кадоя', nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'naoshima',
  }
  const clean = {
    poiId: 'PARENT-OK', recordId: 'recParentOk',
    nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima',
  }

  // 1. Единственный кандидат — конфликтный. Привязки нет, но и «родителя
  //    нет» тоже не говорим: пустые parent и parentAmbiguous заставили бы
  //    приём завести заглушку.
  const wrong = screenNewPoi(child, [conflicting], ask)
  check('конфликтный кандидат не становится родителем', wrong.parent, null)
  check('он остаётся наблюдаемым', wrong.parentIdentityIssues[0]?.candidate.poiId, 'PARENT-WRONG')
  check('и это не неоднозначность', wrong.parentAmbiguous.length, 0)
  check('причина названа', wrong.reasons.some((r) => r.includes('поля имён не согласованы')), true)
  check('и вид расхождения тоже',
    wrong.reasons.some((r) => r.includes('коллекции разные')), true)

  // 2. Один чистый и один конфликтный: связывается чистый, конфликт остаётся
  //    предупреждением, и текст НЕ утверждает, что родитель не проставлен.
  const mixed = screenNewPoi(child, [clean, conflicting], ask)
  check('чистый кандидат связывается', mixed.parent?.candidate.poiId, 'PARENT-OK')
  check('конфликтный сохранён отдельно', mixed.parentIdentityIssues[0]?.candidate.poiId, 'PARENT-WRONG')
  check('текст не врёт про непроставленного родителя',
    mixed.reasons.some((r) => r.includes('Родитель не проставлен')), false)
  check('но про спорного кандидата говорит',
    mixed.reasons.some((r) => r.includes('PARENT-WRONG')), true)

  // 3. Два близких чистых кандидата — прежняя неоднозначность.
  const twins = screenNewPoi(child, [
    clean,
    { poiId: 'PARENT-TWIN', recordId: 'recTwin', nameRu: 'Дом-проект: Кадоя',
      nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
  ], ask)
  check('два близких чистых кандидата не связываются', twins.parent, null)
  check('и это именно неоднозначность', twins.parentAmbiguous.length, 2)
  check('а не расхождение идентичности', twins.parentIdentityIssues.length, 0)

  // 4. Один чистый кандидат — прежняя автоматическая привязка.
  check('единственный чистый кандидат связывается',
    screenNewPoi(child, [clean], ask).parent?.candidate.poiId, 'PARENT-OK')

  // 5. Составной кандидат сохраняет ОБА вида и в родительском канале.
  const composite = screenNewPoi(
    child,
    [{ poiId: 'PARENT-BOTH', recordId: 'recBoth', nameRu: 'Дом-проект: Кадоя (Запад)',
       nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'naoshima' }],
    { nameRu: 'Дом-проект: Кадоя (Восток)', nameEn: 'Art House Project: Kadoya' },
  )
  check('составной кандидат в родители не связывается', composite.parent, null)
  check('и несёт оба вида расхождения',
    composite.parentIdentityIssues[0]?.issues.map((i) => i.kind).sort().join(','),
    'collection_conflict,qualifier_unverified')
}

// ── Итог ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ провалено ${failures.length} из ${passed + failures.length}\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exitCode = 1
} else {
  console.log(`✓ матчер POI: ${passed} проверок пройдено`)
}
