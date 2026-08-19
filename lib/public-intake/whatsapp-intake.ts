import "server-only";

import { WEBSITE_INTAKE_MAX_BODY_BYTES } from "@/lib/public-intake/constants";
import {
  createWebsiteTicketFromValidatedInput,
  toPublicWebsiteTicketResponse,
  type CreateWebsiteTicketDeps,
} from "@/lib/public-intake/create-website-ticket";
import { validateWebsiteTicketBody } from "@/lib/public-intake/validate";
import { verifyWhatsAppIntakeApiKey } from "@/lib/public-intake/whatsapp-auth";
import { NextResponse, type NextRequest } from "next/server";

export type WhatsAppIntakeHandlerDeps = CreateWebsiteTicketDeps & {
  env?: Record<string, string | undefined>;
};

function json(
  body: unknown,
  status: number,
): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * API-key-protected WhatsApp intake. Reuses website validation, ticket
 * creation, and email — stamps source_channel = "whatsapp".
 */
export async function handleWhatsAppTicketPost(
  request: NextRequest,
  deps: WhatsAppIntakeHandlerDeps = {},
): Promise<NextResponse> {
  const { env, ...createDeps } = deps;
  const auth = verifyWhatsAppIntakeApiKey(
    request.headers.get("x-api-key"),
    env ?? process.env,
  );
  if (!auth.ok) {
    return json(auth.response, auth.status);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(
      { success: false, message: "Content-Type must be application/json." },
      415,
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      Number.isFinite(contentLength) &&
      contentLength > WEBSITE_INTAKE_MAX_BODY_BYTES
    ) {
      return json(
        { success: false, message: "Request body is too large." },
        413,
      );
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return json(
      { success: false, message: "Unable to read request body." },
      400,
    );
  }

  if (rawText.length > WEBSITE_INTAKE_MAX_BODY_BYTES) {
    return json(
      { success: false, message: "Request body is too large." },
      413,
    );
  }

  let body: unknown;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    return json(
      { success: false, message: "Request body must be valid JSON." },
      400,
    );
  }

  const validated = validateWebsiteTicketBody(body, {
    lenientCreatorFields: true,
  });
  if (!validated.ok) {
    return json({ success: false, message: validated.error }, validated.status);
  }

  try {
    const result = await createWebsiteTicketFromValidatedInput(validated.value, {
      ...createDeps,
      sourceChannel: "whatsapp",
    });
    if (!result.ok) {
      return json(result.response, result.status);
    }

    return json(toPublicWebsiteTicketResponse(result.response), 201);
  } catch {
    console.error("whatsapp intake unexpected failure");
    return json(
      {
        success: false,
        message: "Unable to submit your request right now. Please try again.",
      },
      500,
    );
  }
}
