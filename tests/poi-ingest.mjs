import { ingestPoi, ingestPoiBatch, POI_INTAKE_CONTRACT_VERSION, buildIntakeOrigin, resolveIntakeRunId } from '../src/lib/poi-ingest.ts'
import { applyCanon, canonicalCity, canonicalCoords, canonicalWorkingHours, checkProgrammeUsable, findBannedWords, isInSeason, operatingStatusFromGoogle, parseSeasonWindow } from '../src/lib/poi-canon.ts'

let ok=0, bad=[]
const t=(l,a,e)=>{ if(a===e) ok++; else bad.push(`${l}: ждали ${e}, получили ${a}`) }

// канон
t('слаг mt-fuji', canonicalCity('mt-fuji'), 'fuji')
t('слаг кириллицей', canonicalCity('Кирю'), 'kiryu')
t('часы: нолик к часу', canonicalWorkingHours('9:00-17:00'), '09:00–17:00')
t('запрещённое слово', findBannedWords('Дворец является частью').join(), 'является')
t('ложное срабатывание', findBannedWords('созданный в 1993 году сад').join(), '')
t('ложное 2', findBannedWords('воссозданное здание, переданная городу').join(), '')

const store = {
  _pool: [{poiId:'POI-000024',nameRu:'Храм Токэйдзи',nameEn:'Tokeiji Temple',siteCity:'kamakura',recordId:'rec1'}],
  _seen: new Map(),
  async listExisting(){ return [...this._pool] },
  async findBySourceKey(k){ return this._seen.get(k) ?? null },
  // Хранилище само назначает ID — как в бою: выдача и запись неделимы.
  async create(f){ const id=`POI-${String(900+this._pool.length).padStart(6,'0')}`
    const rec={poiId:id,nameRu:f['POI Name (RU)'],siteCity:f['Site City'],
      lat:f.Latitude??undefined,lon:f.Longitude??undefined,recordId:'rec'+id}
    this._pool.push(rec); const m=/Ключ источника: (\S+)/.exec(f.Notes||''); if(m) this._seen.set(m[1],rec)
    return {poiId:id,recordId:rec.recordId} },
}
/** Отдельное хранилище на geo-проверки: общий пул они бы засорили. */
const geoStore = (pool) => ({
  _pool: pool,
  async listExisting(){ return [...this._pool] },
  async findBySourceKey(){ return null },
  async create(f){ const id=`POI-${String(800+this._pool.length).padStart(6,'0')}`
    this._pool.push({poiId:id,nameRu:f['POI Name (RU)'],siteCity:f['Site City'],
      lat:f.Latitude??undefined,lon:f.Longitude??undefined,recordId:'rec'+id})
    return {poiId:id,recordId:'rec'+id} },
})
/**
 * Точка приходит ОТ РЕЗОЛВЕРА и записывается ровно та же: только так политика
 * координат выводится машинно. Круг R5: поля «решение человека» на машинной
 * границе больше нет, и массовая подстановка notApplicable в фикстурах убрана —
 * она объявляла машину человеком.
 *
 * Точка выводится из имени: одинаковые имена дают одинаковую точку и остаются
 * дублями, разные разнесены на километры и на гейт расстояния не влияют.
 */
const pt = (nameRu) => {
  let h = 0
  for (const ch of String(nameRu)) h = (h * 31 + ch.codePointAt(0)) % 997
  const lat = Number((34 + h * 0.004).toFixed(7))
  const lon = Number((133 + h * 0.004).toFixed(7))
  return { lat, lon, resolved: { placeId: `PID-${nameRu}`, lat, lon } }
}
const req=(nameRu,city,extra={})=>({source:{kind:'portal-collector',id:'test',...extra},poi:{nameRu,siteCity:city,...pt(nameRu),descriptionRu:'Описание объекта.',descriptionEn:'Object description.',categoriesRu:['Буддийский храм']}})

t('дубль блокируется', (await ingestPoi(req('Храм Токэйдзи','kamakura'),store)).outcome, 'blocked_duplicate')
t('новый создаётся', (await ingestPoi(req('Храм Гокуракудзи','kamakura'),store)).outcome, 'created')
t('без города — отказ', (await ingestPoi(req('Что-то',''),store)).outcome, 'rejected_canon')
// Латинские часы отбрасываются ВМЕСТЕ С ПОЛЕМ, а не вместе с записью.
// Правило заведено ради того, чтобы клиент не увидел латиницу на сайте;
// отказ всей точки эту цель не приближает. Прогон Киото стоил пяти
// настоящих POI, потерянных из-за одного поля.
{
  const r = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Тест часов'),nameRu:'Тест часов',siteCity:'tokyo',workingHours:'Typically 9:00 to 17:00'}},store,{dryRun:true})
  t('англ. часы — запись остаётся', r.outcome, 'created')
  t('но поле пустое', r.fields['Working Hours'], null)
  t('и есть предупреждение', r.canonIssues.some(i=>i.field==='workingHours'&&i.level==='warn'), true)
}

const r1=await ingestPoi(req('Храм Дзёракудзи','kamakura',{externalKey:'X1'}),store)
t('первый приём с ключом', r1.outcome, 'created')
const r2=await ingestPoi(req('Храм Дзёракудзи','kamakura',{externalKey:'X1'}),store)
t('повтор идемпотентен', r2.outcome, 'already_ingested')

// текст никогда не идёт в публикуемые поля
const dry=await ingestPoi(req('Храм Новый','nara'),store,{dryRun:true})
t('в Description (RU) не пишем', dry.fields['Description (RU)'], undefined)
t('в Approved не пишем', dry.fields['Description Approved (RU)'], undefined)
t('черновик заполнен', dry.fields['Description Draft (RU)'], 'Описание объекта.')
t('статус Draft', dry.fields['Copy Status'], 'Draft')

