import { ArrowUpRight, Plus } from 'lucide-react'
import { typoDeep } from '@/lib/typography'
import { TicketDisplayList } from '@/components/TicketDisplayList'
import type { TicketDisplayLine } from '@/lib/ticket-display'
import styles from './TourAdditions.module.css'

export type TourAddition = {
  id: string
  title: string
  description: string
  website?: string
  note?: string
  workingHours?: string
  tickets?: TicketDisplayLine[]
}

/** Server-rendered, native disclosure: the builder can supply the same entries. */
export function TourAdditionList(props: { items: TourAddition[]; group: string }) {
  const { items, group } = typoDeep(props)
  if (items.length === 0) return null

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <details key={item.id} name={group} className={styles.item}>
          <summary className={styles.summary}>
            <span>{item.title}</span>
            <Plus aria-hidden="true" className={styles.toggle} />
          </summary>
          <div className={styles.body}>
            <p>{item.description}</p>
            {item.note && <p className={styles.note}>{item.note}</p>}
            {(item.workingHours || Boolean(item.tickets?.length)) && (
              <dl className={styles.practical}>
                {item.workingHours && <div><dt>Часы посещения</dt><dd>{item.workingHours}</dd></div>}
                {Boolean(item.tickets?.length) && <div><dt>Билеты</dt><dd><TicketDisplayList lines={item.tickets!} /></dd></div>}
              </dl>
            )}
            {item.website && (
              <a href={item.website} target="_blank" rel="noopener noreferrer" className={styles.source}>
                Сайт места<span className="sr-only">: {item.title} (в новой вкладке)</span>
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
            )}
          </div>
        </details>
      ))}
    </div>
  )
}

export function TourAdditions({ additions, lunch = [] }: { additions: TourAddition[]; lunch?: TourAddition[] }) {
  if (additions.length === 0 && lunch.length === 0) return null

  return (
    <div id="adapt" className={styles.groups}>
      {additions.length > 0 && (
        <section id="additions" aria-labelledby="tour-additions-title">
          <h2 id="tour-additions-title" className={styles.heading}>Что можно добавить</h2>
          <TourAdditionList items={additions} group="tour-additions" />
        </section>
      )}
      {lunch.length > 0 && (
        <section id="lunch" aria-labelledby="tour-lunch-title">
          <div className={styles.lunchHeading}>
            <h2 id="tour-lunch-title" className={styles.heading}>Обед</h2>
            <p>По желанию</p>
          </div>
          <TourAdditionList items={lunch} group="tour-lunch" />
        </section>
      )}
    </div>
  )
}
