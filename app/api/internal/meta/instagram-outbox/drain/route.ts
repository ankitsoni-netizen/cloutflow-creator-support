import { handleInstagramOutboxDrain } from "@/lib/meta/instagram-outbox-drain";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await handleInstagramOutboxDrain({
    authorization: request.headers.get("authorization"),
  });
  return NextResponse.json(result.body, { status: result.status });
}
