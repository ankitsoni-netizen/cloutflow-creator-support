import { isUnauthenticatedProxyPath } from "@/lib/proxy-public-paths";
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Session refresh for CRM routes. Public routes stay unauthenticated:
 * - /help
 * - /api/public/*
 * - /api/webhooks/meta
 *
 * Staff protection remains page-level via requireActiveStaff() on CRM pages.
 * Do not weaken CRM authentication here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isUnauthenticatedProxyPath(pathname)) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
