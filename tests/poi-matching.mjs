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
  splitName,
  skeletonMatch,
  MATCHER_POLICY,
  MATCHER_LEXICON,
  matcherLexiconDigest,
  MATCHER_POLICY_SPEC,
  MATCHER_POLICY_VERSION,
  matcherPolicyDigest,
  DUPLICATE_BLOCK,
  DUPLICATE_REVIEW,
  PARENT_MIN,
  GEO_SAME_PLACE_M,
  GEO_DIFFERENT_PLACE_M,
  GEO_NEIGHBOUR_M,
} from '../src/lib/poi-matching.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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

// ── Политика матчера: одна запись, версия и отпечаток (10f-P, P06.3) ─────
//
// Все пороги гейта и пакетного дедупа живут в MATCHER_POLICY. Отпечаток
// обязан меняться от ЛЮБОГО поля: порог, поправленный «на чуть-чуть» без
// новой версии, должен ронять eval по отпечатку, а не проходить молча.
{
  check('версия политики = спецификация', MATCHER_POLICY_VERSION, MATCHER_POLICY_SPEC)
  check('спецификация политики именована и версионирована', MATCHER_POLICY_SPEC, 'poi-matcher-policy/v3')
  check('политика заморожена', Object.isFrozen(MATCHER_POLICY), true)
  const base = matcherPolicyDigest()
  check('отпечаток политики — sha256', /^sha256:[0-9a-f]{64}$/.test(base), true)
  check('отпечаток детерминирован', matcherPolicyDigest(), base)
  for (const [key, value] of Object.entries(MATCHER_POLICY)) {
    const mutated = typeof value === 'number' ? value + 0.001 : `${value}-x`
    check(`отпечаток меняется от поля ${key}`, matcherPolicyDigest({ ...MATCHER_POLICY, [key]: mutated }) !== base, true)
  }
  let refused = ''
  try { matcherPolicyDigest({ ...MATCHER_POLICY, duplicateBlock: Number.NaN }) } catch (e) { refused = e.message }
  check('отпечаток отказывается от неконечного порога', refused.includes('не конечное число'), true)
  // Экспортируемые константы — представления политики, а не вторая запись.
  check('DUPLICATE_BLOCK читается из политики', DUPLICATE_BLOCK, MATCHER_POLICY.duplicateBlock)
  check('DUPLICATE_REVIEW читается из политики', DUPLICATE_REVIEW, MATCHER_POLICY.duplicateReview)
  check('PARENT_MIN читается из политики', PARENT_MIN, MATCHER_POLICY.parentMin)
  check('GEO_SAME_PLACE_M читается из политики', GEO_SAME_PLACE_M, MATCHER_POLICY.geoSamePlaceM)
  check('GEO_DIFFERENT_PLACE_M читается из политики', GEO_DIFFERENT_PLACE_M, MATCHER_POLICY.geoDifferentPlaceM)
  check('GEO_NEIGHBOUR_M читается из политики', GEO_NEIGHBOUR_M, MATCHER_POLICY.geoNeighbourM)
  // Сам матчер тоже: экспортные константы и потолок сходства — ссылки на
  // политику, а не числа рядом с ней (число совпало бы, и поведением этого
  // не поймать).
  const matcherSource = readFileSync(fileURLToPath(new URL('../src/lib/poi-matching.ts', import.meta.url)), 'utf8')
  const matcherCode = matcherSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('poi-matching.ts не присваивает порогам собственные числа',
    /\b(DUPLICATE_BLOCK|DUPLICATE_REVIEW|PARENT_MIN|GEO_SAME_PLACE_M|GEO_DIFFERENT_PLACE_M|GEO_NEIGHBOUR_M|SIMILARITY_CEILING)\s*=\s*[0-9.]+/.test(matcherCode), false)
  check('потолок сходства читается из политики', /const SIMILARITY_CEILING = MATCHER_POLICY\.similarityCeiling/.test(matcherCode), true)
  // Список имён здесь — не инвентарь (он ниже, по AST); это лишь проверка, что
  // каждое поле политики объявлено числом ровно один раз.
  const policyNumericKeys = Object.entries(MATCHER_POLICY).filter(([, v]) => typeof v === 'number').map(([k]) => k)
  check('каждое числовое поле политики объявлено литералом ровно один раз',
    policyNumericKeys.filter((k) => (matcherCode.match(new RegExp(`\\b${k}:\\s*[0-9][0-9_.]*`, 'g')) ?? []).length === 1).length,
    policyNumericKeys.length)
  // Пакетный дедуп — потребитель той же политики, а не владелец своих чисел.
  // Поведением это не поймать (число совпало бы), поэтому проверяется текст.
  const dedupeSource = readFileSync(fileURLToPath(new URL('../scripts/poi-portals/lib/dedupe.mjs', import.meta.url)), 'utf8')
  const code = dedupeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('dedupe.mjs импортирует MATCHER_POLICY', /import\s*\{[^}]*\bMATCHER_POLICY\b[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/lib\/poi-matching\.ts'/.test(code), true)
  check('dedupe.mjs не присваивает порогам собственные числа',
    /\b(COORD_SAME_M|COORD_NEAR_M|NAME_STRONG|NAME_WEAK)\s*=\s*[0-9.]+/.test(code), false)
  // Нуль-инициализация и тождество по sourceKey (1) — не пороги.
  check('dedupe.mjs не назначает уверенность дробным числом', /confidence\s*[=:]\s*0\.[0-9]+/.test(code), false)
  check('dedupe.mjs не сравнивает с числовым порогом', /[<>]=?\s*[0-9]*\.[0-9]+/.test(code), false)
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


// ── Инвентарь калибровочных чисел: ВСЕ литералы двух файлов (10f-P, P06.3, 04.09.2026) ──
//
// Дефект, который это закрывает (воспроизведён: tmp/10f-p-p06-inv-repro-*):
// порог «часть — целое» 0,95 и разрыв кандидатов в родители 0,1 жили числами
// в теле screenNewPoi; их правка меняла вердикт и выбор Parent POI при
// прежних версии и отпечатке политики, и ни один тест этого не видел.
//
// Правило: любой числовой литерал poi-matching.ts и dedupe.mjs — либо поле
// MATCHER_POLICY (входит в отпечаток), либо ПОИМЁННОЕ исключение ниже с
// категорией и обоснованием. Инвентарь снимается с AST (typescript), а не
// регулярным выражением по известным именам: новый литерал, не попавший ни
// в политику, ни в исключения, роняет тест; исключение, которому нечего
// покрывать, или покрывающее больше, чем заявлено, — тоже.
//
// Категории исключений:
//   math     — чистая математика формулы (радианы, гаверсинус, Дайс, набивка n-грамм);
//   identity — определение меры и структуры, не порог: пустое имя = 0, посимвольное
//              равенство = 1, индекс первого элемента, счётчик, проверка непустоты,
//              «нулевая координата = отсутствие»;
//   report   — только форма отчёта: длина списков в объяснении и результате
//              (вердикт, blockingDuplicate и parent вычислены ДО усечения, порядок
//              усечение не меняет), округление в тексте причин.
{
  const REPO = fileURLToPath(new URL('..', import.meta.url))
  const literalsOf = (rel) => {
    const text = readFileSync(REPO + rel, 'utf8')
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)
    const lines = text.split('\n')
    const out = []
    const walk = (node, inPolicy) => {
      let here = inPolicy
      if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'MATCHER_POLICY') here = true
      if (ts.isNumericLiteral(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const parent = node.parent
        out.push({
          file: rel, line: line + 1, value: node.text, inPolicy: here,
          parentKind: ts.SyntaxKind[parent.kind], parentText: parent.getText(sf).replace(/\s+/g, ' '),
          lineText: lines[line].trim(),
        })
      }
      ts.forEachChild(node, (c) => walk(c, here))
    }
    walk(sf, false)
    return out
  }
  const M = 'src/lib/poi-matching.ts'
  const D = 'scripts/poi-portals/lib/dedupe.mjs'
  const literals = [...literalsOf(M), ...literalsOf(D)]
  const policyLiterals = literals.filter((l) => l.inPolicy)
  const policyNumbers = Object.values(MATCHER_POLICY).filter((v) => typeof v === 'number').length
  check('литералы внутри MATCHER_POLICY = числовые поля политики (все они в отпечатке)', policyLiterals.length, policyNumbers)
  check('в dedupe.mjs нет литералов политики (пороги партии читаются из MATCHER_POLICY)', policyLiterals.filter((l) => l.file === D).length, 0)

  /** Поимённые исключения: name, category, reason, file, match(literal), count — ровно столько литералов. */
  const EXCEPTIONS = [
    { name: 'first-element-index', category: 'identity', file: M, count: 8,
      reason: 'x[0] — первый элемент уже отсортированного списка или совпадения regex; выбор «лучшего» сделан сортировкой, индекс её не меняет',
      match: (l) => l.value === '0' && l.parentKind === 'ElementAccessExpression' && /^\w+\[0\]$/.test(l.parentText) },
    { name: 'first-element-index', category: 'identity', file: D, count: 3,
      reason: 'matches[0] — верхний кандидат уже отсортированного списка',
      match: (l) => l.value === '0' && l.parentKind === 'ElementAccessExpression' && /^matches\[0\]$/.test(l.parentText) },
    { name: 'slice-from-start', category: 'identity', file: M, count: 16,
      reason: 'slice(0, …) — начало среза: срез идёт с первого элемента, число не решение',
      match: (l) => l.value === '0' && l.parentKind === 'CallExpression' && /\.slice\(0, /.test(l.parentText) },
    { name: 'slice-from-start', category: 'identity', file: D, count: 1,
      reason: 'matches.slice(0, 5) — начало среза с первого элемента, как и в матчере',
      match: (l) => l.value === '0' && l.parentKind === 'CallExpression' && /\.slice\(0, /.test(l.parentText) },
    { name: 'report-list-limit', category: 'report', file: M, count: 14,
      reason: 'длина списков в reasons и в результате screenNewPoi (2, 3, 5): verdict, blockingDuplicate, parent, parentAmbiguous ≠ ∅ вычислены до усечения; усечение сохраняет порядок; check:poi видит до 5 кандидатов на запись',
      match: (l) => ['2', '3', '5'].includes(l.value) && l.parentKind === 'CallExpression' && /\.slice\(0, [235]\)$/.test(l.parentText) },
    { name: 'report-list-limit', category: 'report', file: D, count: 1,
      reason: 'matches.slice(0, 5) — верхняя пятёрка в отчёте партии; вердикт взят по matches[0] до усечения',
      match: (l) => l.value === '5' && l.parentKind === 'CallExpression' && /\.slice\(0, 5\)$/.test(l.parentText) },
    { name: 'namespace-separator-index', category: 'identity', file: M, count: 2,
      reason: 'search() < 0 = разделитель не найден; slice(at + 1) = текст после разделителя',
      match: (l) => (l.value === '0' && l.parentText === 'at < 0') || (l.value === '1' && l.parentText === 'at + 1') },
    { name: 'list-length-one', category: 'identity', file: M, count: 3,
      reason: 'length === 1 / > 1 — «ровно один кандидат» и «больше одного»: структура выбора, не порог',
      match: (l) => l.value === '1' && l.parentKind === 'BinaryExpression' && /\.length (===|>) 1$/.test(l.parentText) },
    { name: 'loop-counter', category: 'identity', file: M, count: 9,
      reason: 'инициализация счётчика/аккумулятора нулём и шаг += 1',
      match: (l) => (l.value === '0' && l.parentKind === 'VariableDeclaration' && /^(i|shared|best) = 0$/.test(l.parentText)) || (l.value === '1' && /^(i|shared) \+= 1$/.test(l.parentText)) },
    { name: 'loop-counter', category: 'identity', file: D, count: 1,
      reason: 'confidence = 0 — «совпадения нет» до проверки ветвей',
      match: (l) => l.value === '0' && l.parentKind === 'VariableDeclaration' && l.parentText === 'confidence = 0' },
    { name: 'ngram-padding', category: 'math', file: M, count: 1,
      reason: 'n − 1 пробелов набивки слева при размере n-граммы из политики (ngramSize)',
      match: (l) => l.value === '1' && l.parentText === 'n - 1' },
    { name: 'dice-coefficient', category: 'math', file: M, count: 2,
      reason: 'коэффициент Дайса 2|A∩B| / (|A|+|B|) — определение меры',
      match: (l) => l.value === '2' && l.parentText === '2 * shared' },
    { name: 'haversine', category: 'math', file: M, count: 7,
      reason: 'формула гаверсинуса: градусы→радианы (/180), половинные углы (/2), квадраты (**2), 2R·asin, clamp к 1; радиус Земли — в политике (earthRadiusM)',
      match: (l) => ['180', '2', '1'].includes(l.value) && /^(\(deg \* Math\.PI\) \/ 180|dLat \/ 2|dLon \/ 2|Math\.sin\(d(Lat|Lon) \/ 2\) \*\* 2|2 \* R|Math\.min\(1, Math\.sqrt\(h\)\))$/.test(l.parentText) },
    { name: 'identity-score', category: 'identity', file: M, count: 13,
      reason: 'определение меры: пустое имя/скелет — 0, посимвольное равенство — 1, совпадение скелетов = имя города — 0, разные известные классы родовых слов — 0, тот же класс — 1',
      match: (l) => ['0', '1'].includes(l.value) && ((l.parentKind === 'ReturnStatement' && /^return [01]$/.test(l.parentText)) || (l.parentKind === 'ConditionalExpression' && /\? [01] : [01]$/.test(l.parentText) && !/Bonus/.test(l.parentText))) },
    { name: 'rank-bonus-absent', category: 'identity', file: M, count: 2,
      reason: 'надбавка ранжирования отсутствует (0), когда условие не выполнено; величины надбавок — в политике',
      match: (l) => l.value === '0' && l.parentKind === 'ConditionalExpression' && /Bonus : 0\)?$/.test(l.parentText) },
    { name: 'non-empty-check', category: 'identity', file: M, count: 4,
      reason: 'best <= 0 (ни одна ось не дала веса), issues.length > 0 / === 0 (есть/нет расхождений идентичности)',
      match: (l) => l.value === '0' && l.parentKind === 'BinaryExpression' && /^(best <= 0|m\.issues\.length (>|===) 0)$/.test(l.parentText) },
    { name: 'non-empty-check', category: 'identity', file: D, count: 1,
      reason: 'confidence > 0 — совпадение есть',
      match: (l) => l.value === '0' && l.parentText === 'confidence > 0' },
    { name: 'km-display', category: 'report', file: M, count: 3,
      reason: 'километры с одним знаком в тексте причины (/100, /10) и «?? 0» для отсутствующего расстояния в том же тексте; опровержение расстоянием решено раньше по GEO_DIFFERENT_PLACE_M',
      match: (l) => ['100', '10', '0'].includes(l.value) && /distanceM \?\? 0\) \/ 100\) \/ 10|geoRefutedDuplicate\.distanceM \?\? 0/.test(l.parentText) && /\?\? 0|\/ 100|\/ 10/.test(l.parentText) },
    { name: 'zero-coordinate-missing', category: 'identity', file: M, count: 1,
      reason: 'toPoiLike: координата 0 = отсутствие (пустое число Airtable), правило чтения данных, не порог',
      match: (l) => l.value === '0' && l.parentText === 'value !== 0' },
    { name: 'source-key-identity', category: 'identity', file: D, count: 1,
      reason: 'совпадение sourceKey — тождество по ключу источника, уверенность 1 по определению',
      match: (l) => l.value === '1' && l.parentKind === 'PropertyAssignment' && l.parentText === 'confidence: 1' },
    { name: 'reason-format', category: 'report', file: D, count: 3,
      reason: 'toFixed(2) в тексте причины партии; сравнение с порогами идёт по неокруглённому nameScore',
      match: (l) => l.value === '2' && l.parentKind === 'CallExpression' && /nameScore\.toFixed\(2\)$/.test(l.parentText) },
  ]
  const claimed = new Map()
  for (const ex of EXCEPTIONS) {
    const hits = literals.filter((l) => !l.inPolicy && l.file === ex.file && ex.match(l))
    check(`исключение «${ex.name}» (${ex.category}, ${ex.file}) покрывает ровно ${ex.count} литерал(ов)`, hits.length, ex.count)
    check(`исключение «${ex.name}» (${ex.file}) обосновано`, typeof ex.reason === 'string' && ex.reason.length > 20, true)
    for (const h of hits) {
      const key = `${h.file}:${h.line}:${h.value}:${h.parentText}`
      if (claimed.has(key) && claimed.get(key) !== ex.name) failures.push(`литерал ${key} заявлен двумя исключениями: ${claimed.get(key)} и ${ex.name}`)
      claimed.set(key, ex.name)
    }
  }
  const unclaimed = literals.filter((l) => !l.inPolicy && !claimed.has(`${l.file}:${l.line}:${l.value}:${l.parentText}`))
  check('вне MATCHER_POLICY нет ни одного числового литерала без поимённого исключения',
    unclaimed.map((l) => `${l.file}:${l.line} ${l.value} в «${l.lineText}»`).join(' | '), '')
  check('исключений три категории и только они', [...new Set(EXCEPTIONS.map((e) => e.category))].sort().join(','), 'identity,math,report')
  // Поля политики читаются в коде, а не только объявлены: неиспользуемое
  // поле — знак, что литерал где-то остался или параметр отпал.
  const used = Object.keys(MATCHER_POLICY).filter((k) => k !== 'version' && new RegExp('MATCHER_POLICY\\.' + k + '\\b').test(readFileSync(REPO + M, 'utf8') + readFileSync(REPO + D, 'utf8')))
  check('каждое числовое поле политики читается кодом матчера или партии', used.length, policyNumbers)
}

// ── Поведение каждого параметра v2 закреплено (10f-P, P06.3, 04.09.2026) ──
//
// Отпечаток ловит правку значения; эти проверки ловят её же поведением и
// одновременно ловят обход политики (число, зашитое обратно в код, при том же
// значении инвентарь выше, при другом — они).
{
  const ex = (poiId, nameRu, extra = {}) => ({ poiId, nameRu, siteCity: 'tokyo', ...extra })
  // nameCoreMinLength = 3: ядро короче трёх символов родовым словом не отделяется.
  check('nameCoreMinLength: «Храм Ор» — ядро «ор» короче 3, родовое слово не снимается', JSON.stringify(splitName('Храм Ор')), JSON.stringify({ head: '', core: 'храм ор', full: 'храм ор' }))
  check('nameCoreMinLength: «Храм Ора» — ядро «ора» длиной 3 отделяется', JSON.stringify(splitName('Храм Ора')), JSON.stringify({ head: 'храм', core: 'ора', full: 'храм ора' }))
  // namespacePartMinLength = 3: «Exhibition: WA» — не коллекция.
  check('namespacePartMinLength: часть «WA» короче 3 — коллекции нет', splitNamespace('Выставка «Shinjuku Kabukicho Shunga Exhibition: WA»').namespace, '')
  check('namespacePartMinLength: «Art House Project: Кадоя» — коллекция есть', splitNamespace('Art House Project: Кадоя').namespace, 'art house project')
  // skeletonMinLength = 4: трёхбуквенный скелет не сравнивается.
  check('skeletonMinLength: скелет «osa» (3) — сравнения нет', skeletonMatch('Оса', 'Osa'), 0)
  check('skeletonMinLength: скелет «ueno» (4) сравнивается', skeletonMatch('Уэно', 'Ueno') > 0, true)
  // skeletonContainmentMinShort = 5 / MinExtra = 3 / Fallback = 0.5.
  check('skeletonContainmentMinShort: короткая часть «ueno» (4) на границе — только резервный вес', skeletonMatch('Уэно', 'Ueno Onshi'), MATCHER_POLICY.skeletonContainmentFallback)
  check('skeletonContainmentMinExtra: «engakuji» ⊂ «sengakuji», лишняя часть 1 — резервный вес', skeletonMatch('Храм Энгакудзи', 'Храм Сэнгакудзи'), MATCHER_POLICY.skeletonContainmentFallback)
  check('skeletonContainmentFallback = 0.5 (ниже порога показа 0.72)', MATCHER_POLICY.skeletonContainmentFallback, 0.5)
  check('вхождение по границе при 5 и 3 — потолок: «meiji» ⊂ «meijijingu»', skeletonMatch('Святилище Мэйдзи', 'Meiji Jingū'), MATCHER_POLICY.similarityCeiling)
  // headUnknownFloor = 0.5: родовое слово вне справочника классов не обнуляет пару.
  check('headUnknownFloor: «Усадьба» вне справочника классов — сходство голов не ниже 0.5', nameSimilarity('Усадьба Сэнсодзи', 'Храм Сэнсодзи'), MATCHER_POLICY.headUnknownFloor)
  check('headUnknownFloor = 0.5', MATCHER_POLICY.headUnknownFloor, 0.5)
  // containmentCoreMinLength = 4.
  check('containmentCoreMinLength: ядро «оса» (3) — отношения нет', containmentRelation('Оса', 'Оса Хиллз'), null)
  check('containmentCoreMinLength: ядро «уэно» (4) — «Уэно» родитель «Уэно Хиллз»', containmentRelation('Уэно', 'Уэно Хиллз'), 'a_is_parent')
  // cityTokenMinLength = 4: скелет города из 4 букв исключается из сравнения.
  check('cityTokenMinLength: «nara» (4) исключён — «Нара» ⟷ «Nara Park» в Наре не совпадают', matchPoi({ nameRu: 'Нара', siteCity: 'nara' }, [{ poiId: 'P', nameRu: '', nameEn: 'Nara Park', siteCity: 'nara' }]).length, 0)
  check('cityTokenMinLength: тот же скелет вне города совпадает', matchPoi({ nameRu: 'Нара', siteCity: 'kyoto' }, [{ poiId: 'P', nameRu: '', nameEn: 'Nara Park', siteCity: 'kyoto' }]).length, 1)
  // partWholeCutoff = 0.95: часть — целое с весом 0.9189 — кандидат в родители, не дубль.
  const museum = screenNewPoi({ nameRu: 'Токийский национальный музей современного искусства', siteCity: 'tokyo' }, [ex('POI-M', 'Токийский национальный музей современного искусства Роппонги')])
  check('partWholeCutoff: вес 0.9189 при отношении часть — целое', nameSimilarity('Токийский национальный музей современного искусства', 'Токийский национальный музей современного искусства Роппонги'), 0.9189)
  check('partWholeCutoff: такая пара — clear, не дубль (при 0.9 была бы blocked_duplicate)', museum.verdict, 'clear')
  check('partWholeCutoff: и названа возможным родителем', /Возможный родитель по названию: POI-M/.test(museum.reasons.join(' ')), true)
  // parentAmbiguityGap = 0.1: разрыв 0.1111 — привязка, 0.0667 — неоднозначно.
  const tower = screenNewPoi({ nameRu: 'Новая точка XYZ', siteCity: 'tokyo' }, [ex('POI-A', 'Токийская башня'), ex('POI-B', 'Токийская башня Скай')], { nameRu: 'Токийская башня' })
  check('parentAmbiguityGap: разрыв 1 − 0.8889 ≥ 0.1 — родитель проставлен', tower.parent?.candidate.poiId, 'POI-A')
  check('parentAmbiguityGap: и неоднозначности нет', tower.parentAmbiguous.length, 0)
  const haneda = screenNewPoi({ nameRu: 'Новая точка XYZ', siteCity: 'tokyo' }, [ex('POI-A', 'Международный аэропорт Ханэда'), ex('POI-B', 'Международный аэропорт Ханэды')], { nameRu: 'Международный аэропорт Ханэда' })
  check('parentAmbiguityGap: разрыв 1 − 0.9333 < 0.1 — родитель не проставлен', haneda.parent, null)
  check('parentAmbiguityGap: оба кандидата названы неоднозначными', haneda.parentAmbiguous.map((m) => m.candidate.poiId).join(','), 'POI-A,POI-B')
  // ngramSize = 3 и scoreDecimals = 4: конкретные веса триграммного Дайса с четырьмя знаками.
  check('ngramSize: «Роппонги Хиллз» ⟷ «Роппонги» по триграммам — 0.75', nameSimilarity('Роппонги Хиллз', 'Роппонги'), 0.75)
  check('scoreDecimals: «Синдзюку Гёэн» ⟷ «Синдзюку» — 0.7826 (четыре знака)', nameSimilarity('Синдзюку Гёэн', 'Синдзюку'), 0.7826)
  // distanceDecimals = 1 и earthRadiusM: метры с одним знаком по среднему радиусу IUGG.
  check('distanceDecimals/earthRadiusM: 0.000105° широты — 11.7 м', haversineMeters({ lat: 35.394895, lon: 138.73258 }, { lat: 35.395, lon: 138.73258 }), 11.7)
  check('distanceDecimals/earthRadiusM: диагональ — 136.7 м', haversineMeters({ lat: 35.394895, lon: 138.73258 }, { lat: 35.3958, lon: 138.7336 }), 136.7)
}

// ── Словари матчера: одна запись, входит в отпечаток политики (10f-P, P06.3, 04.09.2026) ──
//
// Щель, которую это закрывает: GENERIC_HEAD, GENERIC_TAIL, GENERIC_CLASS,
// RU_GENERIC, EN_GENERIC, POLIVANOV и складывания букв жили константами по
// файлу и в отпечаток не входили — добавить родовое слово или убрать «taisha»
// из класса shrine значило изменить решение при прежних версии и отпечатке.
{
  check('словари заморожены', Object.isFrozen(MATCHER_LEXICON), true)
  // Заморозка ГЛУБОКАЯ: Object.freeze держит только верхний уровень, и
  // push в массив родовых слов или правка одной пары Поливанова прошли бы
  // молча при прежнем отпечатке. Проверяется каждый вложенный узел и сама
  // попытка вложенной правки (модуль ESM — strict mode, правка бросает).
  const nodes = []
  const walkFrozen = (v, path) => {
    if (v === null || typeof v !== 'object') return
    nodes.push({ path, frozen: Object.isFrozen(v) })
    for (const k of Object.keys(v)) walkFrozen(v[k], `${path}.${k}`)
  }
  walkFrozen(MATCHER_LEXICON, 'lexicon')
  check('вложенных узлов словаря (объектов и массивов) — 98: сама запись, 15 полей-контейнеров, 81 пара Поливанова, 2 + 5 пар складываний', nodes.length, 98)
  check('каждый вложенный узел словаря заморожен', nodes.filter((n) => !n.frozen).map((n) => n.path).join(','), '')
  const lexBefore = matcherLexiconDigest()
  const policyBefore = matcherPolicyDigest()
  const snapshot = JSON.stringify(MATCHER_LEXICON)
  const attempts = [
    ['push в genericHead', () => MATCHER_LEXICON.genericHead.push('вилла')],
    ['присваивание элемента genericTail', () => { MATCHER_LEXICON.genericTail[0] = 'villa' }],
    ['правка класса genericClass.shrine', () => { MATCHER_LEXICON.genericClass.shrine = 'святилище' }],
    ['новый класс в genericClass', () => { MATCHER_LEXICON.genericClass.villa = 'вилла|villa' }],
    ['правка пары Поливанова polivanov[0][1]', () => { MATCHER_LEXICON.polivanov[0][1] = 'x' }],
    ['замена пары Поливанова polivanov[0]', () => { MATCHER_LEXICON.polivanov[0] = ['дзю', 'x'] }],
    ['перестановка Поливанова через sort', () => MATCHER_LEXICON.polivanov.sort()],
    ['правка letterFolds[1][1]', () => { MATCHER_LEXICON.letterFolds[1][1] = 'э' }],
    ['удаление из ruGeneric через splice', () => MATCHER_LEXICON.ruGeneric.splice(0, 1)],
    ['pop из enGeneric', () => MATCHER_LEXICON.enGeneric.pop()],
    ['правка macronFolds[0][1]', () => { MATCHER_LEXICON.macronFolds[0][1] = 'u' }],
    ['delete поля словаря', () => { delete MATCHER_LEXICON.articles }],
    ['новое поле словаря', () => { MATCHER_LEXICON.extra = ['x'] }],
    ['defineProperty на словаре', () => Object.defineProperty(MATCHER_LEXICON, 'articles', { value: [] })],
  ]
  for (const [label, attempt] of attempts) {
    let thrown = null
    try { attempt() } catch (e) { thrown = e }
    check(`вложенная правка словаря отвергается: ${label}`, thrown instanceof TypeError, true)
  }
  check('после всех попыток словарь побайтно прежний', JSON.stringify(MATCHER_LEXICON), snapshot)
  check('после всех попыток отпечаток словарей прежний', matcherLexiconDigest(), lexBefore)
  check('после всех попыток отпечаток политики прежний', matcherPolicyDigest(), policyBefore)
  check('у политики нет вложенных объектов (плоская запись — верхней заморозки достаточно)',
    Object.values(MATCHER_POLICY).every((v) => typeof v !== 'object'), true)
  const lex = matcherLexiconDigest()
  check('отпечаток словарей — sha256', /^sha256:[0-9a-f]{64}$/.test(lex), true)
  check('отпечаток словарей детерминирован', matcherLexiconDigest(), lex)
  const policyBase = matcherPolicyDigest()
  check('отпечаток политики включает словари (иной словарь — иной отпечаток политики)',
    matcherPolicyDigest(MATCHER_POLICY, { ...MATCHER_LEXICON, articles: [...MATCHER_LEXICON.articles, 'an'] }) !== policyBase, true)
  for (const [key, value] of Object.entries(MATCHER_LEXICON)) {
    const mutated = Array.isArray(value)
      ? [...value, Array.isArray(value[0]) ? ['ъъ', 'x'] : 'ъъ']
      : typeof value === 'string' ? `${value}x` : { ...value, xx: 'ъъ' }
    check(`отпечаток словарей меняется от поля ${key}`, matcherLexiconDigest({ ...MATCHER_LEXICON, [key]: mutated }) !== lex, true)
  }
  // Порядок значим: Поливанов разбирается по порядку.
  const swapped = [...MATCHER_LEXICON.polivanov]
  ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
  check('перестановка двух строк таблицы Поливанова меняет отпечаток', matcherLexiconDigest({ ...MATCHER_LEXICON, polivanov: swapped }) !== lex, true)
  const ruLess = MATCHER_LEXICON.ruGeneric.filter((w) => w !== 'храм')
  check('удаление одного стоп-слова меняет отпечаток', matcherLexiconDigest({ ...MATCHER_LEXICON, ruGeneric: ruLess }) !== lex, true)

  // Поведенческие пины словарей — правка ловится не только отпечатком.
  check('letterFolds: э → е', normalizeName('Сэндай'), 'сендай')
  check('letterFolds: ё → е', normalizeName('Тоёсу'), 'тоесу')
  check('articles: артикль снимается', normalizeName('The National Museum'), 'national museum')
  check('bracketChars: полноширинные скобки → пробел, содержимое сохраняется', normalizeName('Храм（Сэндай）'), 'храм сендай')
  check('dotChars: японская точка → пробел', normalizeName('Юмото・Никко'), 'юмото никко')
  check('namespaceSeparators: полноширинное двоеточие — коллекция', splitNamespace('Art House Project：Кадоя').namespace, 'art house project')
  check('qualifierOpen/Close: полноширинные скобки — уточнение', qualifierRelation('Кадоя（Naoshima）', 'Кадоя'), 'one_sided')
  check('macronFolds: Ō → o', romajiSkeleton('Ōsaka-jō'), 'osakajo')
  check('romajiVowels: долгота схлопывается', romajiSkeleton('Tookyoo'), 'tokyo')
  check('genericHead: «усадьба» — родовое слово', JSON.stringify(splitName('Усадьба Сэнсодзи')), JSON.stringify({ head: 'усадьба', core: 'сенсодзи', full: 'усадьба сенсодзи' }))
  check('genericTail: «taisha» — хвост английского названия', JSON.stringify(splitName('Fushimi Inari Taisha')), JSON.stringify({ head: 'taisha', core: 'fushimi inari', full: 'fushimi inari taisha' }))
  check('genericClass: taisha и shrine — один класс', nameSimilarity('Fushimi Inari Taisha', 'Fushimi Inari Shrine'), 1)
  check('genericClass: ropeway и railway — разные классы', nameSimilarity('Hakone Ropeway', 'Hakone Tozan Railway') < DUPLICATE_REVIEW, true)
  check('ruGeneric: «храм» снимается из скелета', romajiSkeleton('Храм Токэйдзи'), 'tokeiji')
  check('enGeneric: «national» снимается из скелета', romajiSkeleton('National Museum of Western Art'), 'western')
  check('polivanov: «дзи» → ji (многобуквенное раньше односимвольного)', romajiSkeleton('Тодайдзи'), 'todaiji')
  check('polivanov: «ть» → t (мягкий знак пуст)', romajiSkeleton('Кинкакудзи Тьё'), 'kinkakujityo')
}

// ── Инвентарь нечисловых таблиц и регулярных выражений (по AST) ──
//
// Правило: любая таблица, множество, отображение или регулярное выражение с
// литеральным содержимым в poi-matching.ts строится из MATCHER_LEXICON (через
// поле словаря или charClass(…) от поля словаря) — либо является поимённым
// исключением структуры: классы Unicode и пробелов, диапазоны письменностей,
// комбинирующие знаки, токенизаторы по алфавиту, экранирование charClass.
// Новый литерал-таблица или новая регулярка без исключения роняет тест.
{
  const REPO = fileURLToPath(new URL('..', import.meta.url))
  const rel = 'src/lib/poi-matching.ts'
  const text = readFileSync(REPO + rel, 'utf8')
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const lines = text.split('\n')
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const fromLexicon = (t) => /MATCHER_LEXICON\.|charClass\(|LETTER_FOLDS|MACRON_FOLDS/.test(t)
  // 1. Верхнеуровневые константы с литеральным содержимым.
  const tables = []
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      const init = d.initializer
      if (!init) continue
      const name = d.name.getText(sf)
      // Таблица — инициализатор, где ГДЕ-ЛИБО внутри есть литерал массива,
      // объекта, регулярки или new RegExp/Set/Map: `X.concat([[…]])` тоже таблица.
      let isTable = false
      const scan = (n) => {
        if (ts.isArrayLiteralExpression(n) || ts.isObjectLiteralExpression(n) || ts.isRegularExpressionLiteral(n)
          || (ts.isNewExpression(n) && /^(RegExp|Set|Map)\b/.test(n.expression.getText(sf)))) isTable = true
        ts.forEachChild(n, scan)
      }
      scan(init)
      if (!isTable) continue
      tables.push({ name, line: lineOf(d), text: init.getText(sf).replace(/\s+/g, ' ') })
    }
  }
  const TABLE_EXCEPTIONS = {
    MATCHER_LEXICON: 'сама запись словарей — источник всех таблиц, входит в отпечаток',
    MATCHER_POLICY: 'сама запись политики — числа, входит в отпечаток',
    IDENTITY_ISSUE_LABEL: 'подписи видов расхождения для текста причин: только отчёт, на вес и вердикт не влияют',
  }
  const unexplainedTables = tables.filter((t) => !(t.name in TABLE_EXCEPTIONS) && !fromLexicon(t.text))
  check('каждая верхнеуровневая таблица строится из MATCHER_LEXICON или названа исключением',
    unexplainedTables.map((t) => `${t.name}@${t.line}`).join(','), '')
  for (const [name, reason] of Object.entries(TABLE_EXCEPTIONS)) {
    check(`исключение таблицы «${name}» существует и обосновано`, tables.some((t) => t.name === name) && reason.length > 20, true)
  }
  check('таблицы, выведенные из словаря, — ровно те, что были константами по файлу',
    tables.filter((t) => !(t.name in TABLE_EXCEPTIONS)).map((t) => t.name).sort().join(','),
    'ARTICLES,BRACKETS,DOTS,EN_GENERIC,GENERIC_CLASS,GENERIC_HEAD,GENERIC_TAIL,LETTER_FOLDS,LONG_VOWEL,MACRON_FOLDS,NAMESPACE_SEPARATOR,QUALIFIER,RU_GENERIC')
  // POLIVANOV — прямая ссылка на MATCHER_LEXICON.polivanov без литералов, потому в список таблиц не попадает.
  check('POLIVANOV — ссылка на словарь без собственной таблицы', /^const POLIVANOV = MATCHER_LEXICON\.polivanov$/m.test(text), true)
  // 2. Любой new RegExp/Set/Map с литеральным аргументом где угодно в файле — только из словаря.
  const inlineNew = []
  const regexLiterals = []
  const walk = (node) => {
    if (ts.isNewExpression(node) && /^(RegExp|Set|Map)\b/.test(node.expression.getText(sf))) {
      const args = (node.arguments ?? []).map((a) => a.getText(sf)).join(', ')
      const literalArg = (node.arguments ?? []).some((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isArrayLiteralExpression(a) || ts.isObjectLiteralExpression(a) || ts.isRegularExpressionLiteral(a) || ts.isTemplateExpression(a))
      if (literalArg && !fromLexicon(args)) inlineNew.push(`${lineOf(node)}: new ${node.expression.getText(sf)}(${args.slice(0, 60)})`)
    }
    if (ts.isRegularExpressionLiteral(node)) regexLiterals.push({ line: lineOf(node), text: node.getText(sf), lineText: lines[lineOf(node) - 1].trim() })
    ts.forEachChild(node, walk)
  }
  walk(sf)
  check('нет new RegExp/Set/Map с литеральным содержимым вне словаря', inlineNew.join(' | '), '')
  /** Регулярные выражения-литералы: структура, не словарь. name, reason, count, match. */
  const REGEX_EXCEPTIONS = [
    { name: 'unicode-letters-digits', count: 1, reason: 'всё, что не буква и не цифра Unicode, → пробел: определение токена, не словарь', match: (r) => r.text === '/[^\\p{L}\\p{N}]+/gu' },
    { name: 'whitespace-collapse', count: 2, reason: 'схлопывание пробелов при нормализации и despace ядра', match: (r) => r.text === '/\\s+/g' },
    { name: 'cyrillic-range', count: 4, reason: 'диапазон кириллицы Unicode (определение письменности, не словарь)', match: (r) => /^\/\[Ѐ-ӿ(Ԁ-ԯ)?\]\/$/.test(r.text) },
    { name: 'japanese-range', count: 1, reason: 'хирагана, катакана, CJK, полуширинная катакана — определение письменности', match: (r) => r.text === '/[぀-ゟ゠-ヿ一-鿿ｦ-ﾝ]/' },
    { name: 'latin-range', count: 1, reason: 'латинские буквы — определение письменности', match: (r) => r.text === '/[A-Za-z]/' },
    { name: 'combining-marks', count: 1, reason: 'снятие комбинирующих знаков после NFD — определение stripDiacritics', match: (r) => r.text === '/[̀-ͯ]/g' },
    { name: 'romaji-tokenizer', count: 2, reason: 'токенизация по алфавиту (латиница/кириллица/цифры; латиница/цифры) — структура скелета', match: (r) => r.text === '/[^a-zа-яё0-9]+/' || r.text === '/[^a-z0-9]+/g' },
    { name: 'charclass-escape', count: 1, reason: 'экранирование спецсимволов символьного класса в charClass — механика построения регулярок из словаря', match: (r) => r.text === '/[\\\\\\]^-]/g' },
  ]
  const claimedRegex = new Set()
  for (const ex of REGEX_EXCEPTIONS) {
    const hits = regexLiterals.filter((r) => ex.match(r))
    check(`регулярка-исключение «${ex.name}» покрывает ровно ${ex.count}`, hits.length, ex.count)
    check(`регулярка-исключение «${ex.name}» обоснована`, ex.reason.length > 20, true)
    for (const h of hits) claimedRegex.add(`${h.line}:${h.text}`)
  }
  const unclaimedRegex = regexLiterals.filter((r) => !claimedRegex.has(`${r.line}:${r.text}`))
  check('нет регулярных выражений-литералов без поимённого исключения', unclaimedRegex.map((r) => `${r.line}: ${r.text}`).join(' | '), '')
  check('всего регулярок-литералов в матчере', regexLiterals.length, REGEX_EXCEPTIONS.reduce((n, e) => n + e.count, 0))
}

// ── Итог ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ провалено ${failures.length} из ${passed + failures.length}\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exitCode = 1
} else {
  console.log(`✓ матчер POI: ${passed} проверок пройдено`)
}