// пакет: повтор внутри самого пакета
const batch=await ingestPoiBatch([req('Храм Мёэдзи','nara'),req('Храм Мёэдзи','nara')],store)
t('повтор внутри пакета ловится', batch[1].outcome, 'blocked_duplicate')

// слаг нормализуется на входе
const fx=await ingestPoi(req('Пещера Тест','mt-fuji'),store,{dryRun:true})
t('слаг приведён', fx.fields['Site City'], 'fuji')

// Гонка: пять одновременных приёмов не должны получить один и тот же ID.
// Хранилище назначает ID внутри create, поэтому дублей быть не может.
const race = await Promise.all(
  ['Храм Раз','Храм Два','Храм Три','Храм Четыре','Храм Пять']
    .map(n => ingestPoi(req(n,'nara'), store))
)
const ids = race.filter(r=>r.outcome==='created').map(r=>r.poiId)
t('пять параллельных приёмов создались', ids.length, 5)
t('все ID различны', new Set(ids).size, 5)

// ── Координаты ────────────────────────────────────────────────────────────
t('координаты в норме', canonicalCoords(35.6586, 139.7454).lat, 35.6586)
t('половина пары отброшена', canonicalCoords(35.6586, null).lat, null)
t('половина пары — предупреждение', canonicalCoords(35.6586, null).issues[0].level, 'warn')
t('перестановка широты и долготы', canonicalCoords(139.7454, 35.6586).issues[0].level, 'error')
t('точка вне Японии', canonicalCoords(48.8584, 2.2945).issues[0].level, 'error')
t('семь знаков', canonicalCoords(35.123456789, 139.5).lat, 35.1234568)

const withCoords = (nameRu, city, lat, lon) => ({
  source:{kind:'portal-collector',id:'geo'},
  poi:{nameRu,siteCity:city,lat,lon,resolved:{placeId:`PID-${nameRu}`,lat,lon},descriptionRu:'Описание объекта.',descriptionEn:'Object description.',categoriesRu:['Буддийский храм']},
})

const coordFields = (await ingestPoi(withCoords('Храм Энгакудзи','kamakura',35.3376,139.5470), geoStore([]), {dryRun:true})).fields
t('широта записана', coordFields.Latitude, 35.3376)
t('долгота записана', coordFields.Longitude, 139.547)

// Межалфавитная пара: по именам это максимум 0,85 — ниже порога блокировки.
// Одни и те же координаты поднимают её до уверенного дубля.
const crossScript = [{poiId:'POI-000700',nameRu:'',nameEn:'Tokeiji Temple',siteCity:'kamakura',lat:35.3363,lon:139.5433,recordId:'recX'}]
// Без координат такая пара НЕ проходит с 11.08.2026. Имена дают 0,85 —
// ниже порога блокировки, но выше порога показа, и решить, тот же это храм
// или другой, нечем: координат нет. Раньше запись заводилась с примечанием
// в Notes, и ровно так в базе появлялись межалфавитные дубли.
t('без координат межалфавитная пара уходит на проверку',
  (await ingestPoi({source:{kind:'portal-collector',id:'geo'},poi:{nameRu:'Храм Токэйдзи',siteCity:'kamakura',descriptionRu:'Текст.',descriptionEn:'Text.'}}, geoStore([...crossScript]))).outcome,
  'needs_review')
t('координаты превращают её в дубль',
  (await ingestPoi(withCoords('Храм Токэйдзи','kamakura',35.3364,139.5434), geoStore([...crossScript]))).outcome,
  'blocked_duplicate')

// ── needs_review останавливает приём ────────────────────────────────────
// До 11.08.2026 эти ветки заканчивались созданной записью с примечанием
// в Notes. Тест ниже раньше закреплял именно этот дефект: он ЖДАЛ 'created'
// там, где вердикт был 'needs_review'. Гейт был fail-open, и зелёный прогон
// это подтверждал.
//
// Расстояние опровергает дубль — это НЕ остановка. Координаты уже сняли
// неоднозначность в пользу «разные места». Замер 11.08.2026 на живой базе:
// ветка давала 22 остановки из 56, и все 22 — законные разные объекты
// (Тодайдзи и Тосёдайдзи в 5 км, замок Нидзё и рынок Нидзё в 1017 км).
const namesake = [{poiId:'POI-000701',nameRu:'Храм Дзёдзёдзи',siteCity:'tokyo',lat:35.6574,lon:139.7480,recordId:'recY'}]
const farStore = geoStore([...namesake])
const far = await ingestPoi(withCoords('Храм Дзёдзёдзи','tokyo',35.7101,139.8107), farStore)
t('тёзка на расстоянии создаётся', far.outcome, 'created')
t('вердикт остаётся чистым', far.screen.verdict, 'clear')
t('пара сохранена в результате', far.screen.geoRefutedDuplicate.candidate.poiId, 'POI-000701')
t('и показана в Notes', /ТЁЗКА \(расстояние сняло дубль\): POI-000701/.test(far.fields.Notes), true)

// Ветка 1 остановки: непохожие имена в сорока метрах. Часто это части одного комплекса,
// но ровно так же выглядит тот же объект под другим именем.
const complex = [{poiId:'POI-000702',nameRu:'Ворота Нандаймон',siteCity:'nara',lat:34.6890,lon:135.8390,recordId:'recZ'}]
const neighbourStore = geoStore([...complex])
const neighbour = await ingestPoi(withCoords('Храм Тодайдзи','nara',34.6892,135.8392), neighbourStore)
t('сосед по координатам останавливает', neighbour.outcome, 'needs_review')
t('причина названа', /Рядом уже есть: POI-000702/.test(neighbour.explanation), true)
t('сосед не записан', neighbourStore._pool.length, 1)

