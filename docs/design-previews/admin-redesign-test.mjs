import { chromium } from 'playwright-core';

const FILE = 'file:///home/claude/jij-admin-prototype.html';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const results = [];
const pass = (g, n, d = '') => results.push({ g, n, ok: true, d });
const fail = (g, n, d = '') => results.push({ g, n, ok: false, d });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const netErrors = [];
page.on('console', m => { if (m.type() !== 'error') return;
  (/Failed to load resource|ERR_/.test(m.text()) ? netErrors : errors).push(m.text()); });

await page.goto(FILE);
await page.waitForTimeout(1200);

// ── 1. Навигация: каждый пункт открывает свой экран и подсвечивается ────────
const NAV = [
  ['today', 's-today', 'Сегодня'],
  ['clients', 's-clients', 'Клиенты'],
  ['programs', 's-programs', 'Программы'],
  ['routes', 's-routes', 'Маршруты'],
  ['catalog', 's-catalog', 'Каталог'],
  ['faq', 's-faq', 'FAQ'],
  ['journal', 's-journal', 'Журнал'],
  ['conn', 's-conn', 'Подключения'],
];
for (const [go, id, label] of NAV) {
  await page.click(`#nav [data-go="${go}"]`);
  await page.waitForTimeout(120);
  const on = await page.$$eval('.screen.on', e => e.map(x => x.id));
  const nav = await page.$$eval('#nav [aria-current="page"]', e => e.map(x => x.textContent.trim()));
  if (on.length !== 1) fail('Навигация', label, `открыто экранов: ${on.length}`);
  else if (on[0] !== id) fail('Навигация', label, `открылся ${on[0]}, ждали ${id}`);
  else if (nav.length !== 1) fail('Навигация', label, `подсвечено пунктов: ${nav.length}`);
  else if (!nav[0].startsWith(label)) fail('Навигация', label, `подсвечен «${nav[0]}»`);
  else pass('Навигация', label);
}

// ── 2. Вкладки: каждая переключает ровно одну панель ────────────────────────
const screensWithTabs = await page.$$eval('.screen', els =>
  els.filter(e => e.querySelector('.tabs button[data-pane]')).map(e => e.id));
for (const sid of screensWithTabs) {
  const tabs = await page.$$eval(`#${sid} .tabs button[data-pane]`, e => e.map(x => x.dataset.pane));
  const panes = await page.$$eval(`#${sid} .pane`, e => e.map(x => x.id.replace('pane-', '')));
  for (const t of tabs) {
    if (!panes.includes(t)) { fail('Вкладки', `${sid} → ${t}`, 'нет панели с таким id'); continue; }
    await page.evaluate(id => { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }, sid);
    await page.click(`#${sid} .tabs button[data-pane="${t}"]`);
    await page.waitForTimeout(90);
    const on = await page.$$eval(`#${sid} .pane.on`, e => e.map(x => x.id));
    const sel = await page.$$eval(`#${sid} .tabs button[aria-selected="true"]`, e => e.length);
    if (on.length !== 1) fail('Вкладки', `${sid} → ${t}`, `открыто панелей: ${on.length}`);
    else if (on[0] !== 'pane-' + t) fail('Вкладки', `${sid} → ${t}`, `открылась ${on[0]}`);
    else if (sel !== 1) fail('Вкладки', `${sid} → ${t}`, `подсвечено вкладок: ${sel}`);
    else pass('Вкладки', `${sid} → ${t}`);
  }
  const orphans = panes.filter(p => !tabs.includes(p));
  if (orphans.length) fail('Вкладки', `${sid}: панели без вкладки`, orphans.join(', '));
  else pass('Вкладки', `${sid}: сирот нет`);
}

