import { ingestPoi, ingestPoiBatch } from '../src/lib/poi-ingest.ts'
import { applyCanon, canonicalCity, canonicalCoords, canonicalWorkingHours, checkProgrammeUsable, findBannedWords, operatingStatusFromGoogle } from '../src/lib/poi-canon.ts'

let ok=0, bad=[]
const t=(l,a,e)=>{ a===e?ok++:bad.push(`${l}: ждали ${e}, получили ${a}`) }

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
const req=(nameRu,city,extra={})=>({source:{kind:'portal-collector',id:'test',...extra},poi:{nameRu,siteCity:city,descriptionRu:'Описание объекта.',descriptionEn:'Object description.',categoriesRu:['Буддийский храм']}})

t('дубль блокируется', (await ingestPoi(req('Храм Токэйдзи','kamakura'),store)).outcome, 'blocked_duplicate')
t('новый создаётся', (await ingestPoi(req('Храм Гокуракудзи','kamakura'),store)).outcome, 'created')
t('без города — отказ', (await ingestPoi(req('Что-то',''),store)).outcome, 'rejected_canon')
// Латинские часы отбрасываются ВМЕСТЕ С ПОЛЕМ, а не вместе с записью.
// Правило заведено ради того, чтобы клиент не увидел латиницу на сайте;
// отказ всей точки эту цель не приближает. Прогон Киото стоил пяти
// настоящих POI, потерянных из-за одного поля.
{
  const r = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Тест часов',siteCity:'tokyo',workingHours:'Typically 9:00 to 17:00'}},store,{dryRun:true})
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
  poi:{nameRu,siteCity:city,lat,lon,descriptionRu:'Описание объекта.',descriptionEn:'Object description.',categoriesRu:['Буддийский храм']},
})

const coordFields = (await ingestPoi(withCoords('Храм Энгакудзи','kamakura',35.3376,139.5470), geoStore([]), {dryRun:true})).fields
t('широта записана', coordFields.Latitude, 35.3376)
t('долгота записана', coordFields.Longitude, 139.547)

// Межалфавитная пара: по именам это максимум 0,85 — ниже порога блокировки.
// Одни и те же координаты поднимают её до уверенного дубля.
const crossScript = [{poiId:'POI-000700',nameRu:'',nameEn:'Tokeiji Temple',siteCity:'kamakura',lat:35.3363,lon:139.5433,recordId:'recX'}]
t('без координат межалфавитная пара проходит',
  (await ingestPoi({source:{kind:'portal-collector',id:'geo'},poi:{nameRu:'Храм Токэйдзи',siteCity:'kamakura',descriptionRu:'Текст.',descriptionEn:'Text.'}}, geoStore([...crossScript]))).outcome,
  'created')
t('координаты превращают её в дубль',
  (await ingestPoi(withCoords('Храм Токэйдзи','kamakura',35.3364,139.5434), geoStore([...crossScript]))).outcome,
  'blocked_duplicate')

// Обратная сторона: точное совпадение имён при двух километрах — тёзка.
const namesake = [{poiId:'POI-000701',nameRu:'Храм Дзёдзёдзи',siteCity:'tokyo',lat:35.6574,lon:139.7480,recordId:'recY'}]
const far = await ingestPoi(withCoords('Храм Дзёдзёдзи','tokyo',35.7101,139.8107), geoStore([...namesake]))
t('расстояние снимает блокировку тёзки', far.outcome, 'created')
t('и оставляет её на проверку', far.screen.verdict, 'needs_review')

// Непохожие имена в сорока метрах — не дубль, но владельцу это показывают.
const complex = [{poiId:'POI-000702',nameRu:'Ворота Нандаймон',siteCity:'nara',lat:34.6890,lon:135.8390,recordId:'recZ'}]
const neighbour = await ingestPoi(withCoords('Храм Тодайдзи','nara',34.6892,135.8392), geoStore([...complex]))
t('сосед по координатам не блокирует', neighbour.outcome, 'created')
t('но попадает в Notes', /РЯДОМ \(по координатам\): POI-000702/.test(neighbour.fields.Notes), true)

