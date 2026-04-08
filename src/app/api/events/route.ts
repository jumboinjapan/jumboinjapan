import { NextResponse } from "next/server";
import { getFilteredEvents } from "@/lib/events";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get("category");
  const month = searchParams.get("month");
  const q = searchParams.get("q");

  const events = await getFilteredEvents({ category, month, q });

  return NextResponse.json(events);
}
