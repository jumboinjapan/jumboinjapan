/**
 * Второй слой защиты вебхука бота приёма POI: пропускаем только владельца.
 *
 * Вынесено отдельным модулем без зависимостей, чтобы правило проверялось
 * тестом, а не только глазами. До 2026-08-09 проверка стояла прямо в роуте
 * и выглядела так:
 *
 *   if (!chatId || (OWNER_CHAT_ID && chatId !== OWNER_CHAT_ID))
 *
 * При незаданном TELEGRAM_OWNER_CHAT_ID скобка ложна, условие вырождается в
 * `!chatId`, и сообщение ЛЮБОГО пользователя бота проходило дальше — то есть
 * запускало исследование в OpenAI и запись POI в Airtable. Отсутствие
 * настройки не должно ослаблять проверку: нет владельца — нет доступа.
 */

export type OwnerGateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'owner-not-configured' | 'no-chat-id' | 'foreign-chat' }

export function decideOwnerAccess(chatId: string, ownerChatId: string): OwnerGateDecision {
  if (!ownerChatId.trim()) return { allowed: false, reason: 'owner-not-configured' }
  if (!chatId.trim()) return { allowed: false, reason: 'no-chat-id' }
  if (chatId.trim() !== ownerChatId.trim()) return { allowed: false, reason: 'foreign-chat' }
  return { allowed: true }
}
