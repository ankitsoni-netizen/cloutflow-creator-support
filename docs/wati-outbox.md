# WATI chatbot outbox

Automated WATI text, button, and list replies persist on `channel_messages` before delivery. Next.js `after()` is the low-latency drain. Recurring Supabase `pg_cron` + `pg_net` is the guaranteed retry path after process termination.

WATI v3 session send has no request-side idempotency field. Delivery is at-least-once: a crash after WATI accepts a message and before `delivery_status = sent` can produce a duplicate after the 60-second claim lease expires. Stored WhatsApp / WATI message ids are used to correlate later status webhooks, not to suppress the first resend.

## Table and reservation

Table: `channel_messages` (WhatsApp chatbot rows use `channel = 'whatsapp'`).

| Concern | Column |
| --- | --- |
| Reconstruction | `message_body`, `raw_payload` (`text` + `quick_replies` only) |
| Delivery status | `delivery_status` (`pending`, `failed`, `sent`, `delivered`, `read`) |
| Retry timestamp | `next_attempt_at` |
| Attempt counter | `delivery_attempt_count` |
| Claim/lease | `next_attempt_at` set to now + 60s by `claim_wati_outbound_send` |
| Last attempt | `last_attempt_at` |
| Idempotency | `idempotency_key` (chatbot prompt key; not a WATI request field) |
| Linkage | `conversation_id`, `ticket_id` |

`raw_payload` is sanitized to text and quick-reply titles/payloads. It must not contain a token, Authorization header, secret, or endpoint URL. It is never logged.

Snapshot persist (`saveConversationSnapshot`) is not used for automated WATI chatbot transitions. `reserve_wati_outbound_and_snapshot` updates the conversation (OCC on `last_processed_external_message_id`) and inserts sanitized `channel_messages` rows in one transaction. If outbound insert fails, the snapshot rolls back. If OCC fails, no outbound is inserted.

Immediate send and `after()` drain run only after that RPC commits. Cron recovers pending rows after process termination.

RLS is enabled on `channel_messages`. `PUBLIC` / `anon` / `authenticated` have no table grants. `service_role` may select/insert/update and is the only role granted `EXECUTE` on `claim_wati_outbound_send` and `reserve_wati_outbound_and_snapshot`.

## Vercel environment variable

Add this **name** in Vercel (Production / Preview / Development as needed). Do not put a value in the repository.

| Variable |
| --- |
| `WATI_OUTBOX_DRAIN_SECRET` |

The drain endpoint is `POST /api/internal/wati/outbox/drain` with `Authorization: Bearer {secret}`. Missing secret fails closed (401).

## Supabase Vault names

Create these Vault secrets (values are environment-specific; never commit them):

- `wati_outbox_drain_url`
- `wati_outbox_drain_secret`

Cron job name: `wati-outbox-drain`
Schedule: `* * * * *` (once per minute)

Missing Vault values fail closed: the cron row can exist, but `net.http_post` does not run.

## Safe rollout order

1. **Apply** `supabase/migrations/20260903180000_wati_outbox_claim.sql` (claim RPC, due index, `service_role`-only execute). Old app code can keep running.
2. **Apply** `supabase/migrations/20260903180200_wati_reserve_outbound_and_snapshot.sql` (atomic snapshot + outbound reservation). The application must not deploy until this RPC exists.
3. **Set** Vercel `WATI_OUTBOX_DRAIN_SECRET` (no repo value).
4. **Deploy** the application that:
   - atomically reserves snapshot + outbound before acknowledging state progression
   - claims a 60s lease before each WATI send
   - exposes `POST /api/internal/wati/outbox/drain`
   - schedules `after()` drain after persist
5. **Create** Vault secrets `wati_outbox_drain_url` and `wati_outbox_drain_secret` (URL = `https://<host>/api/internal/wati/outbox/drain`).
6. **Apply** `supabase/migrations/20260903180300_wati_outbox_pg_cron_drain.sql`. It unschedules the stable job name before rescheduling. If Vault is empty, cron is inert.

Never put tokens, Authorization headers, endpoints, creator text, or `raw_payload` in logs.
