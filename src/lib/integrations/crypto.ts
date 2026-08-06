/**
 * Шифрование учётных данных внешних API (AES-256-GCM поверх Web Crypto).
 *
 * Модель угроз, ради которой это сделано именно так: ключи провайдеров лежат
 * в Airtable — у третьей стороны. Значит утечка выгрузки Airtable (украденный
 * PAT, доступ к рабочему пространству, экспорт базы) НЕ должна отдавать сами
 * ключи. Мастер-ключ INTEGRATIONS_SECRET живёт в переменных окружения Vercel
 * и в Airtable не попадает ни в каком виде: без него шифротекст бесполезен.
 *
 * Ключ шифрования выводится HKDF-SHA256 отдельно для каждого провайдера
 * (info = provider id). Поэтому блоб от одного провайдера нельзя подставить
 * другому: подмена строки в Airtable даст ошибку расшифровки, а не чужой ключ.
 *
 * Формат: v1.<iv base64url>.<ciphertext+tag base64url>. IV случайный на каждую
 * запись — повторная запись того же значения даёт другой шифротекст.
 */

const FORMAT_VERSION = 'v1'
const HKDF_SALT = 'jumboinjapan-integrations-2026'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

// Возвращаемый тип уточнён до Uint8Array<ArrayBuffer>: Web Crypto принимает
// BufferSource, а безымянный Uint8Array в TS 5.7+ может стоять и над
// SharedArrayBuffer, который туда не годится.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function getMasterSecret(): string {
  return process.env.INTEGRATIONS_SECRET?.trim() ?? ''
}

export function isVaultSecretConfigured(): boolean {
  // 24 символа — нижняя граница, ниже которой мастер-ключ не имеет смысла.
  return getMasterSecret().length >= 24
}

async function deriveKey(providerId: string): Promise<CryptoKey> {
  const secret = getMasterSecret()
  if (!secret) throw new Error('INTEGRATIONS_SECRET is not configured')

  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(providerId),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecrets(providerId: string, payload: Record<string, string>): Promise<string> {
  const key = await deriveKey(providerId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return `${FORMAT_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`
}

/**
 * Расшифровка. НИКОГДА не бросает и не логирует содержимое: битый или чужой
 * блоб просто означает «учётных данных нет» — дэшборд покажет «не настроено»
 * и предложит ввести ключ заново, вместо того чтобы уронить всю страницу.
 */
export async function decryptSecrets(providerId: string, blob: string): Promise<Record<string, string>> {
  const trimmed = blob.trim()
  if (!trimmed) return {}

  const [version, ivPart, cipherPart] = trimmed.split('.')
  if (version !== FORMAT_VERSION || !ivPart || !cipherPart) {
    console.error(`[integrations] unrecognised secret format for provider "${providerId}"`)
    return {}
  }

  try {
    const key = await deriveKey(providerId)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivPart) },
      key,
      fromBase64Url(cipherPart),
    )
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: Record<string, string> = {}
    for (const [fieldKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[fieldKey] = value
    }
    return result
  } catch (error) {
    console.error(
      `[integrations] decrypt failed for provider "${providerId}" (сменился INTEGRATIONS_SECRET?):`,
      error instanceof Error ? error.name : 'unknown error',
    )
    return {}
  }
}

/**
 * Маска секрета для интерфейса: «sk-pro…4f2a». Задача — дать владельцу узнать
 * СВОЙ ключ, не показывая его. Для коротких значений не показываем ничего,
 * иначе маска выдала бы заметную долю секрета.
 */
export function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length < 12) return '••••••'
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`
}
