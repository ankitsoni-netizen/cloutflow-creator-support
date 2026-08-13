/**
 * Public app origin for email assets and login links.
 * Prefer NEXT_PUBLIC_SITE_URL; fall back to VERCEL_URL, then localhost.
 */
export function resolveAppOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const site = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (site) return site;

  const vercel = env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) {
    if (/^https?:\/\//i.test(vercel)) return vercel;
    return `https://${vercel}`;
  }

  return "http://localhost:3000";
}
