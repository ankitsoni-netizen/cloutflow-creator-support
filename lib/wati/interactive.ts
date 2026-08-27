import type { InstagramQuickReply } from "@/lib/meta/conversation-machine";

/** Official WATI API v3 path for interactive session messages. */
export const WATI_V3_INTERACTIVE_PATH =
  "/api/ext/v3/conversations/messages/interactive";

export const WATI_INTERACTIVE_BODY_MAX = 1024;
export const WATI_BUTTON_TITLE_MAX = 20;
export const WATI_BUTTON_COUNT_MIN = 1;
export const WATI_BUTTON_COUNT_MAX = 3;
export const WATI_LIST_ROW_TITLE_MAX = 24;
export const WATI_LIST_ROW_COUNT_MIN = 1;
export const WATI_LIST_ROW_COUNT_MAX = 10;
export const WATI_LIST_SECTION_TITLE_MAX = 24;
export const WATI_LIST_BUTTON_TEXT = "Choose an option";
export const WATI_LIST_SECTION_TITLE = "Options";

export type WatiInteractiveKind = "buttons" | "list";

export type WatiInteractivePlan =
  | { ok: true; kind: WatiInteractiveKind; body: string; titles: string[] }
  | { ok: false; errorCode: string };

function trimmedTitle(value: string): string {
  return value.trim();
}

/**
 * Choose native WhatsApp buttons vs list from conversation-machine titles.
 * Never truncates an option — a title that cannot fit fails closed.
 */
export function planWatiInteractiveMessage(
  text: string,
  quickReplies: readonly Pick<InstagramQuickReply, "title">[],
): WatiInteractivePlan {
  const body = text.trim();
  if (!body) {
    return { ok: false, errorCode: "empty_message" };
  }
  if (body.length > WATI_INTERACTIVE_BODY_MAX) {
    return { ok: false, errorCode: "wati_interactive_body_too_long" };
  }

  const titles = quickReplies.map((reply) => trimmedTitle(reply.title));
  if (titles.length === 0) {
    return { ok: false, errorCode: "wati_interactive_missing_options" };
  }
  if (titles.some((title) => title.length === 0)) {
    return { ok: false, errorCode: "wati_interactive_empty_option" };
  }
  if (titles.length > WATI_LIST_ROW_COUNT_MAX) {
    return { ok: false, errorCode: "wati_interactive_too_many_options" };
  }
  if (titles.some((title) => title.length > WATI_LIST_ROW_TITLE_MAX)) {
    return { ok: false, errorCode: "wati_interactive_option_too_long" };
  }

  const fitsButtons =
    titles.length >= WATI_BUTTON_COUNT_MIN &&
    titles.length <= WATI_BUTTON_COUNT_MAX &&
    titles.every((title) => title.length <= WATI_BUTTON_TITLE_MAX);

  if (fitsButtons) {
    return { ok: true, kind: "buttons", body, titles };
  }

  if (
    titles.length >= WATI_LIST_ROW_COUNT_MIN &&
    titles.length <= WATI_LIST_ROW_COUNT_MAX
  ) {
    return { ok: true, kind: "list", body, titles };
  }

  return { ok: false, errorCode: "wati_interactive_unsupported" };
}

export function watiInteractiveRequestBody(
  target: string,
  plan: Extract<WatiInteractivePlan, { ok: true }>,
): Record<string, unknown> {
  if (plan.kind === "buttons") {
    return {
      target,
      type: "buttons",
      button_message: {
        body: plan.body,
        buttons: plan.titles.map((title) => ({ text: title })),
      },
    };
  }

  return {
    target,
    type: "list",
    list_message: {
      body: plan.body,
      button_text: WATI_LIST_BUTTON_TEXT,
      sections: [
        {
          title: WATI_LIST_SECTION_TITLE,
          rows: plan.titles.map((title) => ({ title })),
        },
      ],
    },
  };
}
