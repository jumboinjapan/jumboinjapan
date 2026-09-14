import { NextRequest, NextResponse } from 'next/server';
import { buildMultiDayBuilderPoiOptions, searchMultiDayBuilderPois } from '@/lib/multi-day-builder-data';
import { getPoiRecordsForMatrix } from '@/lib/airtable';
import { assertPlanningQuery, planPoiSelection } from '../../../../../../scripts/poi-portals/lib/poi-matrix-planning.mjs';
import { requireAdminSession } from '@/lib/admin-guard';
export async function GET(request: NextRequest) {
    const denied = await requireAdminSession(request);
    if (denied)
        return denied;
    const selection = request.nextUrl.searchParams.get('selection');
    if (selection !== null) {
        let query;
        try {
            if (selection.length > 12000)
                throw Error('size');
            query = assertPlanningQuery(JSON.parse(selection));
        }
        catch {
            return NextResponse.json({ error: 'Проверьте условия подбора.' }, { status: 400 });
        }
        try {
            const records = await getPoiRecordsForMatrix();
            const result = planPoiSelection(records, query);
            const options = new Map(buildMultiDayBuilderPoiOptions(records).map(p => [p.poiId, p]));
            return NextResponse.json({ ...result, items: result.items.map(item => ({ ...item, poi: options.get(item.poiId) })) }, { headers: { 'Cache-Control': 'private, no-store' } });
        }
        catch {
            return NextResponse.json({ error: 'Не удалось загрузить подбор. Повторите попытку.' }, { status: 503 });
        }
    }
    try {
        const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';
        const pois = await searchMultiDayBuilderPois(query);
        return NextResponse.json(pois);
    }
    catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
