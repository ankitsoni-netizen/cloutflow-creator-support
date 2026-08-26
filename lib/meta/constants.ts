export const META_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const META_WEBHOOK_EVENT_RECEIVED = "EVENT_RECEIVED";

export const META_WEBHOOK_HEALTH_BODY = "ok";

/** Applied webhook_events.provider values for direct Meta ingest. Never `wati` / `wati_whatsapp`. */
export const META_WHATSAPP_PROVIDER = "meta_whatsapp" as const;
export const META_INSTAGRAM_PROVIDER = "meta_instagram" as const;

export type MetaWebhookProvider =
  | typeof META_WHATSAPP_PROVIDER
  | typeof META_INSTAGRAM_PROVIDER;

export const META_SIGNATURE_HEADER = "x-hub-signature-256";

export const META_SIGNATURE_PREFIX = "sha256=";

export const WEBHOOK_STATUS_RECEIVED = "received" as const;
export const WEBHOOK_STATUS_PROCESSING = "processing" as const;
export const WEBHOOK_STATUS_COMPLETED = "completed" as const;
export const WEBHOOK_STATUS_FAILED = "failed" as const;
