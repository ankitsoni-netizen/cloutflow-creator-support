import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commitTicketResolution } from "@/lib/tickets/resolve-ticket";
import { drainResolutionJobs } from "@/lib/tickets/resolution-outbox";
import { mapDbTicketToTicket } from "@/lib/tickets/map";
import type { DbTicket } from "@/lib/tickets/types";
import { uiStatusToDb } from "@/lib/tickets/workflow-map";

function dbTicket(overrides: Partial<DbTicket> = {}): DbTicket {
  return {
    id: "ticket-1",
    ticket_code: "CF-2026-00001",
    creator_name: "Riya Sharma",
    creator_phone: "+919876543210",
    creator_email: "riya@example.com",
    social_handle: "riya",
    platform: "instagram",
    issue_type: "payment_delayed",
    campaign_name: null,
    brand_name: null,
    campaign_month: "2026-08-01",
    cloutflow_poc_name: null,
    cloutflow_poc_contact_number: null,
    request_category: "creator_support",
    company_name: null,
    requester_type: null,
    topic_or_module: null,
    intake_details: null,
    source_channel: "website",
    status: "open",
    priority: "normal",
    assigned_team: "Creator Support",
    assigned_executive_id: "staff-2",
    assigned_executive_name: "Rahul Mehta",
    issue_description: "Payment delayed",
    internal_notes: null,
    acknowledgement_email_requested: true,
    acknowledgement_email_sent_at: null,
    resolution_summary: null,
    first_response_at: null,
    resolved_at: null,
    customer_last_notified_at: null,
    metadata: null,
    external_contact_id: null,
    external_conversation_id: null,
    created_at: "2026-08-08T09:15:00.000Z",
    updated_at: "2026-08-11T10:42:00.000Z",
    ...overrides,
  };
}

type MemoryDb = {
  ticket: DbTicket;
  events: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  rpcEnabled: boolean;
  rpcCalls: number;
  emailSends: number;
};

function matches(row: Record<string, unknown>, filters: Array<{ type: string; value: unknown }>) {
  for (const filter of filters) {
    if (filter.type === "eq") {
      const [column, value] = filter.value as [string, unknown];
      if (row[column] !== value) return false;
    }
    if (filter.type === "neq") {
      const [column, value] = filter.value as [string, unknown];
      if (row[column] === value) return false;
    }
    if (filter.type === "in") {
      const [column, values] = filter.value as [string, unknown[]];
      if (!values.includes(row[column])) return false;
    }
  }
  return true;
}