// force проходит поверх остановки — по осознанному решению владельца.
const forcedNeighbour = await ingestPoi(
  withCoords('Храм Тодайдзи','nara',34.6892,135.8392), geoStore([...complex]), {force:true})
t('force проходит поверх needs_review', forcedNeighbour.outcome, 'created')

// Ветка 2 остановки: совпадение выше порога блокировки, но города разные — в Японии
// полно тёзок («Храм Риннодзи» в Никко и в Сэндае).
const otherCity = [{poiId:'POI-000703',nameRu:'Храм Риннодзи',siteCity:'nikko',recordId:'recA'}]
const cityMismatch = await ingestPoi(req('Храм Риннодзи','sendai'), geoStore([...otherCity]))
t('тёзка в другом городе останавливает', cityMismatch.outcome, 'needs_review')

// Ветка 3 остановки: совпадение в серой зоне между порогом показа и порогом блокировки.
const partial = [{poiId:'POI-000704',nameRu:'Храм Кофукудзи',siteCity:'nara',recordId:'recB'}]
const grey = await ingestPoi(req('Храм Кофукудзи Нара','nara'), geoStore([...partial]))
t('серая зона совпадения останавливает', grey.outcome, 'needs_review')

// Чистый случай остаётся чистым: без похожих записей гейт не мешает.
t('одинокая запись создаётся', (await ingestPoi(req('Храм Мурюдзи','nara'), geoStore([]))).outcome, 'created')

// ── Описание заводится только парой ─────────────────────────────────────
// На живой базе 121 запись из 431 имела русский текст и ни одного
// английского, обратных случаев — ноль. Односторонний перекос: путь
// записи молча терял английский, который исследователь возвращал.
{
  const half = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Только по-русски'),nameRu:'Только по-русски',siteCity:'tokyo',descriptionRu:'Есть русский текст.'}},store,{dryRun:true})
  t('русский без английского — отказ', half.outcome, 'rejected_canon')
  const both = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Оба языка'),nameRu:'Оба языка',siteCity:'tokyo',descriptionRu:'Есть русский.',descriptionEn:'English present.'}},store,{dryRun:true})
  t('пара проходит', both.outcome, 'created')
  t('английский попадает в черновик', both.fields['Description Draft (EN)'], 'English present.')
  // У английского СВОЯ типографика, а не отсутствие типографики.
  // Русский канон к нему неприменим: «ёлочки» и запятая вместо точки
  // в дробях для английского — порча. Но прямые кавычки всё равно
  // выправляются — в английские парные, а не в «ёлочки».
  const typo = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Кавычки'),nameRu:'Кавычки',siteCity:'tokyo',descriptionRu:'Русский текст.',descriptionEn:'A "quoted" 2.5 km walk with 15 000 people.'}},store,{dryRun:true})
  t('кавычки — английские парные', typo.fields['Description Draft (EN)'].includes('“quoted”'), true)
  t('десятичная точка сохранена', typo.fields['Description Draft (EN)'].includes('2.5 km'), true)
  t('разряды — запятой, не пробелом', typo.fields['Description Draft (EN)'].includes('15,000'), true)
  // Клише англоязычного травел-копирайтинга канон отвергает так же
  // жёстко, как русские «уникальный» и «незабываемый».
  const cliche = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Клише'),nameRu:'Клише',siteCity:'tokyo',descriptionRu:'Русский текст.',descriptionEn:'A stunning temple that boasts unique views.'}},store,{dryRun:true})
  t('английские клише — отказ', cliche.outcome, 'rejected_canon')
  // Запись без описания вовсе — правило её не касается: так заводятся заглушки.
  const stub = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Заглушка места'),nameRu:'Заглушка места',siteCity:'tokyo'}},store,{dryRun:true})
  t('заглушка без описаний проходит', stub.outcome, 'created')
}

// ── Закрытые и сезонные объекты ─────────────────────────────────────────
//
// Правило владельца 10.08.2026: закрытую точку агент в программу не ставит.
// Проверки ниже стерегут границу между «нельзя ставить» и «нельзя завести»:
// это РАЗНЫЕ запреты, и первый опирается на то, что второго нет.
{
  t('закрытый навсегда — в программу нельзя', checkProgrammeUsable('Закрыт навсегда').usable, false)
  t('закрытый временно — в программу нельзя', checkProgrammeUsable('Закрыт временно').usable, false)
  t('работает — можно', checkProgrammeUsable('Работает').usable, true)
  // Сезонный без дат тура НЕ отвергается: программы часто собираются
  // до того, как даты назначены, а отказ здесь потерял бы ханами и момидзи.
  t('сезонный без дат — можно с оговоркой', checkProgrammeUsable('Сезонный').usable, true)
  t('сезонный без дат — оговорка есть', checkProgrammeUsable('Сезонный').reason !== '', true)
  // Даты сезона проверяются ниже, в блоке про окно: там формат ММ-ДД,
  // потому что сезон повторяется ежегодно и год в нём соврал бы.
  // Пустое значение — «не проверено», а не «работает».
  t('пустой статус не выдаёт себя за рабочий', applyCanon({nameRu:'Точка',siteCity:'tokyo'}).value.operatingStatus, 'Не проверено')

  // Google не видит сезонность и раз в месяц отдаёт сад слив как закрытый.
  // Прогон обязан оставить наш статус, иначе объект выпадет из программ.
  t('Google не затирает сезонность', operatingStatusFromGoogle('CLOSED_TEMPORARILY', 'Сезонный'), 'Сезонный')
  t('Google закрывает незнакомую точку', operatingStatusFromGoogle('CLOSED_PERMANENTLY', 'Работает'), 'Закрыт навсегда')

  // Закрытую точку база принимает — иначе запрет выше не на что опереть:
  // забыв о закрытии, коллектор заведёт её снова как незнакомую.
  const closed = await ingestPoi({source:{kind:'admin',id:'t'},poi:{...pt('Закрытый музей'),nameRu:'Закрытый музей',siteCity:'tokyo',operatingStatus:'Закрыт навсегда'}},store,{dryRun:true})
  t('закрытую точку завести можно', closed.outcome, 'created')
  t('статус доезжает до Airtable', closed.fields['Operating Status'], 'Закрыт навсегда')
  t('о закрытии сказано вслух', closed.canonIssues.some((i) => i.field === 'operatingStatus'), true)
}

