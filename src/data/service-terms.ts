import { typoDeep } from '@/lib/typography'

/** Public service terms shared by the contact page, offers and llms.txt.
 * No tariffs or availability are inferred from POI or route records. */
export const serviceTerms = typoDeep({
  pricing: 'Стоимость рассчитывается индивидуально. Даты, маршрут и состав услуг обсуждаем лично.',
  inquiry: 'Отправка формы — обращение к гиду, а не подтверждение бронирования.',
  language: 'Экскурсии проходят на русском языке. В ходе поездки я помогаю с коммуникацией на английском и японском.',
})
