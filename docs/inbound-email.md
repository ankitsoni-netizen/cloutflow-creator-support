# Inbound email replies

Opaque Reply-To aliases and Brevo inbound ingest for Creator Support tickets.

Do not create or activate the Brevo inbound webhook until the migration is applied, `BREVO_INBOUND_WEBHOOK_SECRET` is set, and the app is deployed.

## Rollout order

1. Apply `supabase/migrations/20260904120000_ticket_inbound_email_replies.sql` through the normal Supabase workflow. Do not apply it from local agent sessions.
2. Set server-only `BREVO_INBOUND_WEBHOOK_SECRET` on the host. Do not put it in `NEXT_PUBLIC_*`.
3. Deploy the app that includes `POST /api/webhooks/brevo/inbound-email`.
4. Later, in Brevo, create an inbound webhook (not done in this change):
   - Type: `inbound`
   - Event: `inboundEmailProcessed`
   - URL: `https://<production-host>/api/webhooks/brevo/inbound-email`
   - Custom header: `x-cloutflow-inbound-email-secret: <BREVO_INBOUND_WEBHOOK_SECRET>`
   - Domain: `reply.cloutflow.com`
5. Send a test creator-facing ticket email and confirm Reply-To is `t-<32-hex>@reply.cloutflow.com`.

Existing Brevo SMTP variables are unchanged. `BREVO_REPLY_TO_EMAIL` remains the fallback Reply-To when alias allocation is unavailable, and is still used for mail that is not creator-facing ticket mail.

## Mapping rules

Inbound mail maps to a ticket only through the exact opaque alias collected from To, Cc, Recipients (RCPT TO), and Delivered-To. Subject, ticket code, creator name, username, phone, latest ticket, timestamp, campaign, Reply-To header, From display name, and fuzzy email matching are never used.

After alias resolution the normalized sender must equal `tickets.creator_email` (trim + lowercase only). Fail closed otherwise. Inbound email never changes `source_channel` or ticket identity columns. Staff public replies continue to use the original channel.

Historical tickets do not receive a bulk alias backfill. The first creator-facing send calls `ensure_ticket_email_reply_alias`. Tickets with no creator email do not get an alias on insert and do not get Reply-To aliases attached to outbound mail.

## Attachments (unsupported in this release)

There is no private ticket-attachment storage bucket. Inbound attachments are **not stored and not downloadable** in the CRM. The ingest records sanitized filename, MIME type, size, and a status only. Brevo `DownloadToken` values, URLs, and file bytes are discarded. Unsupported or extra attachments do not block ingest of a safe text body.

## Rollback order

1. Disable or delete the Brevo inbound webhook if it was created.
2. Deploy an app revision that does not expose `/api/webhooks/brevo/inbound-email` if you need to stop ingest.
3. Run the rollback SQL at the bottom of `20260904120000_ticket_inbound_email_replies.sql`.
4. Remove `BREVO_INBOUND_WEBHOOK_SECRET` after ingest is gone.
