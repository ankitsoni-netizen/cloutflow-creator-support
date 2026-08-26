import { handleWatiWebhookPost } from "@/lib/wati/webhook";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleWatiWebhookPost(request);
}
