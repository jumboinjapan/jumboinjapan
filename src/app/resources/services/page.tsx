import Link from 'next/link'

export const dynamic = 'force-dynamic'

import { ResourcesSectionShell } from '@/components/resources/ResourcesSectionShell'
import { ServicesFilter } from '@/components/sections/ServicesFilter'
import { getResources, isServiceResource, toExperienceService, toPracticalService } from '@/lib/resources'

export default async function RecommendationsServicesPage() {
  const resources = (await getResources({ types: ['service'] })).filter(isServiceResource)
  const experienceServices = resources.map(toExperienceService).filter((item): item is NonNullable<typeof item> => Boolean(item))
  const practicalServices = resources.map(toPracticalService).filter((item): item is NonNullable<typeof item> => Boolean(item))

  return (
    <ResourcesSectionShell
      title="Услуги"
      description="Здесь собраны и полезные практичные сервисы, и занятия, которые могут усилить поездку. Важно лишь не пытаться добавить всё сразу: лучший выбор обычно тот, что естественно встраивается в ваш маршрут."
      guidanceTitle="Что выбирать с осторожностью"
      guidanceItems={[
        {
          title: 'Активности — не как обязательная программа',
          description: 'Чайная церемония, мастер-класс или театр хороши тогда, когда они поддерживают ритм поездки, а не перегружают её.',
        },
        {
          title: 'Полезные сервисы — по реальной потребности',
          description: 'Трансферы, багаж, практические помощники и другие сервисы лучше добавлять под конкретную ситуацию, а не «на всякий случай».',
        },
        {
          title: 'Оставить воздух в маршруте',
          description: 'Даже хороший сервис может ухудшить день, если вставлен в неподходящее окно. Япония ощущается лучше, когда у поездки есть запас спокойствия.',
        },
      ]}
      planningNote={
        <>
          Если вы сомневаетесь, что действительно стоит добавить, удобнее сначала определить базовый маршрут — например,{' '}
          <Link href="/intercity" className="text-[var(--accent)] underline underline-offset-4">
            загородный выезд
          </Link>{' '}
          или день в{' '}
          <Link href="/city-tour" className="text-[var(--accent)] underline underline-offset-4">
            Токио
          </Link>{' '}
          — и только потом выбирать сервисы точечно.
        </>
      }
    >
      <ServicesFilter experienceServices={experienceServices} practicalServices={practicalServices} />
    </ResourcesSectionShell>
  )
}
