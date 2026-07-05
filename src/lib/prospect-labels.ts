/**
 * Стадии воронки, типы тура и их русские лейблы — общий словарь для
 * дашборда /admin, доски /admin/clients и карточки клиента.
 *
 * Отдельный модуль (а не prospects.ts), потому что его импортируют и
 * клиентские компоненты: здесь нет Airtable-кода и env-чтений.
 */

/**
 * Funnel stages (Airtable field `Stage`, replaces legacy `Status` since
 * 2026-07-05): received → processed → discussing → agreed → conducted →
 * paid; lost is terminal. The Fact Find questionnaire is an attribute
 * (`Fact Find Completed At`), not a stage.
 */
export type ProspectStage =
  | 'received'
  | 'processed'
  | 'discussing'
  | 'agreed'
  | 'conducted'
  | 'paid'
  | 'lost'

export type ProspectTourType = 'city' | 'day_trip' | 'car' | 'multi_day' | 'group'

export type ProspectSource =
  | 'website'
  | 'telegram'
  | 'social'
  | 'referral'
  | 'repeat'
  | 'agency'
  | 'other_guide'

export const PROSPECT_STAGES: ProspectStage[] = [
  'received',
  'processed',
  'discussing',
  'agreed',
  'conducted',
  'paid',
  'lost',
]

export const PROSPECT_TOUR_TYPES: ProspectTourType[] = ['city', 'day_trip', 'car', 'multi_day', 'group']

export const STAGE_LABELS: Record<ProspectStage, string> = {
  received: 'Получена',
  processed: 'Обработана',
  discussing: 'Обсуждение',
  agreed: 'Тур согласован',
  conducted: 'Тур проведён',
  paid: 'Тур оплачен',
  lost: 'Потерян',
}

export const SOURCE_LABELS: Record<string, string> = {
  website: 'Сайт',
  telegram: 'Telegram',
  social: 'Соцсети',
  referral: 'Рекомендация',
  repeat: 'Повторный клиент',
  agency: 'От агентства',
  other_guide: 'От другого гида',
}

export const TOUR_TYPE_LABELS: Record<ProspectTourType, string> = {
  city: 'Городской',
  day_trip: 'Выездной',
  car: 'На автомобиле',
  multi_day: 'Многодневный',
  group: 'Групповой',
}
