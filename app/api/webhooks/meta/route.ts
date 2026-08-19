import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
} from "@/lib/meta/webhook";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleMetaWebhookGet(request);
}

export async function POST(request: NextRequest) {
  return handleMetaWebhookPost(request);
}
