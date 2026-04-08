import Link from 'next/link'

export const dynamic = 'force-dynamic'

import { ResourcesSectionShell } from '@/components/resources/ResourcesSectionShell'
import { HotelsExplorer } from '@/components/resources/HotelsExplorer'
import { getResources, isHotelResource, toLegacyHotel } from '@/lib/resources'

export default async function RecommendationsHotelsPage() {
  const hotels = (await getResources({ types: ['hotel'] })).filter(isHotelResource).map(toLegacyHotel)

  return (
    <ResourcesSectionShell
      title="Отели"
      description="Не рейтинг лучших отелей вообще, а рабочая база для выбора под конкретный маршрут: район, темп поездки, бюджет и желаемый уровень комфорта."
      guidanceTitle="Как лучше смотреть эту подборку"
      guidanceItems={[
        {
          title: 'Сначала район, потом отель',
          description: 'В Японии выбор района часто важнее, чем выбор конкретного бренда. Особенно в Токио и Киото.',
        },
        {
          title: 'Не переплачивать автоматически',
          description: '5★ в центре имеет смысл, если вы хотите экономить силы и время. В иных случаях хороший premium за пределами центра может быть рациональнее.',
        },
        {
          title: 'Рёкан — отдельный сценарий',
          description: 'Его лучше выбирать не как обычный hotel upgrade, а как самостоятельный опыт на одну-две ночи, особенно в Хаконэ.',
        },
      ]}
      planningNote={
        <>
          Если нужна привязка к маршруту, начните с региона и 2–3 вариантов, а не с полного перебора списка. Когда появятся даты и план поездки, можно{' '}
          <Link href="/contact" className="text-[var(--accent)] underline underline-offset-4">
            обсудить
          </Link>
          , какой район действительно упростит логистику.
        </>
      }
    >
      <HotelsExplorer hotels={hotels} />
    </ResourcesSectionShell>
  )
}
