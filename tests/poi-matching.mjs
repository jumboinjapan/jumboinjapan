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
  romajiSkeleton,
  containmentRelation,
  haversineMeters,
  screenNewPoi,
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

// ── Итог ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ провалено ${failures.length} из ${passed + failures.length}\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exitCode = 1
} else {
  console.log(`✓ матчер POI: ${passed} проверок пройдено`)
}
