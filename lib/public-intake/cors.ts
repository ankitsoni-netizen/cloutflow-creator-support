import "server-only";

/**
 * Exact-origin CORS for the public website intake API.
 *
 * Configure WEBSITE_INTAKE_ALLOWED_ORIGINS as a comma-separated list, e.g.
 * https://cloutflow.com,https://www.cloutflow.com,https://cloutflow-creator-support.vercel.app
 *
 * Localhost origins are allowed only when NODE_ENV is not "production".
 */

const LOCALHOST_ORIGIN_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getWebsiteIntakeAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return parseAllowedOrigins(env.WEBSITE_INTAKE_ALLOWED_ORIGINS);
}

export function isLocalhostOriginAllowed(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false;
  return LOCALHOST_ORIGIN_PATTERN.test(origin);
}

export function resolveAllowedOrigin(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!requestOrigin) return null;

  const configured = getWebsiteIntakeAllowedOrigins(env);
  if (configured.includes(requestOrigin)) {
    return requestOrigin;
  }

  if (isLocalhostOriginAllowed(requestOrigin, env)) {
    return requestOrigin;
  }

  return null;
}

export function buildCorsHeaders(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): HeadersInit {
  const allowed = resolveAllowedOrigin(requestOrigin, env);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
  }

  return headers;
}

export function isOriginPermitted(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Same-origin / non-browser callers may omit Origin.
  if (!requestOrigin) return true;
  return resolveAllowedOrigin(requestOrigin, env) !== null;
}
