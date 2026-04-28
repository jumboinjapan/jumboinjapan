import type { Metadata } from 'next'
import { PreviewRouteScaffold } from '@/components/preview/PreviewRouteScaffold'

export const metadata: Metadata = {
  title: 'Preview — Multi-day facade',
  description: 'Preview-only multi-day route facade with day chapters and transport layer.',
  robots: { index: false, follow: false },
}

const routeSegments = [
  {
    label: 'Day 01–02',
    title: 'Tokyo chapter / arrival gravity',
    body:
      'The first chapter frames arrival, not just sightseeing. It explains what the traveler should absorb before the route starts moving across Japan, and why Tokyo is carrying orientation, contrast, and the first emotional register of the trip.',
    meta: 'Chapter rule: each day block has its own role in the whole arc.',
  },
  {
    label: 'Day 03',
    title: 'Hakone hinge / decompression and reset',
    body:
      'A multi-day page needs a visible hinge day. Hakone is shown as a strategic change in altitude, pace, and attention span — the point where the trip stops feeling like urban accumulation and begins to breathe.',
    meta: 'Transport layer starts to matter because the route is crossing states.',
  },
  {
    label: 'Day 04–06',
    title: 'Kyoto–Nara chapter / deep cultural register',
    body:
      'Later chapters are grouped around thematic weight rather than one card per city. The preview tests a structure where days feel like editorial chapters, each with its own route spine and a clear reason for being placed here in the sequence.',
    meta: 'Outcome: the traveler sees narrative continuity, not hotel shuffling.',
  },
]

const transitionNotes = [
  {
    title: 'Day changes are the real transitions',
    body:
      'For multi-day products, the movement layer is not only station-to-station. It is also the emotional reset between chapters: city to landscape, high density to ritual quiet, motion to stay.',
  },
  {
    title: 'Transport becomes a dedicated reading layer',
    body:
      'Unlike the city-tour facade, this family gives transport its own panel language. Shinkansen, local connections, luggage logic, and hotel rhythm deserve their own structured explanation.',
  },
]

const alternatives = [
  {
    title: 'Add Kanazawa if the traveler wants a more crafted regional middle act',
    body:
      'The page can show where an alternate chapter inserts cleanly without breaking the arc from Tokyo entry to Kansai depth.',
  },
  {
    title: 'Trim Osaka if departure airport or trip temperament makes the close too restless',
    body:
      'Because the route is chapter-based, shortening the ending can be explained as a tonal edit rather than as a loss of checklist value.',
  },
]

const attentionPoints = [
  {
    title: 'Hotel changes should be explained as strategic, not incidental',
    body: 'Multi-day pages get stronger when each move earns its place in the route narrative and not just in the backend plan.',
  },
  {
    title: 'Luggage forwarding deserves elegant visibility',
    body: 'This detail lowers stress dramatically and belongs in the transport layer near the chapter where it matters most.',
  },
  {
    title: 'Rest margin is part of premium positioning',
    body: 'A page like this should show where the route intentionally leaves room, otherwise the editorial tone starts to feel like disguised busyness.',
  },
]

const travelerFits = [
  {
    title: 'First long Japan trip',
    body: 'These travelers need confidence that the route has internal logic over several days. The chapter system gives them that structure immediately.',
  },
  {
    title: 'Guests choosing between classic and custom builds',
    body: 'The facade helps them see which parts of the route are core arc and which parts can flex without damaging the trip.',
  },
  {
    title: 'Travelers worried about logistics fatigue',
    body: 'The separate transport layer makes operational complexity feel managed rather than hidden.',
  },
]

export default function PreviewMultiDayPage() {
  return (
    <PreviewRouteScaffold
      eyebrow="Preview / Multi-day"
      title="Multi-day facade: route spine across days, with chapter logic and a dedicated transport layer"
      intro="This preview tests the multi-day family as an editorial sequence of day chapters. The route spine remains the backbone, but each chapter clarifies what that part of the journey is doing, while the transport layer explains how the trip stays smooth between places."
      note="Preview-only route. This page is isolated under /preview and does not affect the live multi-day pages."
      heroStats={[
        { label: 'Primary logic', value: 'day chapters on one spine' },
        { label: 'Transport layer', value: 'explicit and separate' },
        { label: 'Use case', value: 'multi-city journey design' },
      ]}
      transportBadges={[
        { label: 'Shinkansen rhythm', detail: 'Longer moves are framed as chapter transitions with clear payoff, not as blank travel time.', icon: 'train' },
        { label: 'Guide orchestration', detail: 'Support appears where chapter hand-offs or local complexity would otherwise blur the trip.', icon: 'guide' },
      ]}
      routeTitle="A full trip read as a sequence of chapters"
      routeDescription="The preview keeps the shared site language — route spine, movement, alternatives, attention points, traveler fit — but stretches it across days so the trip reads as one composed narrative."
      routeSegments={routeSegments}
      transitionTitle="The trip breathes through chapter hand-offs"
      transitionNotes={transitionNotes}
      alternatives={alternatives}
      attentionPoints={attentionPoints}
      travelerFits={travelerFits}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">Transport layer</p>
          <h2 className="mt-3 text-[28px] font-medium tracking-[-0.03em] text-[var(--text)]">Operational notes deserve their own facade space</h2>
          <p className="mt-3 text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
            In the live product later, this could evolve into a tighter reusable module for trains, luggage forwarding, station support, and overnight pacing. For preview, the goal is simply to show that multi-day routes need this layer exposed instead of buried in generic body copy.
          </p>
        </article>
        <div className="space-y-4">
          {[
            'Day chapter cards hold the story spine.',
            'Transport notes explain how one chapter hands off to the next.',
            'Alternatives stay visible without fragmenting the whole route.',
          ].map((item) => (
            <div key={item} className="flex items-start gap-3 border-l border-[var(--border)] pl-5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </PreviewRouteScaffold>
  )
}
