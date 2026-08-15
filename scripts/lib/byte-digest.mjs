/**
 * Единственная реализация хеширования байтов в проекте.
 *
 * Спецификация `raw-file-bytes/v1`: SHA-256 от точных байтов, hex, префикс
 * `sha256:`. Форматирование входа входит в контракт наравне с содержимым —
 * BOM, CRLF или лишний перевод строки меняют хеш, не меняя ни одного
 * значения.
 *
 * Почему отдельный модуль, а не функция внутри потребителя. Потребителей
 * три и они из разных областей: план модельной классификации
 * (`scripts/poi-portals/lib/model-plan.mjs`), проверка неизменности реестра
 * таксономии (`tests/poi-taxonomy-loader.mjs`) и проверка неизменности
 * baseline-снимка (`tests/poi-classification-contract.mjs`). Две реализации
 * одной спецификации разошлись бы молча — заметить это можно было бы
 * только по несовпадению уже записанных хешей.
 *
 * Модуль НЕ разбирает JSON и не знает, что за байты ему дали. Именно
 * поэтому он не становится вторым loader'ом реестра: читать файл и решать,
 * что в нём написано, — работа вызывающего.
 */
import { createHash, createHmac } from 'node:crypto'

/** Имя спецификации для подписи рядом со значением. */
export const RAW_FILE_BYTES_SPEC = 'raw-file-bytes/v1'

/** Алгоритм. Вынесен константой: он тоже пишется в артефакт рядом с digest. */
export const DIGEST_ALGORITHM = 'sha256'

/**
 * Разделитель полей в хешируемых потоках, U+001F.
 *
 * Живёт здесь, а не рядом с каждым форматом: это часть спецификации потока
 * байтов, и второй литерал того же разделителя разошёлся бы с первым молча —
 * а разойдясь, дал бы два разных потока с одинаковым описанием в коде.
 */
export const UNIT_SEPARATOR = 0x1f

/**
 * SHA-256 от переданных байтов.
 *
 * Строку на вход не принимает намеренно: кодировку должен выбрать
 * вызывающий и сделать это явно. Молчаливый `Buffer.from(value)` с
 * кодировкой по умолчанию — ровно тот способ получить разные хеши от
 * одного текста, который эта функция и должна исключить.
 */
export function sha256Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(
      `${RAW_FILE_BYTES_SPEC}: ожидаются байты (Uint8Array или Buffer), получено ${
        bytes === null ? 'null' : typeof bytes
      }. Строку нужно кодировать явно: Buffer.from(text, 'utf8').`,
    )
  }
  return `${DIGEST_ALGORITHM}:${createHash(DIGEST_ALGORITHM).update(bytes).digest('hex')}`
}

/**
 * HMAC-SHA-256, голый шестнадцатеричный вывод в нижнем регистре.
 *
 * Префикса `sha256:` здесь НЕТ намеренно. Это не digest содержимого: значение
 * зависит от ключа, и спутать его с отпечатком нельзя — иначе где-то ниже по
 * течению его сверят с digest'ом и решат, что сошлось.
 *
 * Ключ и данные принимаются только байтами, как и у `sha256Bytes`: кодировку
 * выбирает вызывающий и делает это явно.
 */
export function hmacSha256Hex(keyBytes, bytes) {
  if (!(keyBytes instanceof Uint8Array)) {
    throw new TypeError(
      `${DIGEST_ALGORITHM}-hmac: ключ обязан быть байтами (Uint8Array или Buffer), получено ${
        keyBytes === null ? 'null' : typeof keyBytes
      }`,
    )
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(
      `${DIGEST_ALGORITHM}-hmac: данные обязаны быть байтами (Uint8Array или Buffer), получено ${
        bytes === null ? 'null' : typeof bytes
      }`,
    )
  }
  return createHmac(DIGEST_ALGORITHM, keyBytes).update(bytes).digest('hex')
}
