import {
  handleInstagramWebhookGet,
  handleInstagramWebhookPost,
} from "@/lib/meta/instagram-webhook";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleInstagramWebhookGet(request);
}

export async function POST(request: NextRequest) {
  return handleInstagramWebhookPost(request);
}
