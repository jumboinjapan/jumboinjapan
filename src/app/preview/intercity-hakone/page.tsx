import type { Metadata } from 'next'
import { PreviewRouteScaffold } from '@/components/preview/PreviewRouteScaffold'

export const metadata: Metadata = {
  title: 'Preview — Intercity Hakone facade',
  description: 'Preview-only intercity Hakone route facade with route spine, transfers, and helper layer.',
  robots: { index: false, follow: false },
}

const routeSegments = [
  {
    label: 'Leg 01',
    title: 'Tokyo departure → Hakone threshold',
    body:
      'The opening module is not a destination postcard. It is the departure logic: where the city lets go, how much the first transfer asks of the traveler, and what kind of day Hakone becomes depending on how cleanly that threshold is crossed.',
    meta: 'Spine first: origin, line choice, and initial commitment.',
  },
  {
    label: 'Leg 02',
    title: 'Lake Ashi / ropeway axis',
    body:
      'The middle of the page is a route spine rather than a list of attractions. The lake, boat, ropeway, and volcanic zone are shown as linked stages with an obvious direction of travel, so the traveler can feel the mechanics of the day.',
    meta: 'Key promise: scenery and transit are fused into one reading.',
  },
  {
    label: 'Leg 03',
    title: 'Open-air museum or softer close',
    body:
      'The final leg makes room for substitution without dissolving the route. The page shows where the day can land strongly, and where the helper layer can step in if weather, crowds, or energy levels shift the best ending.',
    meta: 'Closure depends on transfer burden and remaining appetite.',
  },
]

const transitionNotes = [
  {
    title: 'Transfers are visible, not apologised away',
    body:
      'This family wins when the page is honest about line changes, boarding points, and timing pressure. The route feels premium not because the transfers disappear, but because the logic around them is calm and intelligible.',
  },
  {
    title: 'Helper guidance sits beside the spine',
    body:
      'Instead of pushing alternatives to the bottom as FAQ debris, the preview gives them a distinct helper layer. That makes substitution feel designed rather than improvised.',
  },
]

const alternatives = [
  {
    title: 'Reverse the middle sequence if wind or ropeway operations change the cleanest flow',
    body:
      'The helper layer can recommend a reversed pass through the Hakone loop while preserving the same core story: elevation, exposure, then release.',
  },
  {
    title: 'Drop the museum and hold space for ryokan arrival',
    body:
      'For travelers staying overnight, the strongest move may be to end earlier and let the property finish the day. The page can say this without making the route feel incomplete.',
  },
]

const attentionPoints = [
  {
    title: 'Cable car closures need a graceful contingency note',
    body: 'This should live close to the relevant route leg so the page reads prepared, not patched later.',
  },
  {
    title: 'Car versus train should be framed as softness of day',
    body: 'The decision is less about status than about how much hard transfer logic the traveler wants to carry personally.',
  },
  {
    title: 'Views of Fuji are editorially secondary',
    body: 'The page can acknowledge the mountain as a bonus without letting it overtake the route logic.',
  },
]

const travelerFits = [
  {
    title: 'Guests comparing Hakone to other day trips',
    body: 'They need to understand movement cost quickly. This facade makes the route mechanics legible within seconds.',
  },
  {
    title: 'Travelers nervous about transfers',
    body: 'The helper layer reassures them because the page shows where friction lives and how a guide or car changes it.',
  },
  {
    title: 'People considering an overnight extension',
    body: 'The page naturally supports the question of whether Hakone should remain a day trip or open into a slower stay.',
  },
]

export default function PreviewIntercityHakonePage() {
  return (
    <PreviewRouteScaffold
      eyebrow="Preview / Intercity Hakone"
      title="Intercity Hakone facade: route spine first, with transfers and helper logic made explicit"
      intro="This preview tests the intercity family as a movement-led page. Hakone is not reduced to a bucket of attractions; it is presented as a connected chain of thresholds, transport shifts, scenic release, and optional substitutions."
      note="Preview-only route. This page is isolated under /preview and does not alter the live /intercity/hakone route."
      heroStats={[
        { label: 'Primary logic', value: 'route spine + transfers' },
        { label: 'Helper layer', value: 'substitutions visible' },
        { label: 'Use case', value: 'intercity day / overnight hinge' },
      ]}
      transportBadges={[
        { label: 'Train-led route', detail: 'Best when the traveler accepts a more explicit transfer story and wants the full Hakone loop logic.', icon: 'train' },
        { label: 'Guide support', detail: 'Best when route complexity should feel pre-resolved and the day needs to stay smooth under changing conditions.', icon: 'guide' },
        { label: 'Route map logic', detail: 'The preview presents flow as a readable sequence rather than a scenic collage.', icon: 'map' },
      ]}
      routeTitle="A scenic day structured as a chain of transport decisions"
      routeDescription="The route spine is the main content surface. Stops matter, but they are presented through progression, transitions, and where the day can branch intelligently."
      routeSegments={routeSegments}
      transitionTitle="Transfers become part of the product language"
      transitionNotes={transitionNotes}
      alternatives={alternatives}
      attentionPoints={attentionPoints}
      travelerFits={travelerFits}
    />
  )
}
