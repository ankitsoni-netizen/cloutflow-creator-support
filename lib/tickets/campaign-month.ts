export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_LOOKUP: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  jue: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const MONTH_TOKEN_PATTERN = Object.keys(MONTH_LOOKUP)
  .sort((left, right) => right.length - left.length)
  .join("|");

const NAMED_MONTH_PATTERN = new RegExp(
  `(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?\\b(${MONTH_TOKEN_PATTERN})\\b(?:\\s*,?\\s*'?(\\d{4}|\\d{2}))?`,
  "ig",
);

const ISO_PATTERN = /\b(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\b/g;
const SLASH_FULL_PATTERN = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/g;
const SLASH_MONTH_YEAR_PATTERN = /\b(\d{1,2})[/-](\d{4})\b/g;

export type CampaignMonthParse = {
  iso: string;
  monthIndex: number;
  year: number;
  yearInferred: boolean;
  matched: string;
};

type MonthCandidate = CampaignMonthParse & {
  start: number;
  end: number;
};

function toIso(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

function expandYear(raw: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (raw.length === 2) return 2000 + value;
  if (value < 1000 || value > 9999) return null;
  return value;
}

function mostRecentNonFutureYear(monthIndex: number, now: Date): number {
  const year = now.getUTCFullYear();
  return monthIndex > now.getUTCMonth() ? year - 1 : year;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function yearAllowed(year: number, now: Date): boolean {
  const currentYear = now.getUTCFullYear();
  return year >= 2000 && year <= currentYear + 10;
}

function dayAllowed(
  day: number | null,
  year: number,
  monthIndex: number,
): boolean {
  if (day === null) return true;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= daysInMonth(year, monthIndex);
}

function lookupMonthToken(token: string): number | undefined {
  return MONTH_LOOKUP[token.trim().toLowerCase()];
}

function overlaps(
  candidate: Pick<MonthCandidate, "start" | "end">,
  occupied: Array<Pick<MonthCandidate, "start" | "end">>,
): boolean {
  return occupied.some(
    (span) => candidate.start < span.end && candidate.end > span.start,
  );
}

function pushNamedMatches(text: string, now: Date, matches: MonthCandidate[]): void {
  NAMED_MONTH_PATTERN.lastIndex = 0;
  let match = NAMED_MONTH_PATTERN.exec(text);
  while (match) {
    const token = match[2] ?? "";
    const monthIndex = lookupMonthToken(token);
    if (monthIndex !== undefined) {
      const yearRaw = match[3];
      const year = yearRaw
        ? expandYear(yearRaw)
        : mostRecentNonFutureYear(monthIndex, now);
      const day = match[1] ? Number(match[1]) : null;
      if (
        year !== null &&
        yearAllowed(year, now) &&
        dayAllowed(Number.isFinite(day) ? day : null, year, monthIndex)
      ) {
        matches.push({
          iso: toIso(year, monthIndex),
          monthIndex,
          year,
          yearInferred: !yearRaw,
          matched: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
    match = NAMED_MONTH_PATTERN.exec(text);
  }
}

function pushIsoMatches(text: string, now: Date, matches: MonthCandidate[]): void {
  ISO_PATTERN.lastIndex = 0;
  let match = ISO_PATTERN.exec(text);
  while (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : null;
    if (
      month >= 1 &&
      month <= 12 &&
      Number.isFinite(year) &&
      yearAllowed(year, now) &&
      dayAllowed(Number.isFinite(day) ? day : null, year, month - 1)
    ) {
      const monthIndex = month - 1;
      matches.push({
        iso: toIso(year, monthIndex),
        monthIndex,
        year,
        yearInferred: false,
        matched: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    match = ISO_PATTERN.exec(text);
  }
}

function pushSlashFullMatches(
  text: string,
  now: Date,
  matches: MonthCandidate[],
  blocked: Array<Pick<MonthCandidate, "start" | "end">>,
): void {
  SLASH_FULL_PATTERN.lastIndex = 0;
  let match = SLASH_FULL_PATTERN.exec(text);
  while (match) {
    blocked.push({
      start: match.index,
      end: match.index + match[0].length,
    });
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = expandYear(match[3] ?? "");
    if (year === null || !yearAllowed(year, now)) {
      match = SLASH_FULL_PATTERN.exec(text);
      continue;
    }

    const asDayMonth =
      first >= 1 && first <= 31 && second >= 1 && second <= 12
        ? { month: second, day: first }
        : null;
    const asMonthDay =
      first >= 1 && first <= 12 && second >= 1 && second <= 31
        ? { month: first, day: second }
        : null;
    const dayMonthValid =
      asDayMonth &&
      dayAllowed(asDayMonth.day, year, asDayMonth.month - 1)
        ? asDayMonth
        : null;
    const monthDayValid =
      asMonthDay &&
      dayAllowed(asMonthDay.day, year, asMonthDay.month - 1)
        ? asMonthDay
        : null;

    let chosen: { month: number; day: number } | null = null;
    if (dayMonthValid && monthDayValid) {
      if (dayMonthValid.month === monthDayValid.month) {
        chosen = dayMonthValid;
      }
    } else {
      chosen = dayMonthValid ?? monthDayValid;
    }

    if (chosen) {
      const monthIndex = chosen.month - 1;
      matches.push({
        iso: toIso(year, monthIndex),
        monthIndex,
        year,
        yearInferred: false,
        matched: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    match = SLASH_FULL_PATTERN.exec(text);
  }
}

function pushSlashMonthYearMatches(
  text: string,
  now: Date,
  matches: MonthCandidate[],
  blocked: Array<Pick<MonthCandidate, "start" | "end">>,
): void {
  SLASH_MONTH_YEAR_PATTERN.lastIndex = 0;
  let match = SLASH_MONTH_YEAR_PATTERN.exec(text);
  while (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    const candidate = {
      start: match.index,
      end: match.index + match[0].length,
    };
    if (
      month >= 1 &&
      month <= 12 &&
      Number.isFinite(year) &&
      yearAllowed(year, now) &&
      !overlaps(candidate, matches) &&
      !overlaps(candidate, blocked)
    ) {
      const monthIndex = month - 1;
      matches.push({
        iso: toIso(year, monthIndex),
        monthIndex,
        year,
        yearInferred: false,
        matched: match[0],
        start: candidate.start,
        end: candidate.end,
      });
    }
    match = SLASH_MONTH_YEAR_PATTERN.exec(text);
  }
}

function resolveCandidates(matches: MonthCandidate[]): CampaignMonthParse | null {
  if (matches.length === 0) return null;
  const unique = new Map<string, MonthCandidate>();
  for (const match of matches) {
    unique.set(match.iso, match);
  }
  if (unique.size !== 1) return null;
  const chosen =
    matches.find((match) => !match.yearInferred) ?? matches[0];
  if (!chosen) return null;
  return {
    iso: chosen.iso,
    monthIndex: chosen.monthIndex,
    year: chosen.year,
    yearInferred: matches.every((match) => match.yearInferred),
    matched: chosen.matched,
  };
}

export function parseCampaignMonthInput(
  input: string,
  now: Date = new Date(),
): CampaignMonthParse | null {
  const text = input.trim().replace(/[’‘`]/g, "'");
  if (!text) return null;

  const matches: MonthCandidate[] = [];
  const blocked: Array<Pick<MonthCandidate, "start" | "end">> = [];
  pushIsoMatches(text, now, matches);
  pushSlashFullMatches(text, now, matches, blocked);
  pushSlashMonthYearMatches(text, now, matches, blocked);
  pushNamedMatches(text, now, matches);
  return resolveCandidates(matches);
}

export function parseCampaignMonthForDb(
  input: string,
  now: Date = new Date(),
): string | null {
  return parseCampaignMonthInput(input, now)?.iso ?? null;
}

export function formatCampaignMonthNameYear(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (!match) return iso;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex >= MONTH_NAMES.length) return iso;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}
