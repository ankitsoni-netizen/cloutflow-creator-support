import "server-only";

import { getActiveStaffContext } from "@/lib/tickets/auth-action";
import { consumeStaffActionRateLimit } from "@/lib/tickets/staff-rate-limit";
import { loadTicketById } from "@/lib/tickets/email-delivery";
import {
  sendStaffInstagramReply,
  isInstagramTicket,
} from "@/lib/tickets/instagram-reply";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const staff = await getActiveStaffContext();
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error }, { status: 401 });
  }

  const rate = consumeStaffActionRateLimit(staff.user.id);
  if (!rate.ok) {
    return NextResponse.json({ error: rate.error }, { status: 429 });
  }

  const { ticketId } = await context.params;
  if (!ticketId) {
    return NextResponse.json({ error: "Ticket id is required." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const commentId =
    typeof record.commentId === "string" ? record.commentId.trim() : "";
  const commentText =
    typeof record.commentText === "string" ? record.commentText : "";
  if (!commentId || !commentText.trim()) {
    return NextResponse.json(
      { error: "commentId and commentText are required." },
      { status: 400 },
    );
  }

  const loaded = await loadTicketById(staff.supabase, ticketId);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: 404 });
  }
  if (!isInstagramTicket(loaded.data)) {
    return NextResponse.json(
      { error: "This ticket is not an Instagram ticket." },
      { status: 400 },
    );
  }

  const result = await sendStaffInstagramReply({
    ticket: loaded.data,
    commentId,
    commentText,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, errorCode: result.errorCode },
      { status: 400 },
    );
  }

  return NextResponse.json({
    instagram: result.instagram,
    email: result.email,
    alreadySent: result.alreadySent ?? false,
    messagingWindowExpired: result.messagingWindowExpired ?? false,
  });
}
