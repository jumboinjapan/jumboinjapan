import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { typoDeep } from '@/lib/typography'

const routes = typoDeep([
  {
    title: 'Гора Такао',
    href: '/city-tour/takao',
    description: 'Лесные тропы, храм Якуо-ин и подъём на вершину.',
    duration: '4–6 часов',
  },
  {
    title: 'Гора Митаке',
    href: '/city-tour/mitake',
    description: 'Горная деревня, святилище Мусаси-Митаке и прогулка по лесу.',
    duration: '5–7 часов',
  },
])

/** Mountain day trips are discoverable in the departures-from-Tokyo catalogue. */
export function MountainTourLinks() {
  return (
    <section id="mountain-tours" aria-labelledby="mountain-tours-title" className="space-y-6">
      <h2 id="mountain-tours-title" className="font-sans text-xl text-[var(--text-muted)]">
        Горы рядом с Токио
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        {routes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className="group flex flex-col gap-3 border-y border-[var(--border)] py-6 text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
          >
            <p className="text-body-sm text-[var(--text-muted)]">{route.duration}</p>
            <h3 className="text-lead">{route.title}</h3>
            <p className="font-sans text-body-sm leading-[1.8] text-[var(--text-muted)]">{route.description}</p>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 text-body-sm font-medium group-hover:text-[var(--accent)]">
              Посмотреть маршрут <ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