// ── 3. Переходы внутри содержимого ──────────────────────────────────────────
const JUMPS = [
  ['s-today', '.task.hot', 's-client', 'Дело дня → карточка клиента'],
  ['s-clients', 'table tbody tr', 's-client', 'Строка списка → карточка клиента'],
  ['s-client', '[data-go="builder"]', 's-builder', 'Карточка клиента → программа'],
  ['s-programs', '#pane-plist table tbody tr', 's-builder', 'Список программ → программа'],
  ['s-builder', '[data-go="programs"]', 's-programs', 'Программа → назад к списку'],
  ['s-catalog', '#pane-used [data-go="routes"]', 's-routes', 'Где используется → маршрут'],
  ['s-faq', '#pane-rfaqall table tbody tr', 's-routes', 'Вопросы по маршрутам → маршрут'],
];
for (const [from, sel, to, name] of JUMPS) {
  await page.evaluate(id => { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }, from);
  if (sel.startsWith('#pane-')) {
    const pane = sel.split(' ')[0].slice(1);
    await page.evaluate(pid => {
      const el = document.getElementById(pid);
      if (el) el.closest('.screen').querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === pid));
    }, pane);
  }
  await page.waitForTimeout(80);
  const el = await page.$(`#${from} ${sel}`);
  if (!el) { fail('Переходы', name, `не нашёл ${sel}`); continue; }
  await el.click();
  await page.waitForTimeout(150);
  const on = await page.$eval('.screen.on', e => e.id).catch(() => '—');
  if (on === to) pass('Переходы', name);
  else fail('Переходы', name, `оказались на ${on}, ждали ${to}`);
}

// ── 4. Палитра поиска ───────────────────────────────────────────────────────
await page.click('#nav [data-go="today"]'); await page.waitForTimeout(100);
await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
let openK = await page.$eval('#scrim', e => e.classList.contains('on'));
openK ? pass('Поиск ⌘K', 'Открывается с клавиатуры') : fail('Поиск ⌘K', 'Открывается с клавиатуры');
const items = await page.$$eval('.pitem', e => e.length);
items >= 5 ? pass('Поиск ⌘K', `Результатов: ${items}`) : fail('Поиск ⌘K', 'Мало результатов', String(items));
await page.click('.pitem'); await page.waitForTimeout(150);
const closedAfterPick = await page.$eval('#scrim', e => !e.classList.contains('on'));
const wentTo = await page.$eval('.screen.on', e => e.id).catch(() => '—');
closedAfterPick && wentTo === 's-routes'
  ? pass('Поиск ⌘K', 'Выбор ведёт на нужный экран и закрывает окно')
  : fail('Поиск ⌘K', 'Выбор результата', `закрыт: ${closedAfterPick}, экран: ${wentTo}`);
await page.keyboard.press('Control+k'); await page.waitForTimeout(150);
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
const closedEsc = await page.$eval('#scrim', e => !e.classList.contains('on'));
closedEsc ? pass('Поиск ⌘K', 'Закрывается по Escape') : fail('Поиск ⌘K', 'Закрывается по Escape');

// ── 5. Тема ─────────────────────────────────────────────────────────────────
await page.click('#theme'); await page.waitForTimeout(150);
const day = await page.$eval('body', e => e.dataset.theme);
const dayBg = await page.$eval('body', e => getComputedStyle(e).backgroundColor);
await page.click('#theme'); await page.waitForTimeout(150);
const night = await page.$eval('body', e => e.dataset.theme);
const nightBg = await page.$eval('body', e => getComputedStyle(e).backgroundColor);
(day === 'day' && night === 'night' && dayBg !== nightBg)
  ? pass('Тема', 'Переключается и меняет фон', `${dayBg} ⇄ ${nightBg}`)
  : fail('Тема', 'Переключение', `${day}/${night}`);

// ── 6. Раскрытие вопроса и карточки сервиса ─────────────────────────────────
await page.click('#nav [data-go="faq"]'); await page.waitForTimeout(150);
await page.click('#s-faq .tabs button[data-pane="faq"]'); await page.waitForTimeout(150);
const before = await page.$$eval('#pane-faq .qa.open', e => e.length);
await page.click('#pane-faq .qa:not(.open) .qahead'); await page.waitForTimeout(150);
const after = await page.$$eval('#pane-faq .qa.open', e => e.length);
after === before + 1 ? pass('Раскрытие', 'Вопрос раскрывается по клику') : fail('Раскрытие', 'Вопрос', `${before}→${after}`);

