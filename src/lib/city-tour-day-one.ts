import { stops } from '@/data/city-tour-day-one'
import { getIntercityRouteStopsCached } from '@/lib/airtable'
import { applyCityTourStopOverrides } from '@/lib/city-tour-overrides'

/** Both pages use the complete program with the same editorial overrides. */
export async function getCityTourDayOneStops() {
  const airtableStops = await getIntercityRouteStopsCached('city-tour/day-one').catch(() => [])
  return {
    airtableStops,
    stops: applyCityTourStopOverrides(stops, airtableStops, 'city-tour/day-one'),
  }
}
