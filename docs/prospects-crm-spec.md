# Prospects CRM — воронка клиентов и Fact Find опросник

_Статус: **утверждено владельцем 2026-07-04** (реконсилировано из двух параллельных черновиков Fable-5). Канонический промпт реализации — Задание 12 (передаётся исполнителю отдельно); этот файл — архитектурная справка в репозитории._

## Решения владельца (зафиксированы, не переспрашивать)

1. **Хранилище — Airtable, таблица `Prospects`** (`PROSPECTS_TABLE_ID` в `airtable-schema.ts`). Не SQL, не внешняя CRM: клиентские данные должны жить рядом с Routes/POI, из которых собираются маршруты. Весь доступ — через `src/lib/prospects.ts`; при будущем росте меняется только этот модуль.
2. **Fact Find заполняет клиент** — либо сразу с сайта (экран «спасибо» после формы /contact предлагает анкету), либо позже по персональной ссылке, которую Эдуард отправляет вручную. Следствие: **токен генерируется при создании prospect** (в `createProspect`), а не по кнопке из карточки; ссылка на анкету включается и в Telegram-уведомление о новой заявке — гид может сразу переслать её клиенту.
3. **Ответы анкеты — наверху карточки клиента** («паспорт группы»): по ним составляются индивидуальные маршруты.
4. **Связка с конструктором — сразу, минимальная**: кнопка «Создать маршрут» → /admin/multi-day, slug созданного маршрута запоминается в карточке (`Linked Routes`). Автогенерация черновика маршрута по анкете — v2.
5. Бывшие «открытые решения» закрыты: повторное редактирование анкеты клиентом — разрешено (статусы выше `fact_find` при этом не понижаются); связь prospect ↔ маршрут — новое поле `Linked Routes`, не Notes-конвенция.

## Воронка (переопределена владельцем 2026-07-05)

Поле **`Stage`** (заменило `Status`, старое переименовано в `Status (deprecated)`):

`received` Получена → `processed` Обработана → `discussing` Обсуждение → `agreed` Тур согласован → `conducted` Тур проведён → `paid` Тур оплачен; `lost` Потерян — терминальная.

Правила: Fact Find анкета — атрибут карточки (`Fact Find Completed At`), стадию автоматически НЕ двигает (гид двигает сам); каждая смена стадии пишет `Stage Updated At` (основа метрики «застрявшие»: received >3 дн., processed >7, discussing >14); «заявки в работе» = received+processed+discussing+agreed; «туры в работе» = agreed+conducted, разбиваются по `Tour Type` (city / day_trip / car / multi_day / group) и источнику. `Source` расширен: website, telegram, social, referral, repeat, agency, other_guide.

## Что уже есть (не переделываем)

- Приём заявок: `/contact` → `api/contact` → durable workflow (`src/workflows/contact-form.ts`) → Prospect (`Stage: received`) + Telegram. Retry на transient-ошибках есть.
- Схема Prospects готова: вся анкета (Party Size/Composition, Children, Mobility, даты, Interests ×10, Must See/Avoid, Pace, Service Class, Transport, Guide Language, First Time Japan, Special Occasion), воронка `Stage` (см. выше), `Tour Type`, `Stage Updated At`, `Fact Find Link/Token/Completed At`, `Linked Routes`, `Client ID`.
- Overview-дашборд `/admin` уже читает Prospects (`listProspectsForOverview`) и показывает воронку/застрявших/источники/туры в работе.
- Admin-периметр: middleware покрывает `/admin` и `/api/admin` — новые экраны наследуют защиту.
- Печатная программа (Задание 8) стыкуется с карточкой через `?client=` в v1.

## Изменения схемы Airtable — ВЫПОЛНЕНЫ 2026-07-04/05

- `Fact Find Token` (singleLineText) — токен ссылки (`crypto.randomUUID()`); поиск prospect — по этому полю.
- `Linked Routes` (multilineText) — slug-и маршрутов клиента.
- `Stage` / `Tour Type` / `Stage Updated At` — воронка v2 (см. выше); `Status` переименован в `Status (deprecated)`, записи мигрированы.

## Архитектура V1

**Data-слой** (`prospects.ts`): `listProspectsForOverview` уже есть; + `getProspectByToken`, `getProspectById`, `updateProspectFactFind` (whitelist анкетных полей + `Fact Find Completed At`; стадию НЕ трогает — гид двигает сам), `updateProspectStage` (пишет `Stage` + `Stage Updated At`), `updateProspectNotes`, `appendLinkedRoute`. Админ-чтение — всегда свежее (без кэша или короткий revalidate).

**Опросник `/fact-find/[token]`** (public, noindex, вне sitemap): 4 тематических секции (Группа → Даты → Вкусы → Формат), поля 1-в-1 из Airtable-choices, русские подписи; wizard или один экран с секциями — на усмотрение исполнителя, критерий — заполнение с телефона. Заполненная анкета открывается в режиме «изменить ответы». Копия — личная, в голосе гида («Расскажите, с кем едете», не «Укажите состав группы»), утверждается владельцем. Невалидный токен → мягкий отказ с контактом. Submit → `POST /api/fact-find` → анкетные поля + `Fact Find Completed At` + статус + Telegram-уведомление со ссылкой на карточку. Rate-limit; PII не логировать (только Prospect ID).

**Админ-CRM**: доска `/admin/clients` — колонки по стадиям `Stage` (received → processed → discussing → agreed активные; conducted/paid/lost свёрнуты); плашка: имя, тип тура, состав+размер, даты, source, индикатор анкеты, «N дней в стадии» (от `Stage Updated At`); без drag-n-drop (смена стадии — осмысленное действие, не сортировка). В карточке также выбирается `Tour Type`. Карточка `/admin/clients/[prospectId]`: «паспорт группы» сверху (пустые поля — приглушённое «—»; анкета не заполнена → empty-state с кнопкой «Скопировать ссылку»), ниже контакт/заметки/таймлайн, действия (статус, «Изменить ответы», конвертация с `Converted At`), блок «Маршруты клиента» + «Создать маршрут». API `/api/admin/clients*` — через prospects.ts, за периметром.

## Что НЕ делаем в V1

Автогенерация маршрута по анкете; автоотправка ссылок клиенту (Эдуард шлёт сам); EN-версия (каркас i18n-ready, Language-поле есть); email-канал; личный кабинет клиента; drag-n-drop kanban; скоринг лидов.

## v2 (после Заданий 7–8)

Route Builder открывается с prospect-контекстом (дни/темп/интересы/состав как подсказки сборки); печатная программа берёт имя клиента из prospect вместо query-параметра; «Собрать черновик тура по анкете» — агентный сценарий поверх структурированных ответов.
