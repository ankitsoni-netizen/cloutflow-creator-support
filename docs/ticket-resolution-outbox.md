# Ticket resolution outbox

Fast Resolve commits ticket status in `resolve_creator_support_ticket`, then delivers Instagram, WhatsApp, email, transcript, comment delivery, and `customer_last_notified_at` from `ticket_resolution_jobs`.

Next.js `after()` is the low-latency drain. Recurring Supabase `pg_cron` + `pg_net` is the guaranteed retry path.

## Vercel environment variable

Add this **name** in Vercel (Production / Preview / Development as needed). Do not put a value in the repository.

| Variable |
| --- |
| `TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET` |

The drain endpoint is `POST /api/internal/tickets/resolution-outbox/drain` with `Authorization: Bearer {secret}`.

## Supabase Vault names

Create these Vault secrets (values are environment-specific; never commit them):

- `ticket_resolution_outbox_drain_url`
- `ticket_resolution_outbox_drain_secret`

Cron job name: `ticket-resolution-outbox-drain`  
Schedule: `* * * * *` (once per minute)

Missing Vault values fail closed: the cron row can exist, but `net.http_post` does not run. Ticket resolution still commits.

## Safe rollout order

Do not ship a period where Resolve looks successful but no durable job is created. The app returns an error if the RPC is missing.

1. **Apply** `supabase/migrations/20260827140000_ticket_resolution_outbox.sql` on the target database (table, RPC, claim function, unique resolved-event index). Old app code can keep running: it does not call the RPC or drain endpoint.
2. **Set** Vercel `TICKET_RESOLUTION_OUTBOX_DRAIN_SECRET` (no repo value). Redeploy is not required until the new app is ready, but the secret must exist before the new drain endpoint is invoked.
3. **Deploy** the application that:
   - resolves only through `resolve_creator_support_ticket`
   - exposes `POST /api/internal/tickets/resolution-outbox/drain`
   - schedules `after()` drain after commit
4. **Create** Vault secrets `ticket_resolution_outbox_drain_url` and `ticket_resolution_outbox_drain_secret` (URL = `https://<host>/api/internal/tickets/resolution-outbox/drain`).
5. **Apply** `supabase/migrations/20260827150000_ticket_resolution_outbox_pg_cron_drain.sql`. It unschedules the stable job name before rescheduling, so it does not create duplicates. If Vault is empty, cron is inert.
6. **Smoke test** in production:
   - Resolve a ticket; confirm status is `resolved`, `resolved_at` is set, one resolution audit event, one `ticket_resolution_jobs` row.
   - Confirm `after()` drain marks the job `sent` or leaves a retryable `failed` row (resolution stays committed).
   - Force a failed job (`delivery_status = failed`, `next_attempt_at` in the past) and wait for the one-minute cron, or `POST` the drain endpoint with the Bearer secret.

### Temporary states

- **New app, migration not yet applied:** RPC is missing. Resolve returns “temporarily unavailable”, optimistic UI rolls back, ticket stays open. No fake success and no missing job.
- **Migration applied, old app still serving:** Old Resolve still awaits notifications inline and does not enqueue `ticket_resolution_jobs`. Harmless. New Resolve + durable jobs start only after the new app is deployed.

Never reverse this order by deploying RPC-only app code before `20260827140000`.