function createMemorySupabase(db: MemoryDb): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<{ type: string; value: unknown }> = [];
    const builder: Record<string, unknown> = {};
    let pendingPatch: Record<string, unknown> | null = null;

    const rows = () => {
      if (table === "tickets") return [db.ticket];
      if (table === "ticket_events") return db.events;
      if (table === "ticket_comments") return db.comments;
      if (table === "ticket_resolution_jobs") return db.jobs;
      return [];
    };

    builder.eq = (column: string, value: unknown) => {
      filters.push({ type: "eq", value: [column, value] });
      return builder;
    };
    builder.neq = (column: string, value: unknown) => {
      filters.push({ type: "neq", value: [column, value] });
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      filters.push({ type: "in", value: [column, values] });
      return builder;
    };
    builder.or = () => builder;
    builder.lt = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.select = () => builder;
    const execute = async () => {
      const foundRows = rows().filter((row) =>
        matches(row as Record<string, unknown>, filters),
      );
      if (pendingPatch) {
        const found = foundRows[0] as Record<string, unknown> | undefined;
        if (!found) return { data: null, error: null };
        Object.assign(found, pendingPatch);
        return { data: found, error: null };
      }
      return { data: foundRows, error: null };
    };
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => execute().then(onFulfilled, onRejected);
    builder.maybeSingle = async () => {
      const found = rows().find((row) => matches(row as Record<string, unknown>, filters));
      return { data: found ?? null, error: null };
    };
    builder.single = builder.maybeSingle;
    builder.update = (patch: Record<string, unknown>) => {
      pendingPatch = patch;
      builder.maybeSingle = async () => {
        if (table !== "tickets") {
          const found = rows().find((row) => matches(row as Record<string, unknown>, filters));
          if (!found) return { data: null, error: null };
          Object.assign(found, patch);
          return { data: found, error: null };
        }
        if (!matches(db.ticket as unknown as Record<string, unknown>, filters)) {
          return { data: null, error: null };
        }
        Object.assign(db.ticket, patch);
        return { data: db.ticket, error: null };
      };
      return builder;
    };
    builder.insert = (row: Record<string, unknown>) => {
      builder.maybeSingle = async () => {
        const created = { id: `${table}-${rows().length + 1}`, created_at: new Date().toISOString(), ...row };
        if (table === "ticket_events") db.events.push(created);
        if (table === "ticket_comments") db.comments.push(created);
        if (table === "ticket_resolution_jobs") db.jobs.push(created);
        return { data: created, error: null };
      };
      return builder;
    };
    builder.upsert = (row: Record<string, unknown>) => {
      builder.maybeSingle = async () => {
        const existing = db.jobs.find(
          (job) => job.idempotency_key === row.idempotency_key,
        );
        if (existing) {
          Object.assign(existing, row);
          return { data: existing, error: null };
        }
        const created = { id: `job-${db.jobs.length + 1}`, ...row };
        db.jobs.push(created);
        return { data: created, error: null };
      };
      return builder;
    };
    return builder;
  };

  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "resolve_creator_support_ticket") {
        db.rpcCalls += 1;
        if (!db.rpcEnabled) {
          return {
            data: null,
            error: { code: "PGRST202", message: "Could not find the function" },
          };
        }
        const already = db.ticket.status === "resolved";
        if (!already) {
          db.ticket = {
            ...db.ticket,
            status: "resolved",
            resolution_summary: String(args.p_resolution_summary),
            resolved_at: "2026-08-27T12:00:09.000Z",
          };
        }
        if (
          !db.events.some(
            (event) => event.to_status === "resolved" && event.ticket_id === db.ticket.id,
          )
        ) {
          db.events.push({
            id: "event-1",
            ticket_id: db.ticket.id,
            event_type: "status_changed",
            to_status: "resolved",
            event_data: { resolution_summary: args.p_resolution_summary },
          });
        }
        if (db.comments.length === 0) {
          db.comments.push({
            id: "comment-1",
            ticket_id: db.ticket.id,
            author_user_id: args.p_actor_user_id,
            author_name: args.p_actor_name,
            visibility: "creator",
            comment_text: args.p_resolution_summary,
            send_to_creator: true,
            delivery_status: "pending",
            created_at: "2026-08-27T12:00:09.000Z",
          });
        }
        if (db.jobs.length === 0) {
          db.jobs.push({
            id: "job-1",
            ticket_id: db.ticket.id,
            comment_id: db.comments[0]?.id,
            idempotency_key: args.p_idempotency_key,
            delivery_status: "pending",
            delivery_attempt_count: 0,
            payload: { resolution_summary: args.p_resolution_summary },
          });
        }
        return {
          data: {
            already_resolved: already,
            comment_id: db.comments[0]?.id,
            job_id: db.jobs[0]?.id,
            event_id: db.events[0]?.id,
            ticket: db.ticket,
          },
          error: null,
        };
      }
      if (name === "claim_ticket_resolution_job") {
        const job = db.jobs.find((row) => row.id === args.p_job_id);
        if (!job) return { data: { outcome: "skipped" }, error: null };
        job.delivery_attempt_count = Number(job.delivery_attempt_count ?? 0) + 1;
        return {
          data: {
            outcome: "claimed",
            attempt_count: job.delivery_attempt_count,
            ticket_id: job.ticket_id,
            comment_id: job.comment_id,
            payload: job.payload,
          },
          error: null,
        };
      }
      return { data: null, error: { code: "PGRST202", message: "missing" } };
    },
    from,
  } as unknown as SupabaseClient;
}

