import "server-only";

export type EmailFailureKind =
  | "configuration"
  | "validation"
  | "authentication"
  | "connection"
  | "send";

export interface SendTransactionalEmailInput {
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Safe custom headers only (for example X-Cloutflow-*). Never pass secrets. */
  headers?: Record<string, string>;
  /** Safe non-secret key/value pairs applied as X-Cloutflow-Meta-* headers. */
  metadata?: Record<string, string>;
}

export interface SendTransactionalEmailResult {
  /** Nodemailer / Brevo message identifier when available. */
  messageId: string | null;
  accepted: string[];
  rejected: string[];
  /**
   * SMTP acceptance only — not proof of inbox delivery.
   */
  status: "accepted_by_brevo";
}

export class EmailServiceError extends Error {
  readonly kind: EmailFailureKind;

  constructor(kind: EmailFailureKind, message: string) {
    super(message);
    this.name = "EmailServiceError";
    this.kind = kind;
  }
}