// ── Канонические написания топонимов ────────────────────────────────────
//
// Правило владельца 14.07.2026: «Хаконе», а не «Хаконэ» — так ищут в поиске.
// До 10.08.2026 оно жило прозой в трёх местах и не стерегло ни один путь
// записи: в живой базе набралось 58 вхождений «Хаконэ», в том числе
// в утверждённых описаниях, ушедших на сайт.
{
  const r = applyCanon({nameRu:'Святилище Хаконэ Дзиндзя', siteCity:'hakone'})
  t('имя чинится каноном', r.value.nameRu, 'Святилище Хаконе Дзиндзя')
  // Производные — та причина, по которой замена идёт подстрокой.
  const d = applyCanon({nameRu:'Причал', siteCity:'hakone', descriptionRu:'Катер идёт до Мотохаконэ.', descriptionEn:'The boat runs to Motohakone.'})
  t('производное со строчной тоже чинится', d.value.descriptionRu, 'Катер идёт до Мотохаконе.')
  // Правильное написание не трогается — иначе правка ходила бы по кругу.
  const ok = applyCanon({nameRu:'Озеро Аси в Хаконе', siteCity:'hakone'})
  t('канон не переписывает сам себя', ok.value.nameRu, 'Озеро Аси в Хаконе')
}

// ── Сезонное окно ───────────────────────────────────────────────────────
//
// Года в окне нет намеренно: сад слив цветёт в конце февраля КАЖДЫЙ год.
// Первая версия проверки принимала Date, то есть требовала год, и соврала
// бы уже следующей весной — а до того выглядела бы рабочей.
{
  t('окно разбирается', parseSeasonWindow('02-20–03-15')?.from.month, 2)
  t('дефис тоже принимается', parseSeasonWindow('02-20-03-15')?.to.day, 15)
  t('мусор не разбирается', parseSeasonWindow('конец февраля'), null)
  t('13-й месяц не разбирается', parseSeasonWindow('13-01–14-02'), null)
  const plum = parseSeasonWindow('02-20–03-15')
  t('в сезоне', isInSeason(plum, new Date('2026-03-01T00:00:00Z')), true)
  t('вне сезона', isInSeason(plum, new Date('2026-07-01T00:00:00Z')), false)
  t('край окна включён', isInSeason(plum, new Date('2026-02-20T00:00:00Z')), true)
  // Окно через Новый год — не исключение: у трети сезонных объектов Японии
  // сезон зимний, и наивное «from <= now <= to» дало бы для них ВСЕГДА ложь.
  const winter = parseSeasonWindow('11-15–04-10')
  t('зимнее окно: январь внутри', isInSeason(winter, new Date('2026-01-10T00:00:00Z')), true)
  t('зимнее окно: декабрь внутри', isInSeason(winter, new Date('2026-12-20T00:00:00Z')), true)
  t('зимнее окно: июль снаружи', isInSeason(winter, new Date('2026-07-01T00:00:00Z')), false)

  const march = new Date('2026-03-01T00:00:00Z')
  t('сезонный в окне — можно', checkProgrammeUsable('Сезонный',{on:march,seasonWindow:'02-20–03-15'}).usable, true)
  t('сезонный вне окна — нельзя', checkProgrammeUsable('Сезонный',{on:new Date('2026-07-01T00:00:00Z'),seasonWindow:'02-20–03-15'}).usable, false)
  // Окна нет — не отказ, а оговорка: программы часто собираются без дат.
  t('без окна — можно с оговоркой', checkProgrammeUsable('Сезонный').usable, true)
  const r = applyCanon({nameRu:'Сад слив', siteCity:'tokyo', operatingStatus:'Сезонный'})
  t('сезонный без окна — замечание', r.issues.some(i=>i.field==='seasonWindow'), true)
  t('окно доезжает до значения', applyCanon({nameRu:'Сад', siteCity:'tokyo', operatingStatus:'Сезонный', seasonWindow:'02-20–03-15'}).value.seasonWindow, '02-20–03-15')
}

