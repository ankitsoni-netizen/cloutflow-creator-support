-- SUPERSEDED. Do not run.
-- Timeline sender_address on CF-2026-00027 is collapsed to one fingerprint.
-- Row ownership cannot be inferred from sender_address or timestamps.
-- Use supabase/incident/20260828_cf_2026_00027_webhook_mid_repair.sql
-- only after the webhook identity audit shows two stable inbound senders
-- linked by external_message_id. Otherwise quarantine and preserve all rows.

SELECT 'do_not_run_sender_address_repair'::text AS status;
