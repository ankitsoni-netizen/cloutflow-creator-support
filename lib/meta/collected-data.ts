export const COLLECTED_DATA_FIELDS = [
  "creatorName",
  "phone",
  "email",
  "socialHandle",
  "platform",
  "issueType",
  "campaignName",
  "brand",
  "campaignMonth",
  "cloutflowPocName",
  "cloutflowPocContactNumber",
  "issueDescription",
] as const;

export type CollectedDataField = (typeof COLLECTED_DATA_FIELDS)[number];

export type ChannelCollectedData = {
  creatorName: string | null;
  phone: string | null;
  email: string | null;
  socialHandle: string | null;
  platform: string | null;
  issueType: string | null;
  campaignName: string | null;
  brand: string | null;
  campaignMonth: string | null;
  cloutflowPocName: string | null;
  cloutflowPocContactNumber: string | null;
  issueDescription: string | null;
};

export function emptyCollectedData(
  overrides: Partial<ChannelCollectedData> = {},
): ChannelCollectedData {
  return {
    creatorName: null,
    phone: null,
    email: null,
    socialHandle: null,
    platform: null,
    issueType: null,
    campaignName: null,
    brand: null,
    campaignMonth: null,
    cloutflowPocName: null,
    cloutflowPocContactNumber: null,
    issueDescription: null,
    ...overrides,
  };
}

export function incompleteCollectedFields(
  data: ChannelCollectedData,
): CollectedDataField[] {
  return COLLECTED_DATA_FIELDS.filter((field) => {
    const value = data[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function isChannelCollectedData(
  value: unknown,
): value is ChannelCollectedData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return COLLECTED_DATA_FIELDS.every((field) => {
    const entry = record[field];
    return entry === null || typeof entry === "string" || entry === undefined;
  });
}
