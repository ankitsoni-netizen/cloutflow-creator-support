import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { verifyBrevoInboundWebhookAuth } from "@/lib/email/inbound-auth";
import { handleBrevoInboundEmailPayload } from "@/lib/email/inbound-ingest";

export const BREVO_INBOUND_MAX_BODY_BYTES = 256 * 1024;

export async function handleBrevoInboundEmailPost(
  request: NextRequest,
  options?: {
    env?: Record<string, string | undefined>;
    handlePayload?: typeof handleBrevoInboundEmailPayload;
  },
): Promise<NextResponse> {
  const env = options?.env ?? process.env;
  if (!verifyBrevoInboundWebhookAuth(request.headers, env)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > BREVO_INBOUND_MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "malformed" }, { status: 400 });
  }

  const handlePayload = options?.handlePayload ?? handleBrevoInboundEmailPayload;
  const result = await handlePayload(payload, env);
  return NextResponse.json(result.body, { status: result.status });
}