// ── Один place_id — один POI ────────────────────────────────────────────
//
// Тождество, а не сходство. Имена могут расходиться сколь угодно
// («Мыс Сирэтоко» и «Круиз к мысу Сирэтоко»), но если Google считает их
// одним местом, в базе им место одно. Правило нашлось на живой базе: мыс
// и круиз делили place_id и ВЗАИМНО подтверждали координаты друг друга,
// потому что у города не было других опор.
{
  const pidStore = {
    _pool: [{ poiId:'POI-000400', nameRu:'Мыс Сирэтоко', siteCity:'shiretoko', recordId:'recA', placeId:'PID-SHIRETOKO' }],
    async listExisting(){ return [...this._pool] },
    async findBySourceKey(){ return null },
    async create(f){ const id='POI-000999'; this._pool.push({poiId:id,nameRu:f['POI Name (RU)'],siteCity:f['Site City'],recordId:'recNew'}); return {poiId:id,recordId:'recNew'} },
  }
  const req = (nameRu, placeId) => ({
    source:{kind:'admin',id:'t'},
    poi:{...pt(nameRu),nameRu, siteCity:'shiretoko', descriptionRu:'Описание объекта.', descriptionEn:'Object description.', resolved:{placeId,...pt(nameRu).resolved && {lat:pt(nameRu).lat,lon:pt(nameRu).lon}}},
  })
  const clash = await ingestPoi(req('Круиз к мысу Сирэтоко','PID-SHIRETOKO'), pidStore, {dryRun:true})
  t('тот же place_id блокируется', clash.outcome, 'blocked_duplicate')
  t('и показывает, кем занято', clash.poiId, 'POI-000400')
  const other = await ingestPoi(req('Водопад Фурэпэ','PID-FUREPE'), pidStore, {dryRun:true})
  t('другой place_id проходит', other.outcome, 'created')
  t('place_id доезжает до Airtable', other.fields['Google Place ID'], 'PID-FUREPE')
  // force — осознанное решение владельца, а не путь по умолчанию.
  const forced = await ingestPoi(req('Круиз к мысу Сирэтоко','PID-SHIRETOKO'), pidStore, {dryRun:true, force:true})
  t('force проходит поверх', forced.outcome, 'created')
  // Без place_id правило молчит: у половины базы его нет, и блокировать
  // по пустому значению значило бы склеить всё, что ещё не опознано.
  const noPid = await ingestPoi(req('Озеро Расяу', undefined), pidStore, {dryRun:true})
  // Ось тождества по-прежнему молчит: пустое значение никого не блокирует.
  // Останавливает запись другая причина — без опознанного места происхождение
  // точки не подтверждено, и это отдельный вердикт, а не склейка по пустому
  // place_id. Раньше здесь стояло 'created': тогда точка без происхождения
  // заводилась молча.
  t('пустой place_id не блокирует по тождеству', noPid.outcome !== 'blocked_duplicate', true)
  t('но без опознанного места происхождение не подтверждено', noPid.coordinatePolicy?.refusal, 'unknownProvenance')
}


