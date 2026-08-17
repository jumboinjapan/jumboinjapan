/**
 * Денежная арифметика. Единственное место в проекте, где она есть.
 *
 * Считается не «сколько прогон, скорее всего, будет стоить», а сколько он
 * стоить НЕ МОЖЕТ: консервативная верхняя граница по потолкам разрешения.
 * Разница принципиальная. Оценка токенов помечена `approximate`, и делать
 * приблизительную величину денежной границей нельзя — граница выводится из
 * того, что владелец разрешил, а не из того, что предсказал код.
 *
 * Отсюда правила, каждое из которых закрывает свой способ потратить больше
 * разрешённого:
 *
 * — округление только вверх: остаток в одну микроединицу, отброшенный вниз,
 *   превращает превышение в «ровно по потолку»;
 * — ДЕНЬГИ считаются в `BigInt` целиком: умножение токенов на цену, деление
 *   на единицу цены, сложение частей и сравнение с потолком идут в целых
 *   числах произвольной длины, и числа с плавающей точкой на этом пути нет ни
 *   на одном шаге;
 * — ТОКЕННЫЕ ПОТОЛКИ считаются точным `safeMul` в безопасном `Number`, а не в
 *   `BigInt`. Это сказано вслух, потому что разница наблюдаема: произведение
 *   двух потолков, вышедшее за `Number.MAX_SAFE_INTEGER`, не становится
 *   большим числом — оно даёт `budgetUnprovable`. Обе величины точны, обе
 *   fail-closed, и утверждать «вся арифметика в BigInt» было бы неправдой;
 * — обратно в `Number` денежные величины переводятся только после проверки
 *   `Number.MAX_SAFE_INTEGER`;
 * — переполнение, неизвестная цена и отсутствие точной строки не дают нуля и
 *   не дают «примерно»: они дают отказ `budgetUnprovable`.
 *
 * `maxTotalTokens` здесь не участвует: это накопительный потолок будущего
 * исполнителя, и подменять им консервативную формулу нельзя — он ограничивает
 * фактический расход, а не то, что разрешение допускает.
 */
import { safeMul } from '../../lib/canonical-contract.mjs'
import { assertStrictInput } from './model-execution.mjs'
import { profileModelVersion } from './provider-profile.mjs'
import {
  findPricingEntry,
  MODEL_PRICING_V2_SPEC,
  TOKENS_PER_PRICE_UNIT,
} from './model-pricing.mjs'

/** Коды отказа бюджета. Список закрыт — и закрыт исполняемо, см. ниже. */
export const BUDGET_CODES = Object.freeze({
  unprovable: 'budgetUnprovable',
  exceeded: 'budgetExceeded',
})

/**
 * Значения закрытого списка.
 *
 * Отдельной константой, потому что «список закрыт» обязано быть проверкой, а
 * не фразой в комментарии: опечатка в коде отказа иначе доезжает до
 * вызывающего живым значением и там разбирается по правилу «всё, что не
 * превышение, — недоказуемость».
 */
const BUDGET_CODE_VALUES = Object.freeze(Object.values(BUDGET_CODES))

/**
 * Отказ бюджета с машинным кодом.
 *
 * Отдельный класс, а не строка в сообщении: вызывающий обязан различать
 * «граница недоказуема» и «граница доказана и превышена», и разбирать текст
 * ради этого он не должен.
 */
export class BudgetError extends Error {
  constructor(code, message) {
    super(message)
    if (!BUDGET_CODE_VALUES.includes(code)) {
      throw new TypeError(
        `BudgetError: код ${JSON.stringify(code)} не из закрытого списка `
        + `${BUDGET_CODE_VALUES.join(', ')} — неизвестный код молча стал бы недоказуемостью`,
      )
    }
    this.name = 'BudgetError'
    this.code = code
  }
}

const PRICE_UNIT = BigInt(TOKENS_PER_PRICE_UNIT)

/**
 * Стоимость в микроединицах, округление ВВЕРХ.
 *
 * `(tokens * pricePerMillion + (единица - 1)) / единица` в целых числах.
 * Деление `BigInt` отбрасывает дробную часть, поэтому прибавка знаменателя
 * без единицы и есть округление вверх — без ветвления на остаток и без
 * промежуточной дроби.
 */
