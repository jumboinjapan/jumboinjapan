import { NextResponse } from "next/server";

interface ContactPayload {
  name: string;
  contact: string;
  travelDate?: string;
  groupSize?: string;
  interests?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ContactPayload;

  console.log("contact-form-submission", body);

  return NextResponse.json({ ok: true });
}