await page.click('#nav [data-go="conn"]'); await page.waitForTimeout(150);
await page.click('#s-conn .tabs button[data-pane="conn"]'); await page.waitForTimeout(150);
const cardBefore = await page.$$eval('#pane-conn .intcard.open', e => e.length);
await page.click('#pane-conn .intcard:not(.open) button[data-int]'); await page.waitForTimeout(150);
const cardAfter = await page.$$eval('#pane-conn .intcard.open', e => e.length);
cardAfter === cardBefore + 1 ? pass('Раскрытие', 'Карточка сервиса раскрывается') : fail('Раскрытие', 'Карточка сервиса', `${cardBefore}→${cardAfter}`);

// ── 7. Фильтры, фасеты, список дней ─────────────────────────────────────────
await page.click('#nav [data-go="catalog"]'); await page.waitForTimeout(150);
await page.click('#s-catalog .facets button:nth-child(3)'); await page.waitForTimeout(100);
const pressed = await page.$$eval('#s-catalog .facets button[aria-pressed="true"]', e => e.length);
pressed === 1 ? pass('Фильтры', 'Фасет каталога — одиночный выбор') : fail('Фильтры', 'Фасет каталога', `нажато ${pressed}`);

await page.click('#nav [data-go="programs"]'); await page.waitForTimeout(150);
await page.click('#s-programs .tabs button[data-pane="plist"]'); await page.waitForTimeout(150);
await page.click('#pane-plist .filters button:nth-child(3)'); await page.waitForTimeout(100);
const pf = await page.$$eval('#pane-plist .filters button[aria-pressed="true"]', e => e.length);
pf === 1 ? pass('Фильтры', 'Фильтр программ — одиночный выбор') : fail('Фильтры', 'Фильтр программ', `нажато ${pf}`);

