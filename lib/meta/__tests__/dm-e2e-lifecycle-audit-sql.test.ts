import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

export const DM_E2E_LIFECYCLE_AUDIT_SQL_PATH = resolve(
  __dirname,
  "../../../supabase/incident/20260903_dm_e2e_lifecycle_audit.sql",
);

export function readDmE2eLifecycleAuditSql(): string {
  return readFileSync(DM_E2E_LIFECYCLE_AUDIT_SQL_PATH, "utf8");
}

const CONV_A = "11111111-1111-1111-1111-111111111111";
const CONV_B = "22222222-2222-2222-2222-222222222222";
const CONV_W = "33333333-3333-3333-3333-333333333333";
const CONV_D = "d1111111-1111-1111-1111-111111111111";
const CONV_E = "e1111111-1111-1111-1111-111111111111";
const CONV_F = "f1111111-1111-1111-1111-111111111111";
const CONV_G = "a1111111-1111-1111-1111-111111111111";
const CONV_H = "b1111111-1111-1111-1111-111111111111";
const TICKET_B = "44444444-4444-4444-4444-444444444444";
const TICKET_W = "55555555-5555-5555-5555-555555555555";
const TICKET_UNSTAMPED = "66666666-6666-6666-6666-666666666666";
const TICKET_E = "e4444444-4444-4444-4444-444444444444";
const TICKET_F = "f4444444-4444-4444-4444-444444444444";
const TICKET_G = "a4444444-4444-4444-4444-444444444444";
const TICKET_H1 = "b4414444-4444-4444-4444-444444444444";
const TICKET_H2 = "c4424444-4444-4444-4444-444444444444";
const PAGE = "17841400008460000";
const PAGE_OTHER = "17841499999999999";
const IGSID_A = "100000000000001";
const IGSID_B = "100000000000002";
const IGSID_D = "100000000000004";
const IGSID_E = "100000000000005";
const IGSID_F = "100000000000006";
const IGSID_G = "100000000000007";
const IGSID_H = "100000000000008";
const WATI_ACCOUNT = "17435002445";
const WATI_SENDER = "8618719149214";
const MID_A = "mid.creator.a.raise";
const MID_B = "mid.creator.b.historical";
const WAMID_W = "wamid.creator.w.raise";

const AUDIT_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.digest(src bytea, algo text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(md5(src), 'hex');
$$;

CREATE TABLE public.channel_conversations (
  id uuid PRIMARY KEY,
  channel text NOT NULL,
  provider text,
  state text,
  ticket_id uuid,
  external_contact_id text,
  external_conversation_id text,
  recipient_account_id text,
  identity_status text,
  last_processed_external_message_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY,
  ticket_code text,
  source_channel text,
  status text,
  identity_status text,
  external_contact_id text,
  external_conversation_id text,
  recipient_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  ticket_id uuid,
  channel text,
  direction text,
  purpose text,
  idempotency_key text,
  delivery_status text,
  external_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.channel_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  conversation_id uuid,
  purpose text,
  idempotency_key text,
  delivery_status text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

type AuditRow = {
  ticket_code: string | null;
  provider: string | null;
  channel: string | null;
  conversation_state: string | null;
  has_ticket_link: boolean | null;
  exact_ticket_candidate_count: number | null;
  structural_active_ticket_count: number | null;
  unproven_identity_ticket_count: number | null;
  recipient_conflict_ticket_count: number | null;
  conversation_key_mismatch_ticket_count: number | null;
  inactive_exact_ticket_count: number | null;
  candidate_rejection_reason: string | null;
  ticket_status: string | null;
  identity_status: string | null;
  candidate_ticket_code: string | null;
  candidate_ticket_status: string | null;
  candidate_ticket_identity_status: string | null;
  final_summary_outbound_status: string | null;
  ticket_closing_outbound_status: string | null;
  email_purpose: string | null;
  email_status: string | null;
  email_error_code: string | null;
  webhook_processing_status: string | null;
  webhook_error_code: string | null;
  contact_fp: string | null;
  conversation_fp: string | null;
};

function igEnvelope(sender: string, mid: string) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: PAGE,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: PAGE },
            message: { mid, text: "Raise ticket" },
          },
        ],
      },
    ],
  });
}

