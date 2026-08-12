import {
  buildCorsHeaders,
  isOriginPermitted,
} from "@/lib/public-intake/cors";
import { WEBSITE_INTAKE_MAX_BODY_BYTES } from "@/lib/public-intake/constants";
import {
  createWebsiteTicketFromValidatedInput,
  toPublicWebsiteTicketResponse,
} from "@/lib/public-intake/create-website-ticket";
import { validateWebsiteTicketBody } from "@/lib/public-intake/validate";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function jsonWithCors(
  request: NextRequest,
  body: unknown,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: buildCorsHeaders(request.headers.get("origin")),
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginPermitted(origin)) {
    return new NextResponse(null, {
      status: 403,
      headers: buildCorsHeaders(origin),
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

/** Lightweight availability check — no DB, email, or config exposure. */
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      service: "Cloutflow website ticket intake",
      status: "available",
      method: "POST",
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginPermitted(origin)) {
    return jsonWithCors(
      request,
      { success: false, message: "Origin is not allowed." },
      403,
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonWithCors(
      request,
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
      return jsonWithCors(
        request,
        { success: false, message: "Request body is too large." },
        413,
      );
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return jsonWithCors(
      request,
      { success: false, message: "Unable to read request body." },
      400,
    );
  }

  if (rawText.length > WEBSITE_INTAKE_MAX_BODY_BYTES) {
    return jsonWithCors(
      request,
      { success: false, message: "Request body is too large." },
      413,
    );
  }

  let body: unknown;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    return jsonWithCors(
      request,
      { success: false, message: "Request body must be valid JSON." },
      400,
    );
  }

  const validated = validateWebsiteTicketBody(body);
  if (!validated.ok) {
    return jsonWithCors(
      request,
      { success: false, message: validated.error },
      validated.status,
    );
  }

  try {
    const result = await createWebsiteTicketFromValidatedInput(validated.value);
    if (!result.ok) {
      return jsonWithCors(request, result.response, result.status);
    }

    return jsonWithCors(
      request,
      toPublicWebsiteTicketResponse(result.response),
      201,
    );
  } catch {
    console.error("website intake unexpected failure");
    return jsonWithCors(
      request,
      {
        success: false,
        message: "Unable to submit your request right now. Please try again.",
      },
      500,
    );
  }
}
