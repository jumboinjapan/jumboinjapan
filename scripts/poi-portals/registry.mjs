/**
 * Реестр источников. Список ЗАФИКСИРОВАН владельцем 2026-08-06 — восемь
 * позиций ниже. Новые источники не добавляются без его решения.
 *
 * Всё проверено вживую 6 августа 2026: HTTP, robots.txt, sitemap, разметка,
 * условия использования. Поля `verified`, `licence` и `authority`
 * обязательны — непроверенный источник в прогон не идёт.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ТРИ РЕЖИМА ИСПОЛЬЗОВАНИЯ (`role`) — они не взаимозаменяемы
 *
 *   discovery   узнать, КАКИЕ объекты существуют и что сейчас на слуху.
 *               Извлекаем: название, ссылка, регион, категория.
 *   verify      сверить ФАКТЫ по уже известному объекту.
 *               Извлекаем: часы, адрес, цена, доступ, статус работы.
 *   signal      сигнал спроса и сезонности: что продают и о чём пишут
 *               прямо сейчас. Фактам отсюда не верим, тексты не берём.
 *
 * НИ ОДИН из восьми источников не разрешает копирование своего
 * описательного текста — проверено по их условиям использования. Поэтому:
 *
 *   МОЖНО   извлекать факты (название, координаты, часы, категория) и
 *           писать по ним СВОЙ оригинальный русский текст
 *   НЕЛЬЗЯ  хранить и переиспользовать их описания. Перевод чужого
 *           описания на русский — это производное произведение
 *           (著作権法 ст. 27, право на перевод и переработку), а не свой текст
 *
 * Практическое следствие для конвейера: описание источника используется
 * как СЫРЬЁ ДЛЯ ИЗВЛЕЧЕНИЯ ФАКТОВ и в базе не сохраняется. Сохраняются
 * факты и ссылка на источник.
 * ────────────────────────────────────────────────────────────────────────
 */

import { AUTHORITY_SCALE } from './lib/weights.mjs'

/**
 * Разрешение на передачу данных источника модельному провайдеру.
 *
 * Исходное состояние КАЖДОГО источника — запрещающее, и записано оно явно,
 * а не подразумевается отсутствием поля: отсутствие policy — ошибка формы
 * реестра, а не «наверное, нельзя».
 *
 * Пустой `allowedProviders` — запрет. `null` в `decisionRef`, `reviewedAt`
 * и `validUntil` — тоже запрет: разрешение обязано ссылаться на решение
 * владельца, дату проверки и срок действия. `licence.textReuse` и
 * `licence.factExtraction` разрешения на передачу модели НЕ дают ни при
 * каком значении: это независимая ось.
 *
 * Функция, а не общая константа: каждому источнику нужен собственный
 * объект. Общий превратил бы выдачу разрешения одному источнику в выдачу
 * его всем двенадцати.
 */
function denyModelProcessing() {
  return {
    purpose: 'classification',
    allowedProviders: [],
    fields: [],
    decisionRef: null,
    reviewedAt: null,
    validUntil: null,
  }
}

