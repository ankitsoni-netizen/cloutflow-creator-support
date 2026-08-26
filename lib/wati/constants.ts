/**
 * Applied webhook_events.provider value for WATI WhatsApp ingest.
 * Must match the DB check: wati | meta | meta_whatsapp | meta_instagram | website | brevo.
 * Never use wati_whatsapp — that value is rejected by the constraint.
 */
export const WATI_WHATSAPP_PROVIDER = "wati" as const;

export const WATI_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const WATI_WEBHOOK_EVENT_RECEIVED = "EVENT_RECEIVED";

export const WATI_SEND_TIMEOUT_MS = 10_000;

export const WATI_SEND_MAX_RESPONSE_BYTES = 64 * 1024;

/** Env: WHATSAPP_PROVIDER=wati selects this transport. */
export const WHATSAPP_PROVIDER_WATI = "wati" as const;

/** Env: WHATSAPP_PROVIDER=meta keeps the inactive Meta Cloud API fallback. */
export const WHATSAPP_PROVIDER_META = "meta" as const;

/**
 * Canonical WATI webhook event types used in external_event_id.
 * Format: `{normalizedEventType}:{whatsappMessageId|watiCallbackId}`
 */
export const WATI_NORMALIZED_EVENT_TYPES = [
  "messageReceived",
  "sessionMessageSent_v2",
  "templateMessageSent_v2",
  "sentMessageDELIVERED_v2",
  "sentMessageREAD_v2",
  "sessionMessageFailed_v2",
] as const;

export type WatiNormalizedEventType =
  (typeof WATI_NORMALIZED_EVENT_TYPES)[number];
