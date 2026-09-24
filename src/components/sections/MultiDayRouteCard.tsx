import type { MultiDayRouteCardSpec } from '@/data/multiDayRouteCards'
import { typoDeep } from '@/lib/typography'
import { TourRouteCard } from './TourRouteCard'
import styles from './TourCollection.module.css'

export function MultiDayRouteCard(props: MultiDayRouteCardSpec) {
  const { durationLabel, startCity, regionCountLabel, regionLabelText = 'Охват', transportLabel, ...route } = typoDeep(props)
  return (
    <TourRouteCard {...route} duration={durationLabel}>
      <dl className={styles.cardMeta}>
        <div><dt>Старт</dt><dd>{startCity}</dd></div>
        <div><dt>{regionLabelText}</dt><dd>{regionCountLabel}</dd></div>
      </dl>
      <p className={styles.cardTransport}>{transportLabel}</p>
    </TourRouteCard>
  )
}