export function ceilDivMicros(tokens, pricePerMillionMicros) {
  if (typeof tokens !== 'bigint' || typeof pricePerMillionMicros !== 'bigint') {
    throw new TypeError('ceilDivMicros: оба аргумента обязаны быть BigInt')
  }
  if (tokens < 0n || pricePerMillionMicros < 0n) {
    throw new TypeError('ceilDivMicros: отрицательных токенов и цен не бывает')
  }
  return (tokens * pricePerMillionMicros + PRICE_UNIT - 1n) / PRICE_UNIT
}

/** Целое из `BigInt` — только если оно помещается в безопасный диапазон. */
function toSafeNumber(value, where) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `${where}: ${value} выходит за безопасное целое — граница стоимости недоказуема`,
    )
  }
  return Number(value)
}

/** Произведение потолков. Переполнение — недоказуемость, а не большое число. */
function upperBound(left, right, where) {
  try {
    return safeMul(left, right, where)
  } catch (error) {
    throw new BudgetError(BUDGET_CODES.unprovable, `${where}: ${error.message}`)
  }
}

/** Точный состав входа. Умолчаний нет: недостающий вход — отказ, а не ноль. */
export const COST_INPUT_KEYS = Object.freeze(['limits', 'pricingTable', 'profile'])

/**
 * Консервативная верхняя граница стоимости прогона.
 *
 * Вход и выход считаются раздельно и складываются: цены у них разные, и
 * общий множитель дал бы либо заниженную, либо завышенную границу — обе
 * неверны, но первая ещё и опасна.
 *
 * Строгая форма ВСЕГО сырого входа снимается до деструктуризации и на всей
 * глубине. `Object.keys` символьного и неперечисляемого свойства не видит
 * вовсе, а accessor читает как обычное значение: такой вход прошёл бы состав,
 * деструктуризация вернула бы из него значения, и потолок посчитался бы по
 * тому, чего в подписанном разрешении нет. Спрятать поле внутри `limits` не
 * легче, чем на верхнем уровне, поэтому канонизация идёт вглубь.
 */
export function computeCostUpperBound(input) {
  assertStrictInput(input, COST_INPUT_KEYS, 'computeCostUpperBound: параметры')
  const { limits, pricingTable, profile } = input
  /* Таблица без объявленной ступени к расчёту границы не допускается.
     Посчитать по ней «обычный» тариф значило бы утверждать, что повышенного
     не существует, — а таблица про него просто молчит. Молчание о цене
     нулевой ценой не считается, и здесь тоже. */
  if (pricingTable.contractVersion !== MODEL_PRICING_V2_SPEC) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `таблица цен ${pricingTable.contractVersion} не объявляет тарифной ступени длинного `
      + `контекста: граница стоимости по ней недоказуема. Требуется ${MODEL_PRICING_V2_SPEC}.`,
    )
  }
  const entry = findPricingEntryOrFail(pricingTable, profile)

  const inputTokensUpperBound = upperBound(
    limits.maxNetworkRequests, limits.maxInputTokens, 'inputTokensUpperBound',
  )
  const outputTokensUpperBound = upperBound(
    limits.maxNetworkRequests, limits.maxOutputTokens, 'outputTokensUpperBound',
  )

  /* Ступень выбирается по ПОТОЛКУ РАЗРЕШЕНИЯ на один запрос, а не по
     ожидаемому размеру и не по пределу исходящих байтов сериализатора.
     Граница обязана оставаться верной при любом запросе, который разрешение
     допускает: если потолок позволяет перешагнуть порог хотя бы однажды,
     считать надо по повышенному тарифу целиком.
     Отсюда же — независимость от `maxOutboundBytes`. Сегодня предел
     исходящих байтов таков, что порог недостижим, и это доказано тестом; но
     доказательство держится на числе, которое завтра могут увеличить.
     Арифметика на него не опирается и останется верной после такой правки.
     Сравнение строгое: у провайдера правило записано как «>272K». */
  const longContext = limits.maxInputTokens > entry.longContextThresholdInputTokens
  const inputPrice = longContext
    ? entry.longContextInputMicrosPerMillionTokens
    : entry.inputMicrosPerMillionTokens
  const outputPrice = longContext
    ? entry.longContextOutputMicrosPerMillionTokens
    : entry.outputMicrosPerMillionTokens

  const inputMicros = ceilDivMicros(BigInt(inputTokensUpperBound), BigInt(inputPrice))
  const outputMicros = ceilDivMicros(BigInt(outputTokensUpperBound), BigInt(outputPrice))
  const totalMicros = inputMicros + outputMicros

  /* Сравнение идёт в целых BigInt, до преобразования в Number: перевод
     большого значения раньше сравнения потерял бы младшие единицы, и
     превышение на одну микроединицу стало бы равенством. */
  const maxCostMicros = BigInt(limits.maxCostMicros)
  if (totalMicros > maxCostMicros) {
    throw new BudgetError(
      BUDGET_CODES.exceeded,
      `верхняя граница стоимости ${totalMicros} микроединиц превышает потолок разрешения `
      + `${maxCostMicros}: прогон не начинается`,
    )
  }

  return Object.freeze({
    currency: pricingTable.currency,
    pricingTableAsOf: pricingTable.pricingTableAsOf,
    pricingTableDigest: pricingTable.pricingTableDigest.value,
    /* Применённые ставки и ступень — в результате, а не в комментарии.
       Иначе «посчитано по обычному тарифу» и «посчитано по повышенному»
       выглядели бы одинаково, а отличаются они вдвое. */
    longContextApplied: longContext,
    longContextThresholdInputTokens: entry.longContextThresholdInputTokens,
    inputMicrosPerMillionTokensApplied: inputPrice,
    outputMicrosPerMillionTokensApplied: outputPrice,
    inputTokensUpperBound,
    outputTokensUpperBound,
    inputCostMicrosUpperBound: toSafeNumber(inputMicros, 'inputCostMicrosUpperBound'),
    outputCostMicrosUpperBound: toSafeNumber(outputMicros, 'outputCostMicrosUpperBound'),
    totalCostMicrosUpperBound: toSafeNumber(totalMicros, 'totalCostMicrosUpperBound'),
    maxCostMicros: limits.maxCostMicros,
  })
}

