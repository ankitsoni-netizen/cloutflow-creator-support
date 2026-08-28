import { describe, expect, it } from "vitest";
import {
  parseCampaignMonthForDb,
  parseCampaignMonthInput,
} from "@/lib/tickets/campaign-month";

const NOW = new Date("2026-08-28T06:20:00.000Z");

describe("parseCampaignMonthInput", () => {
  it.each([
    ["June", "2026-06-01", true],
    ["Jun", "2026-06-01", true],
    ["Jue", "2026-06-01", true],
    ["June 2026", "2026-06-01", false],
    ["Jun 2026", "2026-06-01", false],
    ["June 26", "2026-06-01", false],
    ["June ’26", "2026-06-01", false],
    ["June '26", "2026-06-01", false],
    ["13th June 2026", "2026-06-01", false],
    ["13 June 26", "2026-06-01", false],
    ["13 Jun 26", "2026-06-01", false],
    ["13/06/2026", "2026-06-01", false],
    ["06/2026", "2026-06-01", false],
    ["jue 2026", "2026-06-01", false],
    ["JUNE", "2026-06-01", true],
    ["june", "2026-06-01", true],
  ] as const)("parses %s", (input, iso, yearInferred) => {
    const parsed = parseCampaignMonthInput(input, NOW);
    expect(parsed).toMatchObject({ iso, yearInferred });
    expect(parseCampaignMonthForDb(input, NOW)).toBe(iso);
  });

  it("infers the most recent non-future year for month-only input", () => {
    expect(parseCampaignMonthInput("December", NOW)).toMatchObject({
      iso: "2025-12-01",
      yearInferred: true,
    });
    expect(parseCampaignMonthInput("August", NOW)).toMatchObject({
      iso: "2026-08-01",
      yearInferred: true,
    });
    expect(parseCampaignMonthInput("September", NOW)).toMatchObject({
      iso: "2025-09-01",
      yearInferred: true,
    });
  });

  it("infers month-only years across year boundaries from the injected date", () => {
    const earlyJanuary = new Date("2026-01-05T12:00:00.000Z");
    expect(parseCampaignMonthInput("January", earlyJanuary)).toMatchObject({
      iso: "2026-01-01",
      yearInferred: true,
    });
    expect(parseCampaignMonthInput("December", earlyJanuary)).toMatchObject({
      iso: "2025-12-01",
      yearInferred: true,
    });
    expect(parseCampaignMonthInput("February", earlyJanuary)).toMatchObject({
      iso: "2025-02-01",
      yearInferred: true,
    });

    const lateDecember = new Date("2026-12-31T23:00:00.000Z");
    expect(parseCampaignMonthInput("December", lateDecember)).toMatchObject({
      iso: "2026-12-01",
      yearInferred: true,
    });
    expect(parseCampaignMonthInput("January", lateDecember)).toMatchObject({
      iso: "2026-01-01",
      yearInferred: true,
    });
  });

  it("accepts unambiguous numeric dates and leap days", () => {
    expect(parseCampaignMonthForDb("06/13/2026", NOW)).toBe("2026-06-01");
    expect(parseCampaignMonthForDb("06/06/2026", NOW)).toBe("2026-06-01");
    expect(parseCampaignMonthForDb("29 February 2024", NOW)).toBe("2024-02-01");
  });

  it("fails safely on invalid or ambiguous months", () => {
    expect(parseCampaignMonthInput("soon", NOW)).toBeNull();
    expect(parseCampaignMonthInput("June or July", NOW)).toBeNull();
    expect(parseCampaignMonthInput("13/13/2026", NOW)).toBeNull();
    expect(parseCampaignMonthInput("05/06/2026", NOW)).toBeNull();
    expect(parseCampaignMonthInput("31/04/2026", NOW)).toBeNull();
    expect(parseCampaignMonthInput("32 June 2026", NOW)).toBeNull();
    expect(parseCampaignMonthInput("29 February 2025", NOW)).toBeNull();
    expect(parseCampaignMonthInput("June 1999", NOW)).toBeNull();
    expect(parseCampaignMonthInput("June 99", NOW)).toBeNull();
    expect(parseCampaignMonthInput("June 2099", NOW)).toBeNull();
    expect(parseCampaignMonthInput("maybe later", NOW)).toBeNull();
    expect(parseCampaignMonthInput("", NOW)).toBeNull();
    expect(parseCampaignMonthInput("campaign", NOW)).toBeNull();
  });

  it("does not treat unrelated short words as months", () => {
    expect(parseCampaignMonthInput("hi", NOW)).toBeNull();
    expect(parseCampaignMonthInput("yes", NOW)).toBeNull();
    expect(parseCampaignMonthInput("Acme", NOW)).toBeNull();
  });
});
