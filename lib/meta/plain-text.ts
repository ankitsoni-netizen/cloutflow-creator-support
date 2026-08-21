const TAG_PATTERN = /<[^>]*>/g;
const MAX_DESCRIPTION_CHARS = 5000;

/**
 * Turns inbound chat text into a ticket description.
 * Does not treat the input as trusted HTML.
 */
export function toPlainTicketDescription(value: string): string {
  const withoutTags = value.replace(TAG_PATTERN, " ");
  const collapsed = withoutTags.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_DESCRIPTION_CHARS) return collapsed;
  return collapsed.slice(0, MAX_DESCRIPTION_CHARS);
}
