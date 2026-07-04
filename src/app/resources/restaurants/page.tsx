import Link from 'next/link'

import { ResourcesSectionShell } from '@/components/resources/ResourcesSectionShell'
import { RestaurantsFilter } from '@/components/sections/RestaurantsFilter'
import { getCachedResources, isRestaurantResource, toLegacyRestaurant } from '@/lib/resources'
import { buildPageMetadata } from '@/lib/page-metadata'

export const revalidate = 3600 // ISR: Airtable-backed (tag 'airtable:resources', invalidated via /api/revalidate on admin write)

// title reuses the page's own `title` prop plus the "для поездки по Японии"
// phrase already used by the parent /resources page; description is the
// page's own `description` prop, unchanged.
export const metadata = buildPageMetadata('/resources/restaurants', {
  title: 'Рестораны для поездки по Японии',
  description: 'Подборка мест, с которых удобно начинать, если вы не хотите принимать десятки решений с нуля. Лучше выбирать не «лучший ресторан Токио», а подходящий вечер, район и стиль ужина.',
})

export default async function RecommendationsRestaurantsPage() {
  const restaurants = (await getCachedResources({ types: ['restaurant'] })).filter(isRestaurantResource).map(toLegacyRestaurant)

  return (
    <ResourcesSectionShell
      title="Рестораны"
      description="Подборка мест, с которых удобно начинать, если вы не хотите принимать десятки решений с нуля. Лучше выбирать не «лучший ресторан Токио», а подходящий вечер, район и стиль ужина."
      guidanceTitle="Как использовать список без перегруза"
      guidanceItems={[
        {
          title: 'Сначала повод',
          description: 'Ужин ради опыта, важная бронь заранее или просто хороший вечер рядом с маршрутом — это три разных задачи, и рестораны лучше смотреть именно так.',
        },
        {
          title: 'Затем район',
          description: 'В Токио удобнее бронировать там, где вы реально окажетесь вечером, а не ехать через весь город только ради красивого названия.',
        },
        {
          title: 'И только потом кухня',
          description: 'Суши, кайсэки, якитори или французская кухня — фильтр полезен, но обычно он работает лучше после решения первых двух вопросов.',
        },
      ]}
      planningNote={
        <>
          Если вы уже строите конкретный день в Токио, можно сначала выбрать{' '}
          <Link href="/city-tour" className="text-[var(--accent)] underline underline-offset-4">
            маршрут по городу
          </Link>
          , а потом искать ресторан под правильный район и темп вечера.
        </>
      }
    >
      <RestaurantsFilter restaurants={restaurants} />
    </ResourcesSectionShell>
  )
}