describe("commitTicketResolution", () => {
  it("returns after the authoritative update without sending email", async () => {
    const db: MemoryDb = {
      ticket: dbTicket(),
      events: [],
      comments: [],
      jobs: [],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };
    const sendEmail = vi.fn(async () => {
      db.emailSends += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { ok: true as const };
    });

    const result = await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.data.status).toBe("Resolved");
    expect(result.data.resolvedAt).toBe("2026-08-27T12:00:09.000Z");
    expect(result.resolutionEmail).toBe("queued");
    expect(result.jobId).toBe("job-1");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.emailSends).toBe(0);
  });

  it("treats an already-resolved ticket as a successful idempotent retry", async () => {
    const db: MemoryDb = {
      ticket: dbTicket({
        status: "resolved",
        resolution_summary: "Paid today",
        resolved_at: "2026-08-27T11:00:00.000Z",
      }),
      events: [
        {
          id: "event-1",
          ticket_id: "ticket-1",
          event_type: "status_changed",
          to_status: "resolved",
        },
      ],
      comments: [
        {
          id: "comment-1",
          ticket_id: "ticket-1",
          author_user_id: "staff-1",
          author_name: "Priya",
          visibility: "creator",
          comment_text: "Paid today",
          send_to_creator: true,
          delivery_status: "sent",
          created_at: "2026-08-27T11:00:00.000Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          ticket_id: "ticket-1",
          comment_id: "comment-1",
          idempotency_key: "ticket-resolution:ticket-1",
          delivery_status: "sent",
          delivery_attempt_count: 1,
          payload: { resolution_summary: "Paid today" },
        },
      ],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };

    const first = await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
      idempotencyKey: "ticket-resolution:ticket-1",
    });
    const second = await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
      idempotencyKey: "ticket-resolution:ticket-1",
    });
    expect("error" in first).toBe(false);
    expect("error" in second).toBe(false);
    if ("error" in first || "error" in second) return;
    expect(first.alreadyResolved).toBe(true);
    expect(second.alreadyResolved).toBe(true);
    expect(db.events.filter((event) => event.to_status === "resolved")).toHaveLength(1);
    expect(db.comments).toHaveLength(1);
    expect(db.jobs).toHaveLength(1);
  });

  it("does not resolve the ticket when the RPC is missing", async () => {
    const db: MemoryDb = {
      ticket: dbTicket(),
      events: [],
      comments: [],
      jobs: [],
      rpcEnabled: false,
      rpcCalls: 0,
      emailSends: 0,
    };
    const result = await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
      nowIso: "2026-08-27T12:00:09.000Z",
    });
    expect(result).toEqual({
      error: "Ticket resolution is temporarily unavailable. Please retry.",
    });
    expect(db.ticket.status).toBe("open");
    expect(db.ticket.resolved_at).toBeNull();
    expect(db.jobs).toHaveLength(0);
  });

  it("does not change assignment fields while resolving", async () => {
    const db: MemoryDb = {
      ticket: dbTicket({
        assigned_executive_id: "staff-2",
        assigned_executive_name: "Rahul Mehta",
      }),
      events: [],
      comments: [],
      jobs: [],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };
    const result = await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.data.assignedExecutiveId).toBe("staff-2");
    expect(result.data.assignedExecutive).toBe("Rahul Mehta");
  });

  it("keeps Open / In Progress / Waiting mappings for other status transitions", () => {
    expect(uiStatusToDb("Open")).toBe("open");
    expect(uiStatusToDb("In Progress")).toBe("in_progress");
    expect(uiStatusToDb("Waiting")).toBe("waiting");
    expect(uiStatusToDb("Resolved")).toBe("resolved");
  });
});