/** Отсутствие точной строки — недоказуемость границы, а не нулевая цена. */
function findPricingEntryOrFail(pricingTable, profile) {
  try {
    return findPricingEntry(pricingTable, {
      providerId: profile.providerId,
      modelId: profile.modelId,
      modelVersion: profileModelVersion(profile),
    })
  } catch (error) {
    throw new BudgetError(BUDGET_CODES.unprovable, error.message)
  }
}

/** Точный состав входа сверки. */
export const PRICING_BINDING_KEYS = Object.freeze(['pricingTable', 'profile', 'limits'])

/**
 * Сверка таблицы цен с профилем и разрешением.
 *
 * Три отпечатка обязаны совпасть: тот, что назвал профиль, тот, на который
 * выдано разрешение, и пересчитанный по самой таблице. Дата и валюта
 * сверяются отдельно — они входят в потолок и в его смысл.
 *
 * Строгая форма всего сырого входа — до деструктуризации, по той же причине,
 * что и у `computeCostUpperBound`: скрытое поле здесь означало бы сверку не с
 * тем, что предъявлено.
 */
export function assertPricingBinding(input) {
  assertStrictInput(input, PRICING_BINDING_KEYS, 'assertPricingBinding: параметры')
  const { pricingTable, profile, limits } = input
  const tableDigest = pricingTable.pricingTableDigest.value
  if (profile.pricingTableDigest.value !== tableDigest) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `профиль ссылается на таблицу цен ${profile.pricingTableDigest.value}, проверена ${tableDigest}`,
    )
  }
  if (limits.pricingTableDigest.value !== tableDigest) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `разрешение выдано на таблицу цен ${limits.pricingTableDigest.value}, проверена ${tableDigest}`,
    )
  }
  if (limits.pricingTableAsOf !== pricingTable.pricingTableAsOf) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `дата таблицы: в разрешении ${limits.pricingTableAsOf}, в таблице ${pricingTable.pricingTableAsOf}`,
    )
  }
  if (limits.currency !== pricingTable.currency) {
    throw new BudgetError(
      BUDGET_CODES.unprovable,
      `валюта: в разрешении ${limits.currency}, в таблице ${pricingTable.currency}`,
    )
  }
}
