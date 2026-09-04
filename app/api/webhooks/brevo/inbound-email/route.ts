import { handleBrevoInboundEmailPost } from "@/lib/email/inbound-webhook";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleBrevoInboundEmailPost(request);
}