// ── Описание заводится только парой ─────────────────────────────────────
// На живой базе 121 запись из 431 имела русский текст и ни одного
// английского, обратных случаев — ноль. Односторонний перекос: путь
// записи молча терял английский, который исследователь возвращал.
{
  const half = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Только по-русски',siteCity:'tokyo',descriptionRu:'Есть русский текст.'}},store,{dryRun:true})
  t('русский без английского — отказ', half.outcome, 'rejected_canon')
  const both = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Оба языка',siteCity:'tokyo',descriptionRu:'Есть русский.',descriptionEn:'English present.'}},store,{dryRun:true})
  t('пара проходит', both.outcome, 'created')
  t('английский попадает в черновик', both.fields['Description Draft (EN)'], 'English present.')
  // У английского СВОЯ типографика, а не отсутствие типографики.
  // Русский канон к нему неприменим: «ёлочки» и запятая вместо точки
  // в дробях для английского — порча. Но прямые кавычки всё равно
  // выправляются — в английские парные, а не в «ёлочки».
  const typo = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Кавычки',siteCity:'tokyo',descriptionRu:'Русский текст.',descriptionEn:'A "quoted" 2.5 km walk with 15 000 people.'}},store,{dryRun:true})
  t('кавычки — английские парные', typo.fields['Description Draft (EN)'].includes('“quoted”'), true)
  t('десятичная точка сохранена', typo.fields['Description Draft (EN)'].includes('2.5 km'), true)
  t('разряды — запятой, не пробелом', typo.fields['Description Draft (EN)'].includes('15,000'), true)
  // Клише англоязычного травел-копирайтинга канон отвергает так же
  // жёстко, как русские «уникальный» и «незабываемый».
  const cliche = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Клише',siteCity:'tokyo',descriptionRu:'Русский текст.',descriptionEn:'A stunning temple that boasts unique views.'}},store,{dryRun:true})
  t('английские клише — отказ', cliche.outcome, 'rejected_canon')
  // Запись без описания вовсе — правило её не касается: так заводятся заглушки.
  const stub = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Заглушка места',siteCity:'tokyo'}},store,{dryRun:true})
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
  const march = new Date('2026-03-10')
  const season = { on: march, seasonFrom: new Date('2026-02-20'), seasonTo: new Date('2026-03-15') }
  t('сезонный в окне — можно', checkProgrammeUsable('Сезонный', season).usable, true)
  const july = { on: new Date('2026-07-01'), seasonFrom: new Date('2026-02-20'), seasonTo: new Date('2026-03-15') }
  t('сезонный вне окна — нельзя', checkProgrammeUsable('Сезонный', july).usable, false)
  // Пустое значение — «не проверено», а не «работает».
  t('пустой статус не выдаёт себя за рабочий', applyCanon({nameRu:'Точка',siteCity:'tokyo'}).value.operatingStatus, 'Не проверено')

  // Google не видит сезонность и раз в месяц отдаёт сад слив как закрытый.
  // Прогон обязан оставить наш статус, иначе объект выпадет из программ.
  t('Google не затирает сезонность', operatingStatusFromGoogle('CLOSED_TEMPORARILY', 'Сезонный'), 'Сезонный')
  t('Google закрывает незнакомую точку', operatingStatusFromGoogle('CLOSED_PERMANENTLY', 'Работает'), 'Закрыт навсегда')

  // Закрытую точку база принимает — иначе запрет выше не на что опереть:
  // забыв о закрытии, коллектор заведёт её снова как незнакомую.
  const closed = await ingestPoi({source:{kind:'admin',id:'t'},poi:{nameRu:'Закрытый музей',siteCity:'tokyo',operatingStatus:'Закрыт навсегда'}},store,{dryRun:true})
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

console.log(bad.length?`✗ провалено ${bad.length}:\n  `+bad.join('\n  '):`✓ ingest: ${ok} проверок пройдено`)
process.exitCode = bad.length?1:0