async function seedAuditFixture(db: PGlite) {
  await db.query(
    `INSERT INTO public.channel_conversations (
       id, channel, provider, state, ticket_id, external_contact_id,
       external_conversation_id, recipient_account_id, identity_status,
       last_processed_external_message_id, updated_at
     ) VALUES
     ($1, 'instagram', 'meta_instagram', 'creator_confirmation', NULL, $2,
      $3, $4, 'unambiguous', $5, now()),
     ($6, 'instagram', 'meta_instagram', 'awaiting_post_completion', $7, $8,
      $9, $4, 'unambiguous', $10, now() - interval '2 days'),
     ($11, 'whatsapp', 'wati', 'creator_confirmation', NULL, $12,
      $13, $14, 'unambiguous', $15, now() - interval '1 hour'),
     ($16, 'instagram', 'meta_instagram', 'awaiting_month_confirmation', NULL, $17,
      $18, $4, 'unambiguous', NULL, now() - interval '3 hours'),
     ($19, 'instagram', 'meta_instagram', 'creator_campaign_details', NULL, $20,
      $21, $4, 'unambiguous', NULL, now() - interval '4 hours'),
     ($22, 'instagram', 'meta_instagram', 'creator_confirmation', NULL, $23,
      $24, $4, 'unambiguous', NULL, now() - interval '5 hours'),
     ($25, 'instagram', 'meta_instagram', 'creator_confirmation', NULL, $26,
      $27, $4, 'unambiguous', NULL, now() - interval '6 hours'),
     ($28, 'instagram', 'meta_instagram', 'creator_confirmation', NULL, $29,
      $30, $4, 'unambiguous', NULL, now() - interval '7 hours')`,
    [
      CONV_A,
      IGSID_A,
      `${PAGE}:${IGSID_A}`,
      PAGE,
      MID_A,
      CONV_B,
      TICKET_B,
      IGSID_B,
      `${PAGE}:${IGSID_B}`,
      MID_B,
      CONV_W,
      WATI_SENDER,
      `${WATI_ACCOUNT}:${WATI_SENDER}`,
      WATI_ACCOUNT,
      WAMID_W,
      CONV_D,
      IGSID_D,
      `${PAGE}:${IGSID_D}`,
      CONV_E,
      IGSID_E,
      `${PAGE}:${IGSID_E}`,
      CONV_F,
      IGSID_F,
      `${PAGE}:${IGSID_F}`,
      CONV_G,
      IGSID_G,
      `${PAGE}:${IGSID_G}`,
      CONV_H,
      IGSID_H,
      `${PAGE}:${IGSID_H}`,
    ],
  );

  await db.query(
    `INSERT INTO public.tickets (
       id, ticket_code, source_channel, status, identity_status,
       external_contact_id, external_conversation_id, recipient_account_id,
       created_at
     ) VALUES
     ($1, 'CF-2026-00002', 'instagram', 'open', 'unambiguous',
      $2, $3, $4, now() - interval '2 days'),
     ($5, 'CF-2026-00009', 'whatsapp', 'open', 'unambiguous',
      $6, $7, $8, now() - interval '1 hour'),
     ($9, 'CF-2026-00077', 'instagram', 'open', NULL,
      $10, $11, $4, now()),
     ($12, 'CF-2026-00015', 'instagram', 'open', 'unambiguous',
      $13, $14, $15, now() - interval '4 hours'),
     ($16, 'CF-2026-00016', 'instagram', 'open', 'unambiguous',
      $17, $18, $4, now() - interval '5 hours'),
     ($19, 'CF-2026-00017', 'instagram', 'resolved', 'unambiguous',
      $20, $21, $4, now() - interval '6 hours'),
     ($22, 'CF-2026-00018', 'instagram', 'open', 'unambiguous',
      $23, $24, $4, now() - interval '7 hours'),
     ($25, 'CF-2026-00019', 'instagram', 'open', 'unambiguous',
      $23, $24, $4, now() - interval '7 hours')`,
    [
      TICKET_B,
      IGSID_B,
      `${PAGE}:${IGSID_B}`,
      PAGE,
      TICKET_W,
      WATI_SENDER,
      `${WATI_ACCOUNT}:${WATI_SENDER}`,
      WATI_ACCOUNT,
      TICKET_UNSTAMPED,
      IGSID_A,
      `${PAGE}:${IGSID_A}`,
      TICKET_E,
      IGSID_E,
      `${PAGE}:${IGSID_E}`,
      PAGE_OTHER,
      TICKET_F,
      IGSID_F,
      PAGE,
      TICKET_G,
      IGSID_G,
      `${PAGE}:${IGSID_G}`,
      TICKET_H1,
      IGSID_H,
      `${PAGE}:${IGSID_H}`,
      TICKET_H2,
    ],
  );

  await db.query(
    `INSERT INTO public.channel_messages (
       conversation_id, ticket_id, channel, direction, purpose,
       idempotency_key, delivery_status, external_message_id, created_at
     ) VALUES
     ($1, NULL, 'instagram', 'inbound', 'inbound', NULL, NULL, $2, now()),
     ($3, $4, 'instagram', 'inbound', 'inbound', NULL, NULL, $5, now() - interval '2 days'),
     ($6, NULL, 'whatsapp', 'inbound', 'inbound', NULL, NULL, $7, now() - interval '1 hour'),
     ($1, NULL, 'instagram', 'outbound', 'creator_confirm',
      $8, 'sent', NULL, now()),
     ($1, $4, 'instagram', 'outbound', 'ticket_created',
      $9, 'sent', NULL, now()),
     ($3, $4, 'instagram', 'outbound', 'ticket_created',
      $10, 'delivered', NULL, now() - interval '2 days'),
     ($11, $4, 'instagram', 'outbound', 'ticket_created',
      $12, 'sent', NULL, now() - interval '3 hours')`,
    [
      CONV_A,
      MID_A,
      CONV_B,
      TICKET_B,
      MID_B,
      CONV_W,
      WAMID_W,
      `ig:prompt:${CONV_A}:v1:creator_confirm:v2`,
      `ig:prompt:${CONV_A}:v1:ticket_created:${TICKET_B}`,
      `ig:prompt:${CONV_B}:v1:ticket_created:${TICKET_B}`,
      CONV_D,
      `ig:prompt:${CONV_D}:v1:ticket_created:${TICKET_B}`,
    ],
  );

  await db.query(
    `INSERT INTO public.channel_email_deliveries (
       ticket_id, conversation_id, purpose, idempotency_key,
       delivery_status, error_code, updated_at
     ) VALUES
     ($1, $2, 'instagram-ticket-confirmation', $3, 'sent', NULL, now() - interval '2 days'),
     ($4, $5, 'whatsapp-ticket-confirmation', $6, 'failed', 'email_send_failed', now())`,
    [
      TICKET_B,
      CONV_B,
      `email:ig-confirm:${TICKET_B}`,
      TICKET_W,
      CONV_W,
      `email:wa-confirm:${TICKET_W}`,
    ],
  );

  await db.query(
    `INSERT INTO public.webhook_events (
       provider, external_event_id, payload, processing_status, error_code, updated_at
     ) VALUES
     ('meta_instagram', $1, $2::jsonb, 'failed', 'instagram_send_failed', now()),
     ('meta_instagram', $3, $4::jsonb, 'completed', NULL, now() - interval '2 days'),
     (
       'wati',
       $5,
       $6::jsonb,
       'failed',
       'whatsapp_send_failed',
       now()
     )`,
    [
      MID_A,
      igEnvelope(IGSID_A, MID_A),
      MID_B,
      igEnvelope(IGSID_B, MID_B),
      WAMID_W,
      JSON.stringify({
        waId: WATI_SENDER,
        channelPhoneNumber: `+${WATI_ACCOUNT}`,
        whatsappMessageId: WAMID_W,
        eventType: "message",
        type: "button",
      }),
    ],
  );
}

