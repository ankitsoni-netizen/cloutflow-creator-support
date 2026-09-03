import { handleWatiOutboxDrain } from "@/lib/wati/outbox-drain";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await handleWatiOutboxDrain({
    authorization: request.headers.get("authorization"),
  });
  return NextResponse.json(result.body, { status: result.status });
}
