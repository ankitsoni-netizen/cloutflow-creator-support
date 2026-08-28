import { handleTicketResolutionOutboxDrain } from "@/lib/tickets/resolution-outbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await handleTicketResolutionOutboxDrain({
    authorization: request.headers.get("authorization"),
    deps: { supabase: createAdminClient() },
  });
  return NextResponse.json(result.body, { status: result.status });
}
