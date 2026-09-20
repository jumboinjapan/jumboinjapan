import { TourRouteCard } from './TourRouteCard'

export interface ExperienceCardProps {
  title: string
  description: string
  duration: string
  slug: string
  image?: string
  imagePosition?: string
  headingLevel?: 3 | 4
}

export function ExperienceCard(props: ExperienceCardProps) {
  return <TourRouteCard {...props} />
}