// ── Маркеры приёма ──────────────────────────────────────────────────────
// Каждая созданная запись обязана нести след того, каким запуском и каким
// контрактом она заведена. Без этого запись из конвейера неотличима от
// заведённой мимо — а именно так 10.08.2026 в базу попали 24 пустых POI.
{
  const one = await ingestPoi(req('Храм Тэнрюдзи','kyoto'), geoStore([]), {runId:'run-fixed-1'})
  t('маркер запуска записан', one.fields['Intake Run ID'], 'run-fixed-1')
  t('маркер источника составной', one.fields['Intake Origin'], 'portal-collector:test')
  t('версия контракта из константы', one.fields['Intake Contract Version'], POI_INTAKE_CONTRACT_VERSION)
  t('origin собирается ядром', buildIntakeOrigin({kind:'portal-collector',id:'bodik-osaka-tourism'}), 'portal-collector:bodik-osaka-tourism')

  // Без переданного ID запуск состоит из одной записи, но ID всё равно есть.
  const solo = await ingestPoi(req('Храм Кодайдзи','kyoto'), geoStore([]))
  t('без переданного ID маркер не пустой', typeof solo.fields['Intake Run ID'] === 'string' && solo.fields['Intake Run ID'].length > 10, true)

  // Версию подменить нельзя: она не параметр, и лишние опции игнорируются.
  const spoof = await ingestPoi(req('Храм Дзэнриндзи','kyoto'), geoStore([]),
    {contractVersion:'poi-intake/v999', 'Intake Contract Version':'подделка'})
  t('версию нельзя подменить вызывающим кодом', spoof.fields['Intake Contract Version'], POI_INTAKE_CONTRACT_VERSION)

  // dryRun обязан показывать маркеры: коллектор смотрит именно этот набор.
  const dry = await ingestPoi(req('Храм Нандзэндзи','kyoto'), geoStore([]), {dryRun:true, runId:'run-dry'})
  t('dryRun показывает маркер запуска', dry.fields['Intake Run ID'], 'run-dry')
  t('dryRun показывает версию', dry.fields['Intake Contract Version'], POI_INTAKE_CONTRACT_VERSION)

  // Весь пакет — один запуск.
  const batchRes = await ingestPoiBatch(
    [req('Храм Сандзюсангэндо','kyoto'), req('Храм Рёандзи','kyoto'), req('Храм Дайтокудзи','kyoto')],
    geoStore([]))
  const runIds = new Set(batchRes.filter(r=>r.fields).map(r=>r.fields['Intake Run ID']))
  t('пакет создал все три', batchRes.filter(r=>r.outcome==='created').length, 3)
  t('и все под одним ID запуска', runIds.size, 1)

  // Неуспешный исход не пишет ничего — маркеров тоже нет.
  const dupStore = geoStore([{poiId:'POI-000800',nameRu:'Храм Тэнрюдзи',siteCity:'kyoto',recordId:'recD'}])
  const blocked = await ingestPoi(req('Храм Тэнрюдзи','kyoto'), dupStore, {runId:'run-blocked'})
  t('дубль не пишет полей', blocked.fields, null)
  const badCanon = await ingestPoi(req('Что-то',''), geoStore([]), {runId:'run-canon'})
  t('отказ канона не пишет полей', badCanon.fields, null)
  const nearby = geoStore([{poiId:'POI-000801',nameRu:'Ворота Нандаймон',siteCity:'nara',lat:34.6890,lon:135.8390,recordId:'recE'}])
  const stopped = await ingestPoi(withCoords('Храм Тодайдзи','nara',34.6892,135.8392), nearby, {runId:'run-stop'})
  t('остановка не пишет полей', stopped.outcome === 'needs_review' && stopped.fields === null, true)

  // ── Контракт вызова: проверяется до хранилища и до сети ───────────────
  const err = async (fn) => { try { await fn(); return 'без ошибки' } catch (e) { return e.message } }
  const exploding = { async listExisting(){ throw new Error('до хранилища дойти не должно') },
    async findBySourceKey(){ throw new Error('до хранилища дойти не должно') },
    async create(){ throw new Error('до записи дойти не должно') } }

  t('пустой runId — ошибка контракта',
    /пустой runId/.test(await err(() => ingestPoi(req('Храм А','kyoto'), exploding, {runId:''}))), true)
  t('пробельный runId — тоже ошибка',
    /пустой runId/.test(await err(() => ingestPoi(req('Храм Б','kyoto'), exploding, {runId:'  '}))), true)
  t('не переданный runId ошибкой не является', typeof resolveIntakeRunId(undefined), 'string')
  t('переданный runId обрезается', resolveIntakeRunId(' run-x '), 'run-x')

  t('пустой source.id — ошибка контракта',
    /source\.id пуст/.test(await err(() => ingestPoi({source:{kind:'portal-collector',id:'  '},poi:{nameRu:'Храм В',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}}, exploding))), true)
  t('двоеточие в source.id — ошибка контракта',
    /не слаг/.test(await err(() => ingestPoi({source:{kind:'portal-collector',id:'foo:bar'},poi:{nameRu:'Храм Г',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}}, exploding))), true)
  t('пробел в source.id — ошибка контракта',
    /не слаг/.test(await err(() => ingestPoi({source:{kind:'portal-collector',id:'bodik osaka'},poi:{nameRu:'Храм Д',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}}, exploding))), true)
  t('обычный слаг проходит', buildIntakeOrigin({kind:'telegram-agent',id:'poi-intake-bot'}), 'telegram-agent:poi-intake-bot')

  // Регистр жёсткий: с флагом i «BODIK» и «bodik» дали бы два разных origin
  // для одного источника, и группировка по происхождению распалась бы надвое.
  t('заглавные в source.id — ошибка контракта',
    /не слаг/.test(await err(() => ingestPoi({source:{kind:'portal-collector',id:'BODIK'},poi:{nameRu:'Храм Е',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}}, exploding))), true)

  // ── Пакет: контракт проверяется ДО чтения хранилища ───────────────────
  // Снимок базы — это сеть и время. Падать после него из-за опечатки в
  // идентификаторе значит платить за работу, которая не понадобится.
  const batchExploding = { async listExisting(){ throw new Error('хранилище не должно опрашиваться') },
    async findBySourceKey(){ throw new Error('хранилище не должно опрашиваться') },
    async create(){ throw new Error('до записи дойти не должно') } }

  const batchEmptyRun = await err(() => ingestPoiBatch([req('Храм Ж','kyoto')], batchExploding, {runId:''}))
  t('пакет: пустой runId — ошибка контракта', /пустой runId/.test(batchEmptyRun), true)
  t('пакет: и хранилище не читалось', /хранилище/.test(batchEmptyRun), false)

  // Битый идентификатор на третьей строке отказывает весь пакет сразу,
  // а не на третьей записи, оставив две заведёнными.
  const badThird = await err(() => ingestPoiBatch([
    req('Храм З','kyoto'), req('Храм И','kyoto'),
    {source:{kind:'portal-collector',id:'foo:bar'},poi:{nameRu:'Храм К',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}},
  ], batchExploding))
  t('пакет: битый source.id отказывает целиком', /не слаг/.test(badThird), true)
  t('пакет: и до хранилища не дошли', /хранилище/.test(badThird), false)

  // ── Неизвестный source.kind ───────────────────────────────────────────
  // Союз типов защищает вызовы из TypeScript и ничего не значит для .mjs:
  // коллектор порталов и разовые скрипты — обычный JavaScript. До 11.08.2026
  // kind: 'rogue-writer' доезжал до Airtable, и проверка базы ловила такой
  // origin уже ПОСЛЕ записи, то есть на день позже, чем нужно.
  const rogue = (nameRu) => ({source:{kind:'rogue-writer',id:'test'},
    poi:{nameRu,siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}})

  const badKind = await err(() => ingestPoi(rogue('Храм Л'), exploding))
  t('неизвестный kind — ошибка контракта', /неизвестный source\.kind/.test(badKind), true)
  t('и в сообщении перечислены допустимые', /telegram-agent/.test(badKind), true)
  t('и до хранилища не дошли', /хранилище/.test(badKind), false)

  const badKindBatch = await err(() => ingestPoiBatch([req('Храм М','kyoto'), rogue('Храм Н')], batchExploding))
  t('пакет: неизвестный kind отказывает целиком', /неизвестный source\.kind/.test(badKindBatch), true)
  t('пакет: и хранилище не читалось', /хранилище/.test(badKindBatch), false)

  t('известный kind проходит', buildIntakeOrigin({kind:'manual-import',id:'seed.2026'}), 'manual-import:seed.2026')
  t('пустой kind — тоже ошибка',
    /неизвестный source\.kind/.test(await err(() => ingestPoi({source:{kind:'',id:'test'},poi:{nameRu:'Храм О',siteCity:'kyoto',descriptionRu:'Т.',descriptionEn:'T.'}}, exploding))), true)
}

