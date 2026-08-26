/**
 * Paths that skip session refresh in proxy.ts.
 * These stay publicly reachable and must not redirect to /login.
 * Staff CRM protection remains page-level via requireActiveStaff().
 */
export function isUnauthenticatedProxyPath(pathname: string): boolean {
  return (
    pathname === "/help" ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/webhooks/meta" ||
    pathname.startsWith("/api/webhooks/meta/") ||
    pathname === "/api/webhooks/wati" ||
    pathname.startsWith("/api/webhooks/wati/")
  );
}
