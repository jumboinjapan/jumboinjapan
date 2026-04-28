import type { Metadata } from 'next'
import { PreviewRouteScaffold } from '@/components/preview/PreviewRouteScaffold'

export const metadata: Metadata = {
  title: 'Preview — City Tour facade',
  description: 'Preview-only city-tour route facade built around POI order first.',
  robots: { index: false, follow: false },
}

const routeSegments = [
  {
    label: 'POI 01',
    title: 'Marunouchi → quiet orientation',
    body:
      'The page opens with the first place, not with format theory. The traveler reads the day as a sequence of urban rooms: station edge, imperial breathing space, then the polished commercial grid. That keeps the city-tour family immediate and concrete.',
    meta: 'Why first: the route earns trust by showing the order at once.',
  },
  {
    label: 'POI 02',
    title: 'Asakusa → cultural density',
    body:
      'The second card widens the tone. It shifts from polished center to older Tokyo texture without pretending the city is one mood. Each stop card carries enough editorial framing to explain why it is here now, not just what it is.',
    meta: 'Facade rule: place order leads, interpretation follows.',
  },
  {
    label: 'POI 03',
    title: 'Shibuya → contemporary release',
    body:
      'The final stop turns the route outward into movement and scale. By the time the traveler reaches this card, the page has already established contrast, pace, and the sense that Tokyo is legible through sequence rather than through category blocks.',
    meta: 'End note: strongest contrast lands last.',
  },
]

const transitionNotes = [
  {
    title: 'Movement is tucked into the seam between stops',
    body:
      'Instead of a dedicated logistics slab taking over the page, transit appears as quiet inline guidance between POIs: where the day compresses, where it loosens, and where a car meaningfully changes the feel.',
  },
  {
    title: 'Order does the persuasive work',
    body:
      'Because this family is POI-first, the layout avoids abstract decision grids at the top. The traveler understands the product by walking through it mentally, one place after the next.',
  },
]

const alternatives = [
  {
    title: 'Swap Asakusa for Meiji if the traveler wants less market energy',
    body:
      'The preview keeps substitutions as side notes, not equal branches. That preserves the clarity of the main day while still giving Lloyd a place to explain custom tailoring.',
  },
  {
    title: 'Late-afternoon museum pivot for rain or fatigue',
    body:
      'An alternate close can be surfaced if the traveler wants a softer end to the route. The page language signals that it is a refinement, not a different product.',
  },
]

const attentionPoints = [
  {
    title: 'Lunch sits as rhythm control, not just a meal slot',
    body: 'The route benefits when food is described as tempo and neighborhood logic, not as an isolated recommendation box.',
  },
  {
    title: 'Walking load should be visible before inquiry',
    body: 'City tours live or die on perceived effort. A short editorial note about staircases, crowds, and street pace makes the page feel honest.',
  },
  {
    title: 'Small detours can read as texture',
    body: 'A kissaten, a lane, a view corridor — these are better framed as micro-notes between anchors than as major standalone modules.',
  },
]

const travelerFits = [
  {
    title: 'First-time Tokyo travelers',
    body: 'They usually need the confidence of a clear order. This facade reads like a day someone can picture immediately.',
  },
  {
    title: 'Travelers choosing between two city days',
    body: 'The POI-first structure makes comparison easy because the route reads as a sequence, not a philosophy essay.',
  },
  {
    title: 'Guests who want curation without jargon',
    body: 'The page feels editorial and assured, but still plainspoken enough to work in a sales conversation.',
  },
]

export default function PreviewCityTourPage() {
  return (
    <PreviewRouteScaffold
      eyebrow="Preview / City tour"
      title="City-tour facade: POI order first, with movement kept in the margins"
      intro="This preview tests a city-tour language where the day is understood by reading the places in order. The traveler sees the sequence first, then the pacing, then the optional refinements. It stays within the JumboInJapan editorial register instead of drifting into travel-template convenience blocks."
      note="Preview-only route. This page is isolated under /preview and does not touch the live city-tour routes."
      heroStats={[
        { label: 'Primary logic', value: 'POI order first' },
        { label: 'Transit layer', value: 'secondary / inline' },
        { label: 'Use case', value: 'single-day city read' },
      ]}
      transportBadges={[
        { label: 'Public transport', detail: 'Works when the day should feel like Tokyo from within, with transfers treated as texture rather than friction.', icon: 'train' },
        { label: 'Guide + driver', detail: 'Useful when the route needs smoother tempo or a family-friendly version without losing the sequence.', icon: 'guide' },
      ]}
      routeTitle="A city day told through the order of places"
      routeDescription="The facade makes the route spine visible as a line of stops. Each card gives just enough editorial framing to justify the sequence and preserve the sense of progression."
      routeSegments={routeSegments}
      transitionTitle="Transitions stay subordinate to the places"
      transitionNotes={transitionNotes}
      alternatives={alternatives}
      attentionPoints={attentionPoints}
      travelerFits={travelerFits}
    />
  )
}
