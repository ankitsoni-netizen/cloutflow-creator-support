import { handleWhatsAppTicketPost } from "@/lib/public-intake/whatsapp-intake";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/** Lightweight availability check — no DB, email, or config exposure. */
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      service: "Cloutflow WhatsApp ticket intake",
      status: "available",
      method: "POST",
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  return handleWhatsAppTicketPost(request);
}