export const PORTALS = [
  {
    id: 'japan-guide',
    modelProcessing: denyModelProcessing(),
    label: 'japan-guide.com — Destinations',
    url: 'https://www.japan-guide.com/e/e623a.html',
    host: 'www.japan-guide.com',
    role: 'discovery',
    kind: 'reference',
    authority: AUTHORITY_SCALE.reference, // 0.85
    regionKeys: ['*'],
    languages: ['en'],
    adapter: 'japan-guide-html',
    // Страница-индекс — вход во весь их справочник направлений.
    //
    // В шаблоне появилась необязательная буква после номера: сам вход
    // называется e623a.html и прежнему шаблону НЕ соответствовал. Проверено
    // 17.08.2026: в региональных списках 208 ссылок, из них каноничных 206.
    //
    // ЧЕТЫРЕ ФОРМЫ ССЫЛОК, все измерены. Роль страницы ни одна из них не
    // задаёт: `/destinations/nozawa-onsen/` оказалось коллекцией, а
    // `/destinations/motonosumi-shrine/` той же формы — объектом. Роль
    // вычисляется по структуре и живёт в `pageEvidence.pageRole`.
    //
    // Суффиксная форма `/e/eNNNN_<suffix>.html` добавлена 19.08.2026 по
    // canary: сначала измерены строчные буквенные суффиксы, затем probe
    // подтвердил самостоятельность объектов `_001` … `_006`. Цифровая
    // ветвь закрыта ровно тремя цифрами.
    discovery: {
      entry: 'https://www.japan-guide.com/e/e623a.html',
      linkPatterns: [
        '^/e/e\\d+[a-z]?\\.html$',
        '^/e/e\\d+_(?:[a-z]+|\\d{3})\\.html$',
        '^/destinations/[a-z0-9]+(?:-[a-z0-9]+)*/$',
        '^/destinations/[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*\\.html$',
      ],
    },
    robots: { present: true, allowsUs: true, disallow: ['/local/'], aiBlocked: [] },
    freshness: {
      sitemapLastmod: false,
      jsonLdDateModified: false,
      httpLastModified: false,
      verdict: 'НЕТ СИГНАЛА — свежесть только измерением',
    },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Terms: «No part of this web site may be reproduced without the written ' +
        'permission». Коммерческим считают в т.ч. любой сайт с рекламой. ' +
        'Короткие цитаты разрешены без запроса, длинные — нет.',
      terms: 'https://www.japan-guide.com/e/e441.html',
    },
    verified: { at: '2026-08-06', http: 200, bytes: 637257, links: 226 },
    /*
     * Кодировка НЕ описывается одной меткой, и записать сюда «shift-jis»
     * значило бы записать неправду.
     *
     * Измерено 17.08.2026 на трёх страницах: HTTP-заголовок объявляет
     * shift-jis, <meta charset> объявляет UTF-8, а строгое декодирование по
     * КАЖДОЙ из этих двух меток завершается ошибкой. Документ отдаётся
     * смешанными байтами: преимущественно ASCII, с вкраплениями Shift_JIS и
     * с настоящими UTF-8-последовательностями одновременно.
     *
     * Политика ниже не утверждает, что страница является UTF-8. Она
     * утверждает, что разрешённые локаторы безопасно извлекаются после
     * replacement-aware разбора и отдельной проверки каждого значения по
     * закрытому алфавиту. Все повреждения на трёх страницах лежат в прозе
     * Intro, в описаниях карточек и в подвале — вне каждого локатора.
     *
     * Изменение любого из трёх сигналов — отказ страницы до разбора, а не
     * подбор новой кодировки.
     */
    encoding: {
      observedAt: '2026-08-17',
      httpCharset: 'shift-jis',
      metaCharset: 'utf-8',
      decodePolicy: 'mixed-page-utf8-locators-v1',
    },
    notes:
      'Лучшее покрытие и редакторская оценка «стоит ли ехать» — их рейтинг ' +
      'объектов уникален и полезен для приоритизации. Свежести не сообщает вообще.',
  },

  {
    id: 'jnto-japan-travel',
    modelProcessing: denyModelProcessing(),
    label: 'JNTO japan.travel — Destinations',
    url: 'https://www.japan.travel/en/destinations/',
    host: 'www.japan.travel',
    role: 'verify',
    kind: 'dmo-national',
    authority: AUTHORITY_SCALE.dmo, // 0.90
    regionKeys: ['*'],
    languages: ['en', 'ja', '+18 локалей'],
    adapter: 'sitemap-html',
    discovery: { entry: 'https://www.japan.travel/en/destinations/', linkPattern: '^/en/destinations/' },
    robots: {
      present: true,
      allowsUs: true,
      // Каталог объектов закрыт явно — туда не ходим.
      disallow: ['/admin/', '/*/travel-directory/*', '/jp/'],
      aiBlocked: [],
    },
    freshness: {
      sitemapLastmod: 'таймаут при запросе',
      jsonLdDateModified: false,
      verdict: 'НЕТ СИГНАЛА',
    },
    licence: {
      textReuse: false,
      factExtraction: 'спорно',
      note:
        'Самая жёсткая формулировка из восьми: среди охраняемых компонентов ' +
        'прямо названы «databases», и запрещено «reproduced, distributed, ' +
        'displayed, copied or STORED for public or private use». Заявленное ' +
        'шире того, что даёт закон (факты не охраняются, ст. 12の2 требует ' +
        'творческой структуры), но расхождение — вопрос к юристу.',
      terms: 'https://www.japan.travel/en/terms-of-use/',
    },
    verified: { at: '2026-08-06', http: 200, bytes: 174566, links: 481 },
    notes:
      'Национальная турорганизация — высший авторитет по официальным ' +
      'названиям и базовым фактам. Русской версии больше нет: /ru/ отдаёт 401. ' +
      'ВНИМАНИЕ: /*/travel-directory/* закрыт robots — это как раз каталог объектов.',
  },

  {
    id: 'visit-hokkaido',
    modelProcessing: denyModelProcessing(),
    label: 'HOKKAIDO LOVE! — 北海道観光機構',
    url: 'https://www.visit-hokkaido.jp/en/index.html',
    host: 'www.visit-hokkaido.jp',
    role: 'verify',
    kind: 'dmo-regional',
    authority: AUTHORITY_SCALE.dmo, // 0.90
    regionKeys: ['hokkaido'],
    languages: ['ja', 'en'],
    adapter: 'sitemap-html',
    discovery: { entry: 'https://www.visit-hokkaido.jp/en/index.html', linkPattern: '/en/' },
    robots: { present: true, allowsUs: true, disallow: [], aiBlocked: [] },
    freshness: { sitemapLastmod: false, jsonLdDateModified: false, verdict: 'НЕТ СИГНАЛА' },
    licence: {
      textReuse: false,
      factExtraction: true,
      note: '「本サイト上の文書・画像等の無断使用・転載を禁止します」 — охрана заявлена на документы и изображения, то есть на выражение, не на факты.',
      terms: 'https://www.visit-hokkaido.jp/aboutsite',
    },
    verified: { at: '2026-08-06', http: 200, bytes: 35370, links: 129 },
    notes: 'robots.txt разрешает всё явно (`Disallow:` пустой). Официальный DMO Хоккайдо.',
  },

  {
    id: 'shikoku-tourism',
    modelProcessing: denyModelProcessing(),
    label: 'Tourism SHIKOKU — 四国ツーリズム創造機構',
    url: 'https://shikoku-tourism.com/en/',
    host: 'shikoku-tourism.com',
    role: 'verify',
    kind: 'dmo-regional',
    authority: AUTHORITY_SCALE.dmo, // 0.90
    regionKeys: ['shikoku'],
    languages: ['ja', 'en'],
    adapter: 'sitemap-html',
    discovery: { entry: 'https://shikoku-tourism.com/en/', linkPattern: '/en/' },
    robots: { present: false, allowsUs: true, disallow: [], aiBlocked: [] },
    freshness: { sitemapLastmod: false, jsonLdDateModified: false, verdict: 'НЕТ СИГНАЛА' },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Самая дружелюбная формулировка из восьми: «著作権法上、認められる場合を除き» — ' +
        'прямая отсылка к статутным исключениям, без попытки договором расширить ' +
        'охрану. ОТДЕЛЬНО про фото: «旅行会社様が四国の旅行商品造成を目的として' +
        'ご使用になる場合は、その使用を妨げるものではありません» — исключение ' +
        'для турфирм, создающих турпродукт по Сикоку. Применимость к ' +
        'иностранному оператору — вопрос к юристу. Подсудность: 高松地方裁判所.',
      terms: 'https://shikoku-tourism.com/site',
    },
    verified: { at: '2026-08-06', http: 200, bytes: 138063, links: 174, robotsTxt: 'отсутствует (404)' },
    notes: 'Единственный источник с прямым исключением в пользу туроператоров (для фото).',
  },

  {
    id: 'japanstartshere',
    modelProcessing: denyModelProcessing(),
    label: 'Japan Starts Here — Kyushu guide (Robert Schrader)',
    url: 'https://japanstartshere.com/kyushu-travel-guide/',
    host: 'japanstartshere.com',
    role: 'signal',
    kind: 'blog',
    authority: AUTHORITY_SCALE.blog, // 0.40
    regionKeys: ['kyushu'],
    languages: ['en'],
    adapter: 'sitemap-html',
    discovery: { sitemap: 'https://japanstartshere.com/sitemap.xml' },
    robots: { present: true, allowsUs: true, disallow: [], aiBlocked: [] },
    freshness: {
      sitemapLastmod: true,
      jsonLdDateModified: true,
      verdict: 'ПОЛНЫЙ СИГНАЛ — sitemap index + dateModified в JSON-LD',
    },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Страницы условий НЕ СУЩЕСТВУЕТ (проверено 6 путей → 404). Только ' +
        'копирайт в подвале: «©2018-2026 Robert Schrader, All rights reserved». ' +
        'Отсутствие Terms снимает договорные ограничения, но не авторское право.',
      terms: null,
    },
    verified: {
      at: '2026-08-06', http: 200, bytes: 95557,
      sampleDateModified: '2025-10-17', samplePublished: '2024-04-29',
    },
    notes:
      'Частный блог одного автора — низкий авторитет по фактам, но ЕДИНСТВЕННЫЙ ' +
      'из восьми с полной разметкой дат. Полезен как сигнал «о чём сейчас пишут». ' +
      'Проверенная страница обновлялась 10 месяцев назад.',
  },

  {
    id: 'kyushujourneys',
    modelProcessing: denyModelProcessing(),
    label: 'Kyushu Journeys (合同会社Starbright Concepts)',
    url: 'https://kyushujourneys.com/',
    host: 'kyushujourneys.com',
    role: 'signal',
    kind: 'operator',
    authority: AUTHORITY_SCALE.operator, // 0.60
    regionKeys: ['kyushu'],
    languages: ['en'],
    adapter: 'sitemap-html',
    discovery: { sitemap: 'https://kyushujourneys.com/sitemap.xml' },
    robots: {
      present: true, allowsUs: true,
      disallow: ['/admin/', '/django-admin/', '/site-access/', '/book/', '/api/', '/search/', '/amp/'],
      aiBlocked: [],
    },
    freshness: {
      sitemapLastmod: true,
      jsonLdDateModified: false,
      verdict: 'ЕСТЬ СИГНАЛ — sitemap lastmod у 100% из 51 URL, 2026-07-15…2026-08-06',
    },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Terms фактически нет: /terms-and-conditions/ существует, но ПУСТА. ' +
        'Есть только 特商法-раскрытие. Копирайт в подвале «All Rights Reserved».',
      terms: 'https://kyushujourneys.com/legal-stuff/',
    },
    // Это отдельный, не копирайтный риск. Прецедент 翼システム (Токийский
    // окружной суд, 2001-2002): некреативная база данных НЕ получила охраны
    // по авторскому праву, но суд присудил возмещение по ст. 709 ГК Японии
    // (деликт), потому что копирующий вышел на конкурирующий рынок.
    competitorRisk: true,
    verified: {
      at: '2026-08-06', http: 200, bytes: 33275, sitemapUrls: 51,
      operator: '合同会社Starbright Concepts, Иидзука, преф. Фукуока',
      licenceNo: 'Travel Agent No. 2-873 (Kyushu)',
    },
    notes:
      'ЭТО ПРЯМОЙ КОНКУРЕНТ — лицензированный туроператор по Кюсю, тот же ' +
      'профиль что у вас. Использовать ТОЛЬКО как сигнал спроса (что продают, ' +
      'какие маршруты собирают), не как источник фактов и тем более текстов. ' +
      'Всего 51 страница — как справочник бесполезен.',
  },

  {
    id: 'japantravel-com',
    modelProcessing: denyModelProcessing(),
    label: 'en.japantravel.com — Destinations',
    url: 'https://en.japantravel.com/destinations',
    host: 'en.japantravel.com',
    role: 'discovery',
    kind: 'ugc',
    authority: AUTHORITY_SCALE.ugc, // 0.50
    regionKeys: ['*'],
    languages: ['en'],
    adapter: 'sitemap-html',
    // ────────────────────────────────────────────────────────────────────
    // ИСКЛЮЧЁН ИЗ ПРОГОНА. Источник поимённо заблокировал в robots.txt
    // ClaudeBot, Claude-Web, Claude-SearchBot, anthropic-ai, GPTBot,
    // ChatGPT-User, OAI-SearchBot, Google-Extended, PerplexityBot и Scrapy,
    // с комментарием «AI / LLM training crawlers — blocked».
    // Обойти это можно только подменив User-Agent, то есть сознательно
    // выдав себя за другого. Не делаем.
    // ────────────────────────────────────────────────────────────────────
    enabled: false,
    blockedReason: 'robots-ai-optout',
    robots: {
      present: true,
      allowsUs: false,
      disallow: ['/search', '/auth/', '/api/', '/index.php'],
      aiBlocked: [
        'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web',
        'anthropic-ai', 'claude-searchbot', 'google-extended', 'perplexitybot', 'scrapy',
      ],
    },
    freshness: { sitemapLastmod: false, jsonLdDateModified: false, verdict: 'НЕТ СИГНАЛА' },
    licence: {
      textReuse: false,
      factExtraction: 'требует лицензии',
      note:
        'ToS от 23.07.2018, пункта про AI нет — позиция выражена только через ' +
        'robots.txt. «We therefore expect to be compensated for any reuse». ' +
        'Личное и учебное использование бесплатно, коммерческое — по лицензии. ' +
        'Отдельно: «Abstracting with credit to JT and our URL is permitted and ' +
        'encouraged» — реферирование со ссылкой они прямо поощряют.',
      terms: 'https://en.japantravel.com/policies/terms',
    },
    verified: { at: '2026-08-06', http: 200, bytes: 169902, links: 258 },
    notes:
      'Ваш действующий импортёр событий (scripts/import-japantravel-events.mjs) ' +
      'ходит именно сюда. Решение о продолжении — за владельцем. ' +
      'Контакт для лицензии есть у них на сайте.',
  },

  {
    id: 'jtb-leisure',
    modelProcessing: denyModelProcessing(),
    label: 'JTB レジャー・遊び・体験',
    url: 'https://www.jtb.co.jp/leisure/',
    host: 'www.jtb.co.jp',
    role: 'signal',
    kind: 'operator',
    authority: AUTHORITY_SCALE.operator, // 0.60
    regionKeys: ['*'],
    languages: ['ja'],
    adapter: 'sitemap-html',
    discovery: { entry: 'https://www.jtb.co.jp/leisure/', linkPattern: '/leisure/' },
    robots: {
      present: true, allowsUs: true,
      // Длинный список, но закрыты только бронировочные и формовые пути.
      disallow: ['/kaigai/Country.aspx', '/bus/BusSelect/', '/ace/pkg/', '/smartphone/ace/pkg/'],
      aiBlocked: [],
    },
    freshness: { sitemapLastmod: null, jsonLdDateModified: false, verdict: 'СЛАБЫЙ СИГНАЛ' },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Общесайтового 利用規約 НЕ СУЩЕСТВУЕТ (проверено 6 путей → soft-404). ' +
        'Найденный 利用規約 — членский, связывает только зарегистрированных ' +
        'участников. Для анонимного посетителя — только копирайт в подвале.',
      terms: null,
    },
    // Риск не копирайтный, а нагрузочный: это транзакционный бронировочный
    // портал. Дело Librahack (2010) — задержание по 偽計業務妨害 при частоте
    // 1 запрос в секунду. Только бережный обход, только не-бронировочные пути.
    loadRisk: true,
    verified: { at: '2026-08-06', http: 200, bytes: 405840, links: 337, encoding: 'shift_jis', ttfb: '5.4s' },
    notes:
      'Витрина бронирования, не справочник POI. Ценность одна: что крупнейшее ' +
      'японское турагентство продаёт ПРЯМО СЕЙЧАС — сильный сигнал спроса и ' +
      'сезонности. Как источник фактов об объектах — худший из восьми. ' +
      'Сервер медленный (5,4 с), обходить бережно.',
  },

  // ── Наосима ────────────────────────────────────────────────────────────
  //
  // Разведка обоих порталов и всё, за что в них можно зацепиться, —
  // docs/portal-probe-naoshima.md. Разведывать заново не нужно.
  //
  // Два источника на один остров, и они не дублируют друг друга: ассоциация
  // держит остров целиком (искусство, еда, ночлег, транспорт), Benesse —
  // только свои музеи, но по ним она первоисточник. Для стабильных полей
  // (что это, где, чьё) весомее Benesse; для волатильных (часы, билеты,
  // закрытия) — та страница, что свежее. Ровно тот случай, ради которого
  // вес считается по классу поля, а не на источник целиком.
  {
    id: 'naoshima-tourism',
    modelProcessing: denyModelProcessing(),
    label: 'Naoshima Tourism Association (直島町観光協会)',
    url: 'https://naoshima.net/',
    host: 'naoshima.net',
    role: 'discovery',
    kind: 'dmo-regional',
    authority: AUTHORITY_SCALE.dmo, // 0.90
    regionKeys: ['shikoku'],
    languages: ['ja', 'en'],
    adapter: 'sitemap-html',
    // Только достопримечательности. Рестораны и ночлег владелец ведёт вне
    // этой базы (решение 10.08.2026), и тянуть их сюда — значит заводить
    // второй источник правды о том, что уже учтено в другом месте.
    discovery: {
      listings: [
        'https://naoshima.net/ja/art/',
        'https://naoshima.net/ja/experience/',
      ],
    },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Условия запрещают использование материалов сайта без письменного ' +
        'разрешения: «事前の使用許諾なく、これらの著作物を使用（複製、転用、' +
        '改変、頒布、販売、出版等）することを禁止いたします». Текст и фотографии ' +
        'брать НЕЛЬЗЯ. Перечень объектов, адреса и часы — факты, авторским ' +
        'правом не охраняются; русские описания пишутся свои.',
      terms: 'https://naoshima.net/ja/termsofuse/',
    },
    verified: { at: '2026-08-10', http: 200 },
    notes:
      'НКО «Ассоциация туризма города Наосима». Берём только достопримечательности: ' +
      'разделы еды и ночлега исключены по решению владельца — они ведутся вне ' +
      'этой базы. Разведка 10.08.2026: РАЗМЕТКИ НЕТ ВОВСЕ — ни JSON-LD, ни ' +
      'микроданных, ни OpenGraph; sitemap.xml отдаёт 13 адресов на весь сайт, ' +
      'как опись бесполезен. Цепляться придётся за h2 плюс ссылки вида ' +
      '/ja/<раздел>/… — это вёрстка, и она хрупкая. Зато имена приходят ' +
      'по-японски, а Name (JA) — наш сильнейший ключ сверки дублей.',
  },

  {
    id: 'benesse-artsite',
    modelProcessing: denyModelProcessing(),
    label: 'Benesse Art Site Naoshima',
    url: 'https://benesse-artsite.jp/',
    host: 'benesse-artsite.jp',
    role: 'verify',
    kind: 'operator',
    authority: AUTHORITY_SCALE.primary, // 1.00 — по СВОИМ объектам первоисточник
    regionKeys: ['shikoku'],
    languages: ['ja', 'en'],
    adapter: 'sitemap-html',
    discovery: { listings: ['https://benesse-artsite.jp/en/art/'] },
    licence: {
      textReuse: false,
      factExtraction: true,
      note:
        'Страницы условий у сайта СВОЕЙ нет: ссылка в подвале ведёт на ' +
        'benesse-hd.co.jp, а тот закрывается 01.04.2026 и вместо условий ' +
        'отдаёт объявление о закрытии. Отсутствие опубликованных условий — ' +
        'не разрешение: по умолчанию действует авторское право, то есть ' +
        'текст и фотографии брать нельзя. Факты — можно.',
      terms: null,
    },
    verified: { at: '2026-08-10', http: 200 },
    notes:
      'Оператор музеев Тисю, Ли Уфана, Benesse House и Дома-проекта — по ним ' +
      'первоисточник, выше ассоциации. Ночлег свой есть, но не берём: жильё ' +
      'ведётся вне этой базы. Разведка 10.08.2026: структурной разметки нет, ' +
      'но есть sitemap.xml на 815 адресов (114 страниц под /en/art/) и ' +
      'OpenGraph на каждой странице. OG — метаданные, а не вёрстка, редизайн ' +
      'их не ломает; это и есть точка опоры адаптера. Координат на портале ' +
      'нет ни следа — они берутся из Google по опознанному place_id.',
  },
]

