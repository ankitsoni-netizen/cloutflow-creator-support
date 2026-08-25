import "server-only";

import {
  getInstagramGraphSendConfig,
  INSTAGRAM_GRAPH_BASE,
  type InstagramSendDeps,
} from "@/lib/meta/instagram-send";

export const INSTAGRAM_USERNAME_LOOKUP_TIMEOUT_MS = 800;

const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,64}$/;
const NUMERIC_ID_PATTERN = /^\d+$/;

/**
 * Best-effort Instagram username lookup. Short timeout, one attempt.
 * Failure must never stop the chatbot. Never log the token or username.
 */
export async function lookupInstagramUsername(
  igsid: string,
  deps: InstagramSendDeps = {},
  timeoutMs: number = INSTAGRAM_USERNAME_LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  const id = igsid.trim();
  if (!id || !NUMERIC_ID_PATTERN.test(id)) return null;

  const env = deps.env ?? process.env;
  const config = getInstagramGraphSendConfig(env);
  if (!config) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(
      `${INSTAGRAM_GRAPH_BASE}/${config.graphVersion}/${id}`,
    );
    url.searchParams.set("fields", "username");
    url.searchParams.set("access_token", config.accessToken);
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { username?: unknown };
    if (typeof body.username !== "string") return null;
    const username = body.username.trim();
    if (!USERNAME_PATTERN.test(username)) return null;
    return username;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