describe("DM e2e lifecycle audit SQL", () => {
  it("is a single SELECT-only result table without PII", () => {
    const sql = readDmE2eLifecycleAuditSql();
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments.match(/\bSELECT\b/gi)?.length).toBeGreaterThan(0);
    expect(withoutComments).not.toMatch(
      /\b(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|CREATE|DROP|DO|GRANT|REVOKE)\b/i,
    );
    expect(withoutComments).not.toMatch(
      /\b(creator_email|message_body|raw_payload|access_token|phone|wa_id|Authorization)\b/i,
    );
    expect(withoutComments).not.toMatch(
      /LEFT JOIN webhooks w ON w\.provider = f\.provider/,
    );
    expect(withoutComments).not.toMatch(/DISTINCT ON \(w\.provider\)/);
    expect(withoutComments).toContain("candidate_ticket_code");
    expect(withoutComments).toContain("candidate_rejection_reason");
    expect(withoutComments).toContain("structural_active_ticket_count");
    expect(withoutComments).toContain("ticket_closing_outbound_status");
    expect(withoutComments).toContain("whatsapp-ticket-confirmation");
    expect(withoutComments).toContain("instagram-ticket-confirmation");
    expect(withoutComments).toContain("contact_fp");
  });

  it(
    "executes identity-scoped correlation and every rejection reason",
    { timeout: 20_000 },
    async () => {
      const db = new PGlite();
      await db.exec(AUDIT_SCHEMA);
      await seedAuditFixture(db);
      const result = await db.query<AuditRow>(readDmE2eLifecycleAuditSql());
      expect(result.rows.length).toBe(8);

      const byReason = (reason: string) =>
        result.rows.filter((row) => row.candidate_rejection_reason === reason);

      const igA = byReason("identity_unproven")[0];
      const igB = result.rows.find(
        (row) => row.channel === "instagram" && row.has_ticket_link,
      );
      const wati = result.rows.find((row) => row.channel === "whatsapp");
      const noneStructural = byReason("no_structural_ticket")[0];
      const recipientConflict = byReason("recipient_conflict")[0];
      const keyMismatch = byReason("conversation_key_mismatch")[0];
      const inactive = byReason("inactive_ticket")[0];
      const multiple = byReason("multiple_candidates")[0];

      expect(igA).toBeTruthy();
      expect(igB).toBeTruthy();
      expect(wati).toBeTruthy();
      expect(noneStructural).toBeTruthy();
      expect(recipientConflict).toBeTruthy();
      expect(keyMismatch).toBeTruthy();
      expect(inactive).toBeTruthy();
      expect(multiple).toBeTruthy();

      expect(igA?.has_ticket_link).toBe(false);
      expect(igA?.ticket_code).toBeNull();
      expect(igA?.exact_ticket_candidate_count).toBe(0);
      expect(igA?.structural_active_ticket_count).toBe(1);
      expect(igA?.unproven_identity_ticket_count).toBe(1);
      expect(igA?.recipient_conflict_ticket_count).toBe(0);
      expect(igA?.conversation_key_mismatch_ticket_count).toBe(0);
      expect(igA?.inactive_exact_ticket_count).toBe(0);
      expect(igA?.candidate_ticket_code).toBeNull();
      expect(igA?.final_summary_outbound_status).toBe("sent");
      expect(igA?.ticket_closing_outbound_status).toBeNull();
      expect(igA?.email_purpose).toBeNull();
      expect(igA?.webhook_error_code).toBe("instagram_send_failed");

      expect(igB?.candidate_rejection_reason).toBe("none");
      expect(igB?.ticket_code).toBe("CF-2026-00002");
      expect(igB?.exact_ticket_candidate_count).toBe(1);
      expect(igB?.structural_active_ticket_count).toBe(1);
      expect(igB?.webhook_error_code).not.toBe("instagram_send_failed");
      expect(igB?.webhook_processing_status).toBe("completed");
      expect(igB?.ticket_closing_outbound_status).toBe("delivered");
      expect(igB?.email_purpose).toBe("instagram-ticket-confirmation");

      expect(wati?.candidate_rejection_reason).toBe("none");
      expect(wati?.ticket_code).toBeNull();
      expect(wati?.exact_ticket_candidate_count).toBe(1);
      expect(wati?.candidate_ticket_code).toBe("CF-2026-00009");
      expect(wati?.email_purpose).toBe("whatsapp-ticket-confirmation");
      expect(wati?.webhook_error_code).toBe("whatsapp_send_failed");

      expect(noneStructural?.channel).toBe("instagram");
      expect(noneStructural?.structural_active_ticket_count).toBe(0);
      expect(noneStructural?.inactive_exact_ticket_count).toBe(0);
      expect(noneStructural?.ticket_code).toBeNull();
      expect(noneStructural?.candidate_ticket_code).toBeNull();
      expect(noneStructural?.ticket_closing_outbound_status).toBeNull();
      expect(noneStructural?.email_purpose).toBeNull();
      expect(noneStructural?.webhook_error_code).not.toBe("instagram_send_failed");
      expect(noneStructural?.webhook_error_code).not.toBe("whatsapp_send_failed");

      expect(recipientConflict?.structural_active_ticket_count).toBe(1);
      expect(recipientConflict?.recipient_conflict_ticket_count).toBe(1);
      expect(recipientConflict?.exact_ticket_candidate_count).toBe(0);
      expect(recipientConflict?.candidate_ticket_code).toBeNull();
      expect(recipientConflict?.email_purpose).toBeNull();

      expect(keyMismatch?.structural_active_ticket_count).toBe(1);
      expect(keyMismatch?.conversation_key_mismatch_ticket_count).toBe(1);
      expect(keyMismatch?.unproven_identity_ticket_count).toBe(0);
      expect(keyMismatch?.exact_ticket_candidate_count).toBe(0);
      expect(keyMismatch?.candidate_ticket_code).toBeNull();

      expect(inactive?.structural_active_ticket_count).toBe(0);
      expect(inactive?.inactive_exact_ticket_count).toBe(1);
      expect(inactive?.exact_ticket_candidate_count).toBe(0);
      expect(inactive?.candidate_ticket_code).toBeNull();
      expect(inactive?.ticket_code).toBeNull();

      expect(multiple?.exact_ticket_candidate_count).toBe(2);
      expect(multiple?.structural_active_ticket_count).toBe(2);
      expect(multiple?.candidate_ticket_code).toBeNull();
      expect(multiple?.ticket_code).toBeNull();
      expect(multiple?.email_purpose).toBeNull();

      const fps = result.rows.map((row) => row.contact_fp);
      expect(new Set(fps).size).toBe(result.rows.length);

      const serialized = JSON.stringify(result.rows);
      for (const secret of [
        IGSID_A,
        IGSID_B,
        IGSID_D,
        IGSID_E,
        IGSID_F,
        IGSID_G,
        IGSID_H,
        WATI_SENDER,
        PAGE,
        PAGE_OTHER,
        TICKET_B,
        TICKET_W,
        TICKET_E,
        TICKET_F,
        TICKET_G,
        TICKET_H1,
        TICKET_H2,
        MID_A,
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).not.toContain("@");
      expect(serialized).not.toContain("Raise ticket");
    },
  );
});
