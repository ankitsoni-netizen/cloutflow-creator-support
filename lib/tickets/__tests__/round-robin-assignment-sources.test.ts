import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mapIntakeToInstagramTicketInsert } from "@/lib/meta/instagram-ticket";
import { emptyIntakeCollected } from "@/lib/meta/intake-validate";
import { createSupabaseInstagramStore } from "@/lib/meta/instagram-store";
import { mapWebsiteFormToDbInsert } from "@/lib/public-intake/map";
import { createWebsiteTicketFromValidatedInput } from "@/lib/public-intake/create-website-ticket";
import { mapFormToDbInsert } from "@/lib/tickets/map";
import type { NewTicketFormData } from "@/lib/types";
import type { ValidatedWebsiteTicketInput } from "@/lib/public-intake/validate";
import { readRoundRobinMigrationSql } from "@/lib/tickets/__tests__/round-robin-assignment-sql";
import type { SupabaseClient } from "@supabase/supabase-js";

const websiteInput: ValidatedWebsiteTicketInput = {
  category: "creator_support",
  name: "Riya Sharma",
  phone: "+919876543210",
  email: "riya@example.com",
  socialHandle: "@riya",
  platform: "Instagram",
  issueType: "Payment Delayed / Not Received",
  campaignName: "Summer Launch",
  brandName: "Acme",
  campaignMonth: "August 2026",
  cloutflowPocName: "Priya Sharma",
  cloutflowPocContactNumber: "+919876543210",
  message: "Payment pending",
};

const crmForm: NewTicketFormData = {
  source: "Phone Call",
  creatorName: "Riya Sharma",
  phone: "+919876543210",
  email: "riya@example.com",
  socialHandle: "@riya",
  platform: "Instagram",
  issueType: "Payment Delayed / Not Received",
  campaignName: "Summer Launch",
  brand: "Acme",
  campaignMonth: "August 2026",
  cloutflowPoc: "Priya Sharma",
  cloutflowPocContactNumber: "+919876543210",
  issueDescription: "Payment pending",
  assignedExecutive: "",
  internalCallNotes: "",
  sendAcknowledgementEmail: false,
};

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, "../../..", relativePath), "utf8");
}