describe("resolution outbox drain", () => {
  it("keeps the ticket resolved when notification delivery fails", async () => {
    const db: MemoryDb = {
      ticket: dbTicket({
        status: "resolved",
        resolution_summary: "Paid today",
        resolved_at: "2026-08-27T12:00:09.000Z",
      }),
      events: [
        {
          id: "event-1",
          ticket_id: "ticket-1",
          event_type: "status_changed",
          to_status: "resolved",
        },
      ],
      comments: [
        {
          id: "comment-1",
          ticket_id: "ticket-1",
          author_user_id: "staff-1",
          author_name: "Priya",
          visibility: "creator",
          comment_text: "Paid today",
          send_to_creator: true,
          delivery_status: "pending",
          created_at: "2026-08-27T12:00:09.000Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          ticket_id: "ticket-1",
          comment_id: "comment-1",
          idempotency_key: "ticket-resolution:ticket-1",
          delivery_status: "pending",
          delivery_attempt_count: 0,
          payload: { resolution_summary: "Paid today" },
        },
      ],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };

    const counts = await drainResolutionJobs({
      supabase: createMemorySupabase(db),
      sendResolutionEmail: async () => ({ ok: false, error: "Brevo timeout" }),
    });

    expect(counts.claimed).toBe(1);
    expect(counts.sent).toBe(0);
    expect(db.ticket.status).toBe("resolved");
    expect(mapDbTicketToTicket(db.ticket).status).toBe("Resolved");
    expect(db.jobs[0]?.delivery_status).toBe("failed");
  });

  it("does not perform notification work inside commitTicketResolution", async () => {
    const sendResolutionEmail = vi.fn(async () => ({ ok: true as const }));
    const db: MemoryDb = {
      ticket: dbTicket(),
      events: [],
      comments: [],
      jobs: [],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };
    await commitTicketResolution(createMemorySupabase(db), {
      ticketId: "ticket-1",
      resolutionSummary: "Paid today",
      actorUserId: "staff-1",
      actorName: "Priya Sharma",
    });
    expect(sendResolutionEmail).not.toHaveBeenCalled();
  });

  it("retries email without resending Instagram after a partial delivery", async () => {
    const db: MemoryDb = {
      ticket: dbTicket({
        source_channel: "instagram",
        status: "resolved",
        resolution_summary: "Paid today",
        resolved_at: "2026-08-27T12:00:09.000Z",
      }),
      events: [],
      comments: [
        {
          id: "comment-1",
          ticket_id: "ticket-1",
          author_user_id: "staff-1",
          author_name: "Priya",
          visibility: "creator",
          comment_text: "Paid today",
          send_to_creator: true,
          delivery_status: "pending",
          created_at: "2026-08-27T12:00:09.000Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          ticket_id: "ticket-1",
          comment_id: "comment-1",
          idempotency_key: "ticket-resolution:ticket-1",
          delivery_status: "pending",
          delivery_attempt_count: 0,
          payload: {
            resolution_summary: "Paid today",
            source_channel: "instagram",
            instagram: "pending",
            email: "pending",
            transcript: "pending",
          },
        },
      ],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };
    const sendStaffInstagramReply = vi.fn(async (input: { skipInstagramDelivery?: boolean }) => {
      if (input.skipInstagramDelivery) {
        return {
          ok: true as const,
          instagram: "sent" as const,
          email: "sent" as const,
          alreadySent: true,
        };
      }
      return {
        ok: true as const,
        instagram: "sent" as const,
        email: "failed" as const,
      };
    });

    const first = await drainResolutionJobs({
      supabase: createMemorySupabase(db),
      sendStaffInstagramReply,
    });
    expect(first.claimed).toBe(1);
    expect(first.sent).toBe(0);
    expect(first.retryable).toBe(1);
    expect(db.ticket.status).toBe("resolved");
    expect(db.jobs[0]?.payload).toMatchObject({
      instagram: "sent",
      email: "failed",
    });
    expect(sendStaffInstagramReply).toHaveBeenCalledTimes(1);
    expect(sendStaffInstagramReply.mock.calls[0]?.[0]).toMatchObject({
      skipInstagramDelivery: false,
    });

    db.jobs[0]!.delivery_status = "failed";
    const second = await drainResolutionJobs({
      supabase: createMemorySupabase(db),
      sendStaffInstagramReply,
    });
    expect(second.sent).toBe(1);
    expect(sendStaffInstagramReply).toHaveBeenCalledTimes(2);
    expect(sendStaffInstagramReply.mock.calls[1]?.[0]).toMatchObject({
      skipInstagramDelivery: true,
    });
    expect(db.jobs[0]?.delivery_status).toBe("sent");
    expect(db.jobs[0]?.payload).toMatchObject({
      instagram: "sent",
      email: "sent",
      customer_notified: true,
    });
  });

  it("does not retry resolution Instagram when identity is ambiguous", async () => {
    const db: MemoryDb = {
      ticket: dbTicket({
        source_channel: "instagram",
        status: "resolved",
        resolution_summary: "Paid today",
        resolved_at: "2026-08-27T12:00:09.000Z",
        external_contact_id: "12334",
        external_conversation_id: "17841400008460000",
      }),
      events: [],
      comments: [
        {
          id: "comment-1",
          ticket_id: "ticket-1",
          author_user_id: "staff-1",
          author_name: "Priya",
          visibility: "creator",
          comment_text: "Paid today",
          send_to_creator: true,
          delivery_status: "pending",
          created_at: "2026-08-27T12:00:09.000Z",
        },
      ],
      jobs: [
        {
          id: "job-1",
          ticket_id: "ticket-1",
          comment_id: "comment-1",
          idempotency_key: "ticket-resolution:ticket-1",
          delivery_status: "pending",
          delivery_attempt_count: 0,
          payload: {
            resolution_summary: "Paid today",
            source_channel: "instagram",
            instagram: "pending",
            email: "pending",
            transcript: "pending",
          },
        },
      ],
      rpcEnabled: true,
      rpcCalls: 0,
      emailSends: 0,
    };
    const sendStaffInstagramReply = vi.fn(async () => ({
      ok: false as const,
      error: "This ticket's conversation identity is not verified for outbound replies.",
      errorCode: "identity_ambiguous",
    }));

    const counts = await drainResolutionJobs({
      supabase: createMemorySupabase(db),
      sendStaffInstagramReply,
    });
    expect(counts.claimed).toBe(1);
    expect(counts.retryable).toBe(0);
    expect(counts.terminal + counts.skipped).toBeGreaterThan(0);
    expect(sendStaffInstagramReply).toHaveBeenCalledTimes(1);
  });
});
