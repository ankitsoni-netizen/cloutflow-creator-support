/** Applied webhook_events.provider value for WATI WhatsApp ingest. */
export const WATI_WHATSAPP_PROVIDER = "wati_whatsapp" as const;

export const WATI_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const WATI_WEBHOOK_EVENT_RECEIVED = "EVENT_RECEIVED";

export const WATI_SEND_TIMEOUT_MS = 10_000;

export const WATI_SEND_MAX_RESPONSE_BYTES = 64 * 1024;

/** Env: WHATSAPP_PROVIDER=wati selects this transport. */
export const WHATSAPP_PROVIDER_WATI = "wati" as const;

/** Env: WHATSAPP_PROVIDER=meta keeps the inactive Meta Cloud API fallback. */
export const WHATSAPP_PROVIDER_META = "meta" as const;