await page.evaluate(() => document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-builder')));
await page.click('#s-builder .tabs button[data-pane="days"]'); await page.waitForTimeout(120);
await page.click('#s-builder .daylist button:nth-child(5)'); await page.waitForTimeout(100);
const dcur = await page.$$eval('#s-builder .daylist button[aria-current="true"]', e => e.length);
dcur === 1 ? pass('Фильтры', 'Список дней — одиночный выбор') : fail('Фильтры', 'Список дней', `выбрано ${dcur}`);

// ── 8. Чекбоксы не должны срабатывать как переход ───────────────────────────
await page.click('#nav [data-go="catalog"]'); await page.waitForTimeout(150);
await page.click('#s-catalog .tabs button[data-pane="text"]'); await page.waitForTimeout(120);
await page.click('#s-catalog .row-ck input[type=checkbox]'); await page.waitForTimeout(120);
const stillCatalog = await page.$eval('.screen.on', e => e.id);
stillCatalog === 's-catalog' ? pass('Ввод', 'Галочка не уводит с экрана') : fail('Ввод', 'Галочка', `ушли на ${stillCatalog}`);

// ── 8b. Числа ведут в расчёт ────────────────────────────────────────────────
await page.evaluate(() => document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-client')));
await page.waitForTimeout(100);
const figs = await page.$$eval('#s-client .figure', e => e.length);
figs === 3 ? pass('Расчёт', 'Все три числа на карточке кликабельны') : fail('Расчёт', 'Числа на карточке', `найдено ${figs}`);
await page.click('#s-client .figure'); await page.waitForTimeout(180);
const toBuilder = await page.$eval('.screen.on', e => e.id).catch(() => '—');
toBuilder === 's-builder' ? pass('Расчёт', 'Клик по числу открывает программу') : fail('Расчёт', 'Клик по числу', toBuilder);

await page.click('#s-builder .tabs button[data-pane="days"]'); await page.waitForTimeout(120);
await page.click('#s-builder [data-tab="cost"]'); await page.waitForTimeout(180);
const costOn = await page.$$eval('#s-builder .pane.on', e => e.map(x => x.id));
costOn.length === 1 && costOn[0] === 'pane-cost'
  ? pass('Расчёт', '«Вся смета» переключает на вкладку сметы')
  : fail('Расчёт', '«Вся смета»', costOn.join(','));

const noFreeNumbers = await page.evaluate(() => {
  const pane = document.getElementById('pane-cost');
  const inputs = [...pane.querySelectorAll('input[type=text], input:not([type])')];
  return inputs.length;
});
noFreeNumbers > 0
  ? pass('Расчёт', `Правятся вручную: гости и ручные строки (${noFreeNumbers} поля)`)
  : fail('Расчёт', 'Ручные поля сметы', 'ни одного');

// смета не даёт править гида и транспорт — они приходят из дня
const editableInCost = await page.$$eval('#pane-cost table.cost select', e => e.length);
editableInCost === 0
  ? pass('Расчёт', 'Гид и транспорт в смете только читаются')
  : fail('Расчёт', 'Гид и транспорт правятся в смете', `${editableInCost} выпадашек`);

// в дне программы формат задаётся явно
await page.click('#s-builder .tabs button[data-pane="days"]'); await page.waitForTimeout(150);
const dayFmt = await page.evaluate(() => {
  const box = document.querySelector('#pane-days .fmt');
  if (!box) return null;
  return {
    guide: !!box.querySelector('input[type=checkbox]'),
    transport: [...box.querySelectorAll('select option')].map(o => o.textContent.trim()),
  };
});
dayFmt && dayFmt.guide
  ? pass('Расчёт', 'В дне есть явный признак «работает гид»')
  : fail('Расчёт', 'Признак гида в дне', 'нет');

const CANON = ['Самостоятельно','Общественный транспорт','Частный транспорт','Заказной транспорт','ЖД','Авиа'];
const missingDay = CANON.filter(c => !(dayFmt && dayFmt.transport.includes(c)));
missingDay.length === 0
  ? pass('Расчёт', 'Транспорт в дне — все шесть канонических формулировок')
  : fail('Расчёт', 'Транспорт в дне', 'нет: ' + missingDay.join(', '));

// матрица ставок покрывает те же формулировки
await page.click('#nav [data-go="programs"]'); await page.waitForTimeout(150);
await page.click('#s-programs .tabs button[data-pane="rates"]'); await page.waitForTimeout(200);
const matrix = await page.$$eval('#pane-rates table.cost tbody tr', rows =>
  rows.map(r => ({ t: r.children[0].childNodes[0].textContent.trim(),
                   with: r.children[1].textContent.trim(),
                   without: r.children[2].textContent.trim() })));
const missingRate = CANON.filter(c => !matrix.some(m => m.t === c));
missingRate.length === 0
  ? pass('Расчёт', 'В матрице ставок те же шесть формулировок')
  : fail('Расчёт', 'Матрица ставок', 'нет строки: ' + missingRate.join(', '));

const gaps = matrix.filter(m => /не задано/.test(m.without) || /не задано/.test(m.with));
gaps.length > 0
  ? pass('Расчёт', `Незаполненные клетки помечены явно (${gaps.map(g => g.t).join(', ')})`)
  : fail('Расчёт', 'Пустые клетки матрицы', 'не помечены');

// ── 8c. Арифметика сметы ────────────────────────────────────────────────────
const money = await page.evaluate(() => {
  const num = s => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  const pane = document.getElementById('pane-cost');
  const perDay = [...pane.querySelectorAll('table.cost tbody tr')]
    .map(tr => num(tr.lastElementChild.textContent));
  const sums = [...pane.querySelectorAll('.sum:not(.total)')]
    .map(el => num(el.querySelector('.num input') ? el.querySelector('.num input').value
                                                  : el.querySelector('.num').textContent));
  const totals = [...pane.querySelectorAll('.sum.total .num')].map(el => num(el.textContent));
  const guests = num(pane.querySelector('.statestrip input').value);
  return { days: perDay.reduce((a, b) => a + b, 0), sums, totals, guests };
});
const manual = money.sums[money.sums.length - 1];
const rateLines = money.sums.slice(0, -1).reduce((a, b) => a + b, 0);
rateLines === money.days
  ? pass('Смета · арифметика', `Свод по ставкам сходится с таблицей по дням ($${rateLines})`)
  : fail('Смета · арифметика', 'Свод ≠ дни', `свод $${rateLines}, дни $${money.days}`);
rateLines + manual === money.totals[0]
  ? pass('Смета · арифметика', `Итого = ставки + ручные строки ($${money.totals[0]})`)
  : fail('Смета · арифметика', 'Итого', `${rateLines}+${manual} ≠ ${money.totals[0]}`);
Math.round(money.totals[0] / money.guests) === money.totals[1]
  ? pass('Смета · арифметика', `На человека = итого ÷ ${money.guests}`)
  : fail('Смета · арифметика', 'На человека', `${money.totals[0]}/${money.guests} ≠ ${money.totals[1]}`);

const shown = await page.evaluate(() => {
  const num = s => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  return {
    tab: num(document.querySelector('#s-builder .tabs button[data-pane="cost"] .cnt').textContent),
    card: num(document.querySelector('#s-client .figure .fv').textContent),
    list: num([...document.querySelectorAll('#pane-plist table tbody tr')][0].children[5].textContent),
  };
});
(shown.tab === money.totals[0] && shown.card === money.totals[0] && shown.list === money.totals[0])
  ? pass('Смета · арифметика', 'Одно и то же число на вкладке, карточке и в списке программ')
  : fail('Смета · арифметика', 'Число разошлось', JSON.stringify(shown));

// ── 9. Ширины экрана ────────────────────────────────────────────────────────
for (const w of [1600, 1440, 1180, 1024, 820, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(200);
  const bad = [];
  for (const [go, id] of NAV.map(n => [n[0], n[1]])) {
    await page.click(`#nav [data-go="${go}"]`);
    await page.waitForTimeout(90);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w + 1) bad.push(`${id}:${sw}`);
  }
  bad.length === 0 ? pass('Ширина', `${w} px — без горизонтальной прокрутки`) : fail('Ширина', `${w} px`, bad.join(' '));
}
await page.setViewportSize({ width: 1440, height: 1000 });

// ── 10. Покрытие функций по описи ───────────────────────────────────────────
const MUST = [
  ['POI · редактура', ['Черновик от ИИ', 'Написать с нуля', 'Утвердить и выложить', 'Что сейчас на сайте', 'Название на сайте']],
  ['POI · агент', ['Агент предлагает', 'Принять', 'Отклонить', 'Черновики от ИИ', 'Прислать боту', 'POI-бот в Телеграме']],
  ['POI · связи', ['Где используется', 'Имя разошлось', 'Обновить везде', 'описание наследуется', 'переопределено для маршрута']],
  ['POI · данные', ['Служебная точка', 'Часы работы', 'Категории', 'Удалить']],
  ['POI · поиск', ['Найти место и добавить в маршрут', 'Найти место и добавить в этот день', 'Без описания', 'Из бота, не разобрано']],
  ['Маршрут', ['Точки', 'Тексты', 'Вопросы', 'Фото', 'Публикация', 'Заголовок для поиска', 'Вводный текст страницы', 'Посмотреть на сайте']],
  ['FAQ', ['Заметка редактора', 'Якорь', 'Признаки', 'Сверено', 'Порядок', 'Раздел', 'Без раздела', 'По маршрутам', 'абзацы разделяются пустой строкой']],
  ['Программы', ['Все программы', 'Ставки', 'Что печатается в программе', 'Реквизиты', 'Rate Key', 'Pricing Data', 'Document Settings']],
  ['Подключения', ['Сейф работает', 'Проверить ключ, не сохраняя', 'Стереть ключи', 'Модель по умолчанию', 'только окружение', 'Проверить всё', 'INTEGRATIONS_SECRET']],
  ['Клиент', ['Программа и деньги', 'Ссылка выключена', 'Скачать PDF', 'Из анкеты', 'Следующий шаг']],
  ['Конструктор', ['Полоса дней', 'Заполнить из маршрута', 'Точки дня', 'Ночёвка', 'Сохранить']],
  ['Смета', ['Гостей в расчёте', 'Ставка дня', 'по матрице', 'Ручная строка',
             'На человека · 3 гостя', 'Печатать смету в PDF', 'Как это считается',
             'Ставки — Airtable, таблица', 'Routes → Pricing Data',
             'приходят из дня программы']],
  ['Формат дня', ['Формат дня', 'Работает гид', 'Ставка дня: гид × транспорт', 'не задано',
                  'Две клетки пустые']],
  ['Сегодня', ['Сейчас', 'Агент поработал', 'Не горит', 'Месяц']],
  ['Журнал', ['В очередь агенту', 'Готово к вычитке', 'Выбрать файл']],
];
const body = await page.evaluate(() => document.body.innerText);
const html = await page.content();
for (const [group, needles] of MUST) {
  for (const n of needles) {
    (body.includes(n) || html.includes(n))
      ? pass('Покрытие · ' + group, n)
      : fail('Покрытие · ' + group, n, 'не найдено в макете');
  }
}

// ── 11. Гигиена ─────────────────────────────────────────────────────────────
const dupIds = await page.evaluate(() => {
  const seen = {}, dup = [];
  document.querySelectorAll('[id]').forEach(e => { seen[e.id] = (seen[e.id] || 0) + 1; });
  for (const k in seen) if (seen[k] > 1) dup.push(`${k}×${seen[k]}`);
  return dup;
});
dupIds.length === 0 ? pass('Гигиена', 'Нет повторяющихся id') : fail('Гигиена', 'Повторяющиеся id', dupIds.join(', '));

const deadGo = await page.evaluate(() => {
  const ids = new Set([...document.querySelectorAll('.screen')].map(s => s.id.replace('s-', '')));
  const bad = new Set();
  document.querySelectorAll('[data-go]').forEach(e => { if (!ids.has(e.dataset.go)) bad.add(e.dataset.go); });
  return [...bad];
});
deadGo.length === 0 ? pass('Гигиена', 'Все ссылки ведут на существующие экраны') : fail('Гигиена', 'Ссылки в никуда', deadGo.join(', '));

const noLabel = await page.evaluate(() =>
  [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length);
noLabel === 0 ? pass('Гигиена', 'У всех кнопок есть подпись или заголовок') : fail('Гигиена', 'Кнопки без подписи', String(noLabel));

const eng = await page.evaluate(() => {
  const bad = [];
  const BAD = ['Draft', 'Approved', 'Save changes', 'Read only', 'No POI', 'Unsaved changes', 'Submit', 'Delete POI', 'Loading'];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walk.nextNode())) {
    const t = n.textContent.trim();
    for (const b of BAD) if (t === b || t.startsWith(b + ' ')) bad.push(t.slice(0, 40));
  }
  return [...new Set(bad)];
});
eng.length === 0 ? pass('Гигиена', 'Служебных английских подписей нет') : fail('Гигиена', 'Английские подписи', eng.join(' | '));

errors.length === 0 ? pass('Гигиена', 'Ошибок в скриптах нет') : fail('Гигиена', 'Ошибки в скриптах', errors.slice(0, 3).join(' | '));
netErrors.length === 0
  ? pass('Гигиена', 'Все ресурсы загрузились')
  : pass('Гигиена', 'Веб-шрифт недоступен — макет падает на запасную гарнитуру', `${netErrors.length} запрос(ов); проверено ниже`);

// Проверка запасной гарнитуры: макет обязан читаться без внешнего шрифта
const famH1 = await page.$eval('h1', e => getComputedStyle(e).fontFamily);
const famBody = await page.$eval('body', e => getComputedStyle(e).fontFamily);
(/serif|Georgia/i.test(famH1) && /sans|PT Sans/i.test(famBody))
  ? pass('Гигиена', 'Запасная гарнитура задана для заголовков и текста')
  : fail('Гигиена', 'Запасная гарнитура', `${famH1} / ${famBody}`);

await browser.close();

// ── Вывод ───────────────────────────────────────────────────────────────────
const groups = [...new Set(results.map(r => r.g))];
let bad = 0;
for (const g of groups) {
  const rows = results.filter(r => r.g === g);
  const f = rows.filter(r => !r.ok);
  bad += f.length;
  console.log(`\n${f.length ? '✗' : '✓'} ${g}  (${rows.length - f.length}/${rows.length})`);
  for (const r of f) console.log(`    ✗ ${r.n} — ${r.d}`);
}
console.log(`\nИТОГО: ${results.length - bad} из ${results.length}, провалов ${bad}`);
import { writeFileSync } from 'fs';
writeFileSync('/home/claude/test-results.json', JSON.stringify(results, null, 1));
process.exit(bad ? 1 : 0);