// ── Именованная коллекция ЧЕРЕЗ НАСТОЯЩИЙ ПРИЁМ ───────────────────────────
//
// Матчер можно починить так, что в отчёте целостности станет зелено, а приём
// продолжит блокировать: check:poi смотрит только на blockingDuplicate,
// а ingestPoi ведёт всю цепочку до записи. Поэтому исход проверяется НЕ по
// строке результата, а по тому, ВЫЗВАН ЛИ store.create().
{
  const AT = {lat:34.4622, lon:134.0322}
  const M122 = {lat:34.4633, lon:134.0322}
  const M3 = {lat:34.46222, lon:134.03222}

  /** Хранилище, считающее записи. Пул задаётся снаружи. */
  const countingStore = (pool) => ({
    _pool: pool, created: 0, lastFields: null,
    async listExisting(){ return [...this._pool] },
    async findBySourceKey(){ return null },
    async create(f){ this.created += 1; this.lastFields = f
      const id = `POI-${String(600+this._pool.length).padStart(6,'0')}`
      this._pool.push({poiId:id,nameRu:f['POI Name (RU)'],nameEn:f['POI Name (EN)'],
        siteCity:f['Site City'],lat:f.Latitude??undefined,lon:f.Longitude??undefined,recordId:'rec'+id})
      return {poiId:id, recordId:'rec'+id} },
  })
  const house = (nameRu, nameEn, geo) => ({
    source:{kind:'portal-collector',id:'naoshima'},
    poi:{nameRu,nameEn,siteCity:'naoshima',...geo,...(geo && geo.lat !== undefined ? {resolved:{placeId:`PID-${nameEn}`,lat:geo.lat,lon:geo.lon}} : pt(nameRu)),
      descriptionRu:'Описание объекта.',descriptionEn:'Object description.',categoriesRu:['Художественный музей']},
  })
  const kadoya = () => [{poiId:'POI-000601',nameRu:'Дом-проект: Кадоя',
    nameEn:'Art House Project: Kadoya',siteCity:'naoshima',recordId:'rec601',...AT}]

  // 12. Существующий Kadoya не мешает завести Kinza в 122 метрах.
  {
    const store = countingStore(kadoya())
    const r = await ingestPoi(house('Дом-проект: Киндза','Art House Project: Kinza',M122), store)
    t('12. соседний объект коллекции принят', r.outcome, 'created')
    t('12. и store.create() действительно вызван', store.created, 1)
    t('12. записан именно Киндза', store.lastFields['POI Name (RU)'], 'Дом-проект: Киндза')
  }

  // 12б. Тот же объект в ДРУГОЙ коллекции того же алфавита не мешает.
  // Без сравнения имён коллекций эта пара даёт 1,0 и запись не создаётся.
  {
    // Английского имени у соседа нет намеренно: здесь проверяется сравнение
    // коллекций ВНУТРИ одного алфавита. Межалфавитный случай — ниже, 14в.
    const store = countingStore([{poiId:'POI-000540',nameRu:'Этиго-Цумари: Кадоя',
      nameEn:'',siteCity:'naoshima',recordId:'rec540',...AT}])
    const r = await ingestPoi(house('Дом-проект: Кадоя','',M122), store)
    t('12б. чужая коллекция не мешает завести объект', r.outcome, 'created')
    t('12б. и store.create() вызван', store.created, 1)
  }

  // 13. Повторный Kadoya остаётся заблокированным.
  {
    const store = countingStore(kadoya())
    const r = await ingestPoi(house('Дом-проект: Кадоя','Art House Project: Kadoya',M3), store)
    t('13. повтор объекта заблокирован', r.outcome, 'blocked_duplicate')
    // 14. Главное: до хранилища дело не дошло. Строка результата без этой
    // проверки ничего не гарантирует — запись могла уже уйти в базу.
    t('14. store.create() НЕ вызван', store.created, 0)
  }

  // 14б. Настоящий дубль с уточнением места тоже не доезжает до записи.
  // Именно эта пара падала до 0,6087 и проходила молча.
  {
    const store = countingStore(kadoya())
    const r = await ingestPoi(house('Дом-проект: Кадоя (Наосима)','Art House Project: Kadoya (Naoshima)',M3), store)
    t('14б. дубль с уточнением места заблокирован', r.outcome, 'blocked_duplicate')
    t('14б. и store.create() НЕ вызван', store.created, 0)
  }

  // 14в. Чужая коллекция через другой алфавит: совпал только объект.
  // Блокировать нечем, но и записывать молча нельзя — приём останавливается.
  {
    const store = countingStore([{poiId:'POI-000900',nameRu:'',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec900',...AT}])
    const r = await ingestPoi(house('Дом-проект: Кадоя','',M122), store)
    t('14в. недоказанная коллекция не блокирует', r.outcome === 'blocked_duplicate', false)
    t('14в. но и не записывается молча', store.created, 0)
  }
  // 14г. FORCE СОХРАНЯЕТ ДОКАЗАТЕЛЬСТВО.
  // Недоказанное равенство коллекций останавливает приём; запись попадает
  // в базу только через force. Если бы свидетельство при этом терялось,
  // в базе осталась бы точка без единого следа того, почему её пропустили,
  // — а найти такие потом можно только по Notes.
  {
    const store = countingStore([{poiId:'POI-000900',nameRu:'',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec900',...AT}])
    const r = await ingestPoi(house('Дом-проект: Кадоя','',M122), store, {force:true})
    t('14г. force заводит запись', r.outcome, 'created')
    t('14г. store.create() вызван ровно раз', store.created, 1)
    const notes = store.lastFields?.Notes ?? ''
    t('14г. в Notes есть отметка о недоказанной коллекции', /КОЛЛЕКЦИЯ НЕ ПОДТВЕРЖДЕНА/.test(notes), true)
    t('14г. в Notes есть POI ID пары', notes.includes('POI-000900'), true)
    t('14г. в Notes есть имя пары', notes.includes('Echigo-Tsumari: Kadoya'), true)
    t('14г. в Notes есть вес', /вес 0\.85/.test(notes), true)
    t('14г. в Notes названа победившая ось', /по оси /.test(notes), true)
    t('14г. в Notes названо расхождение по смыслу', /расхождения: имена коллекций сравнить нечем/.test(notes), true)
    t('14г. в Notes есть причина', /транслитерацией не сошлись/.test(notes), true)
  }

  // 14д. Без force та же пара запись НЕ создаёт — force не становится
  // умолчанием оттого, что мы научились писать причину.
  {
    const store = countingStore([{poiId:'POI-000900',nameRu:'',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec900',...AT}])
    const r = await ingestPoi(house('Дом-проект: Кадоя','',M122), store)
    t('14д. без force остановка', r.outcome, 'needs_review')
    t('14д. и ничего не записано', store.created, 0)
  }

  // 14е. НЕСВЕРЕННОЕ УТОЧНЕНИЕ: force заводит запись и сохраняет пару.
  // Вес такой пары ниже порога показа, duplicates пуст — без отдельной
  // строки в Notes запись легла бы в базу без единого следа того, что
  // рядом стоит объект с той же основой имени.
  {
    const store = countingStore([{poiId:'POI-000561',nameRu:'',
      nameEn:'Art House Project: Kadoya (East)',siteCity:'naoshima',recordId:'rec561',...AT}])
    const req = house('','Art House Project: Kadoya (Восток)',M122)
    req.poi.nameRu = 'Дом-проект: Кадоя (Восток)'
    const soft = await ingestPoi(req, countingStore([{poiId:'POI-000561',nameRu:'',
      nameEn:'Art House Project: Kadoya (East)',siteCity:'naoshima',recordId:'rec561',...AT}]))
    t('14е. без force несверенное уточнение останавливает', soft.outcome, 'needs_review')

    const r = await ingestPoi(req, store, {force:true})
    t('14е. force заводит запись', r.outcome, 'created')
    t('14е. store.create() вызван ровно раз', store.created, 1)
    const notes = store.lastFields?.Notes ?? ''
    t('14е. в Notes есть отметка о несверенном уточнении', /УТОЧНЕНИЕ НЕ СВЕРЕНО/.test(notes), true)
    t('14е. в Notes есть POI ID пары', notes.includes('POI-000561'), true)
    t('14е. в Notes есть имя пары', notes.includes('Art House Project: Kadoya (East)'), true)
    t('14е. в Notes есть вес', /вес 0\.\d+/.test(notes), true)
    t('14е. в Notes названа победившая ось', /по оси /.test(notes), true)
    t('14е. в Notes есть причина', /переведённым уточнением/.test(notes), true)
  }

  // 14ж. РАСХОЖДЕНИЕ ОСЕЙ: force заводит запись и сохраняет обе стороны —
  // чем набран вес и что именно расходится. Раньше такая пара блокировалась
  // как дубль по совпавшему русскому имени, и английское противоречие
  // не доезжало ни до вердикта, ни до записи.
  {
    const store = countingStore([{poiId:'POI-000562',nameRu:'Дом-проект: Кадоя',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec562',...AT}])
    const req = house('Дом-проект: Кадоя','Art House Project: Kadoya',M122)

    const soft = await ingestPoi(req, countingStore([{poiId:'POI-000562',nameRu:'Дом-проект: Кадоя',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec562',...AT}]))
    t('14ж. без force расхождение осей останавливает', soft.outcome, 'needs_review')
    t('14ж. и не блокирует как дубль', soft.outcome === 'blocked_duplicate', false)

    const r = await ingestPoi(req, store, {force:true})
    t('14ж. force заводит запись', r.outcome, 'created')
    t('14ж. store.create() вызван ровно раз', store.created, 1)
    const notes = store.lastFields?.Notes ?? ''
    t('14ж. в Notes есть отметка о расхождении', /КОЛЛЕКЦИИ РАСХОДЯТСЯ/.test(notes), true)
    t('14ж. в Notes есть POI ID пары', notes.includes('POI-000562'), true)
    t('14ж. в Notes названа победившая ось', /по оси ru↔ru/.test(notes), true)
    t('14ж. в Notes названо расхождение по смыслу', /расхождения: коллекции разные \(en↔en\)/.test(notes), true)
    t('14ж. в Notes есть вес', /вес 1/.test(notes), true)
  }

  // 14з. СОСТАВНОЕ РАСХОЖДЕНИЕ: force заводит запись, и Notes называют
  // ОБА вида по смыслу, а не только оси. Пока каналы были взаимоисключающими,
  // в записи оставалось одно расхождение из двух.
  {
    const store = countingStore([{poiId:'POI-000562',nameRu:'Дом-проект: Кадоя (Запад)',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec562',...AT}])
    const req = house('Дом-проект: Кадоя (Восток)','Art House Project: Kadoya',M122)

    const soft = await ingestPoi(req, countingStore([{poiId:'POI-000562',nameRu:'Дом-проект: Кадоя (Запад)',
      nameEn:'Echigo-Tsumari: Kadoya',siteCity:'naoshima',recordId:'rec562',...AT}]))
    t('14з. без force составное расхождение останавливает', soft.outcome, 'needs_review')

    const r = await ingestPoi(req, store, {force:true})
    t('14з. force заводит запись', r.outcome, 'created')
    t('14з. store.create() вызван ровно раз', store.created, 1)
    const notes = store.lastFields?.Notes ?? ''
    t('14з. в Notes названо расхождение по уточнениям',
      /расхождения:[^\n]*уточнения в скобках не сверены/.test(notes), true)
    t('14з. и расхождение по коллекциям — в той же записи',
      /расхождения:[^\n]*коллекции разные/.test(notes), true)
    t('14з. оба вида названы по смыслу, а не только осями',
      /уточнения в скобках не сверены \(ru↔ru\)/.test(notes) && /коллекции разные \(en↔en\)/.test(notes), true)
    t('14з. и обе метки строк присутствуют',
      /УТОЧНЕНИЕ НЕ СВЕРЕНО/.test(notes) && /КОЛЛЕКЦИИ РАСХОДЯТСЯ/.test(notes), true)
  }

}

console.log(bad.length?`✗ провалено ${bad.length}:\n  `+bad.join('\n  '):`✓ ingest: ${ok} проверок пройдено`)
process.exitCode = bad.length?1:0