/**
 * Открытые данные префектур. НЕ входят в зафиксированный список — оставлены
 * отдельно, потому что это единственный источник с явной лицензией CC BY 4.0,
 * разрешающей и хранение, и коммерческое использование. Прогоняются
 * собственным адаптером opendata-csv и служат опорой для сверки фактов,
 * с которой можно сравнивать всё остальное.
 */
export const SUPPLEMENTARY = [
  {
    id: 'bodik-osaka-tourism',
    modelProcessing: denyModelProcessing(),
    label: '大阪府 観光施設一覧 (BODIK)',
    adapter: 'opendata-csv',
    role: 'verify',
    kind: 'opendata',
    authority: AUTHORITY_SCALE.dmo,
    regionKeys: ['osaka'],
    ckan: { api: 'https://data.bodik.jp/api/3/action/package_show', datasetId: '270008_tourism' },
    licence: { textReuse: true, factExtraction: true, name: 'CC BY 4.0', attribution: '大阪府' },
    freshness: { declaredDate: '2026-03-30', verdict: 'ЕСТЬ — дата в метаданных CKAN' },
    verified: { at: '2026-08-06', rows: 2012 },
  },
  {
    id: 'bodik-kyoto-tourism',
    modelProcessing: denyModelProcessing(),
    label: '京都府 観光施設一覧 (BODIK)',
    adapter: 'opendata-csv',
    role: 'verify',
    kind: 'opendata',
    authority: AUTHORITY_SCALE.dmo,
    regionKeys: ['kyoto', 'uji'],
    ckan: { api: 'https://data.bodik.jp/api/3/action/package_show', datasetId: '260002_kankou_shisetsu' },
    licence: { textReuse: true, factExtraction: true, name: 'CC BY 4.0', attribution: '京都府' },
    freshness: { declaredDate: '2022-04-18', verdict: 'ЕСТЬ, но данные 2022 года' },
    verified: { at: '2026-08-06', rows: 1631 },
  },
]

export const ALL_SOURCES = [...PORTALS, ...SUPPLEMENTARY]

/** Источники, пригодные к прогону: включены и не заблокированы robots. */
export function activePortals({ regionKeys = null, roles = null, adapters = null } = {}) {
  return ALL_SOURCES.filter((p) => {
    if (p.enabled === false) return false
    if (p.robots?.allowsUs === false) return false
    if (roles && !roles.includes(p.role)) return false
    if (adapters && !adapters.includes(p.adapter)) return false
    if (regionKeys) {
      const hit = p.regionKeys.includes('*') || p.regionKeys.some((k) => regionKeys.includes(k))
      if (!hit) return false
    }
    return true
  })
}

export function getPortal(id) {
  const portal = ALL_SOURCES.find((p) => p.id === id)
  if (!portal) throw new Error(`Источник не найден в реестре: ${id}`)
  return portal
}