describe("ticket sources share the database round-robin primitive", () => {
  it("keeps Instagram insert payloads unassigned so the INSERT trigger assigns", () => {
    const insert = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        creatorName: "Riya Sharma",
        email: "riya@example.com",
      }),
      externalContactId: "12334",
      externalConversationId: "12334",
    });
    expect(insert.assigned_team).toBe("Creator Support");
    expect(insert.assigned_executive_id).toBeNull();
    expect(insert.assigned_executive_name).toBeNull();
    expect(insert.source_channel).toBe("instagram");
  });

  it("keeps WATI / Meta WhatsApp insert payloads unassigned so the INSERT trigger assigns", () => {
    const insert = mapIntakeToInstagramTicketInsert({
      collected: emptyIntakeCollected({
        creatorName: "Riya Sharma",
        email: "riya@example.com",
      }),
      externalContactId: "16315551181",
      externalConversationId: "123456123:16315551181",
      sourceChannel: "whatsapp",
    });
    expect(insert.assigned_team).toBe("Creator Support");
    expect(insert.assigned_executive_id).toBeNull();
    expect(insert.assigned_executive_name).toBeNull();
    expect(insert.source_channel).toBe("whatsapp");
  });

  it("keeps website and public WhatsApp intake payloads unassigned so the INSERT trigger assigns", () => {
    const website = mapWebsiteFormToDbInsert(websiteInput);
    expect("insert" in website).toBe(true);
    if (!("insert" in website)) return;
    expect(website.insert.assigned_team).toBe("Creator Support");
    expect(website.insert.assigned_executive_id).toBeNull();
    expect(website.insert.assigned_executive_name).toBeNull();
    expect(website.insert.source_channel).toBe("website");

    const whatsapp = mapWebsiteFormToDbInsert(websiteInput, "whatsapp");
    expect("insert" in whatsapp).toBe(true);
    if (!("insert" in whatsapp)) return;
    expect(whatsapp.insert.source_channel).toBe("whatsapp");
    expect(whatsapp.insert.assigned_executive_id).toBeNull();
  });

  it("preserves an explicit CRM assignment and leaves null CRM assignment for the INSERT trigger", () => {
    const preassigned = mapFormToDbInsert(crmForm, {
      assignedTeam: "Creator Support",
      assignedExecutiveId: "00000000-0000-0000-0000-000000000001",
    });
    expect("insert" in preassigned).toBe(true);
    if (!("insert" in preassigned)) return;
    expect(preassigned.insert.source_channel).toBe("phone_call");
    expect(preassigned.insert.assigned_executive_id).toBe(
      "00000000-0000-0000-0000-000000000001",
    );

    const unassigned = mapFormToDbInsert(crmForm, {
      assignedTeam: "Creator Support",
      assignedExecutiveId: null,
    });
    expect("insert" in unassigned).toBe(true);
    if (!("insert" in unassigned)) return;
    expect(unassigned.insert.assigned_executive_id).toBeNull();
  });

  it("creates website tickets with a single tickets insert and no assignment RPC", async () => {
    const calls: string[] = [];
    const supabase = {
      rpc: vi.fn(async () => {
        calls.push("rpc");
        return { data: null, error: null };
      }),
      from(table: string) {
        calls.push(`from:${table}`);
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: "ticket-1",
                  ticket_code: "CF-2026-00001",
                  assigned_team: "Creator Support",
                  assigned_executive_id: "00000000-0000-0000-0000-000000000001",
                  assigned_executive_name: "Riya Sharma",
                  source_channel: "website",
                  status: "open",
                  creator_name: "Riya Sharma",
                  creator_email: "riya@example.com",
                },
                error: null,
              })),
            })),
          })),
        };
      },
    };

    const result = await createWebsiteTicketFromValidatedInput(websiteInput, {
      supabase: supabase as unknown as SupabaseClient,
      sendAcknowledgement: async () => ({ outcome: "skipped" }),
      sendInternalNotification: async () => ({ outcome: "skipped" }),
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["from:tickets"]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("inserts Instagram tickets with a single tickets insert and no assignment RPC", async () => {
    const calls: string[] = [];
    const supabase = {
      rpc: vi.fn(async () => {
        calls.push("rpc");
        return { data: null, error: null };
      }),
      from(table: string) {
        calls.push(`from:${table}`);
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: "ticket-1", ticket_code: "CF-2026-00001" },
                error: null,
              })),
            })),
          })),
        };
      },
    };
    const store = createSupabaseInstagramStore(
      supabase as unknown as SupabaseClient,
    );
    const inserted = await store.insertInstagramTicket(
      mapIntakeToInstagramTicketInsert({
        collected: emptyIntakeCollected({
          creatorName: "Riya Sharma",
          email: "riya@example.com",
        }),
        externalContactId: "12334",
        externalConversationId: "12334",
      }),
    );
    expect(inserted).toMatchObject({ outcome: "inserted", id: "ticket-1" });
    expect(calls).toEqual(["from:tickets"]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("routes WATI / Meta WhatsApp ticket creation through insertInstagramTicket", () => {
    const effects = readSource("lib/meta/instagram-effects.ts");
    expect(effects).toContain(
      'return applyInstagramEffects({ ...options, channel: "whatsapp" })',
    );
    expect(effects).toContain("insertInstagramTicket(");
    expect(effects).toContain("mapIntakeToInstagramTicketInsert(");

    const wati = readSource("lib/wati/webhook.ts");
    expect(wati).toContain("ingestWhatsAppInboundMessage");
    expect(wati).not.toMatch(/assigned_executive_id/);

    const whatsappIngest = readSource("lib/meta/whatsapp-ingest.ts");
    expect(whatsappIngest).toContain("applyWhatsAppEffects");
    expect(whatsappIngest).not.toMatch(/assigned_executive_id/);
  });

  it("does not implement client-side or per-channel round robin in ticket handlers", () => {
    const sql = readRoundRobinMigrationSql();
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("ticket_assignment_cursors");
    expect(sql).toContain("assign_creator_support_ticket_round_robin");
    expect(sql).not.toMatch(/UPDATE public\.tickets/i);

    const handlerFiles = [
      "lib/meta/instagram-store.ts",
      "lib/meta/instagram-effects.ts",
      "lib/meta/instagram-ingest.ts",
      "lib/meta/whatsapp-ingest.ts",
      "lib/wati/webhook.ts",
      "lib/public-intake/create-website-ticket.ts",
      "lib/public-intake/whatsapp-intake.ts",
      "lib/tickets/actions.ts",
    ];
    for (const file of handlerFiles) {
      const source = readSource(file);
      expect(source).not.toMatch(/ticket_assignment_cursors/);
      expect(source).not.toMatch(/roundRobin|round_robin|lastAssignedExecutive/i);
      expect(source).not.toMatch(/Math\.random/);
    }

    const createTicketAction = readSource("lib/tickets/actions.ts");
    expect(createTicketAction).toContain('.from("tickets")');
    expect(createTicketAction).toContain(".insert(mapped.insert)");
    expect(createTicketAction).not.toMatch(/\.rpc\(/);
  });
});
