"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import PhoneInput from "@/components/ui/PhoneInput";
import { ISSUE_TYPES } from "@/lib/ticket-constants";
import { PHONE_VALIDATION_MESSAGE, isValidPhoneNumber } from "@/lib/phone";
import type { NewTicketFormData, Platform } from "@/lib/types";
import type { StaffOption } from "@/lib/tickets/workflow-types";

const fieldInputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70";

type FormErrors = Partial<Record<keyof NewTicketFormData, string>>;

type CreateTicketResult = { ok: true } | { ok: false; message: string };

interface NewTicketModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: NewTicketFormData) => Promise<CreateTicketResult>;
  defaultSendAcknowledgementEmail?: boolean;
  staffOptions: StaffOption[];
}

function validate(form: NewTicketFormData): FormErrors {
  const errors: FormErrors = {};

  if (!form.issueType) errors.issueType = "Issue type is required.";
  if (!form.creatorName.trim()) errors.creatorName = "Creator name is required.";
  if (!form.phone.trim()) {
    errors.phone = "Phone number is required.";
  } else if (!isValidPhoneNumber(form.phone)) {
    errors.phone = PHONE_VALIDATION_MESSAGE;
  }
  if (!form.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!form.socialHandle.trim()) {
    errors.socialHandle = "Social media handle is required.";
  }
  if (!form.campaignName.trim()) {
    errors.campaignName = "Campaign name is required.";
  }
  if (!form.brand.trim()) errors.brand = "Brand name is required.";
  if (!form.campaignMonth.trim()) {
    errors.campaignMonth = "Campaign month is required.";
  }
  if (!form.cloutflowPoc.trim()) {
    errors.cloutflowPoc = "Cloutflow POC is required.";
  }
  if (!form.cloutflowPocContactNumber.trim()) {
    errors.cloutflowPocContactNumber =
      "Cloutflow POC contact number is required.";
  } else if (!isValidPhoneNumber(form.cloutflowPocContactNumber)) {
    errors.cloutflowPocContactNumber = PHONE_VALIDATION_MESSAGE;
  }
  if (!form.issueDescription.trim()) {
    errors.issueDescription = "Issue description is required.";
  }
  if (!form.assignedExecutive) {
    errors.assignedExecutive = "Assigned executive is required.";
  }

  return errors;
}

export default function NewTicketModal({
  open,
  onClose,
  onCreate,
  defaultSendAcknowledgementEmail = true,
  staffOptions,
}: NewTicketModalProps) {
  if (!open) return null;

  return (
    <NewTicketModalForm
      onClose={onClose}
      onCreate={onCreate}
      defaultSendAcknowledgementEmail={defaultSendAcknowledgementEmail}
      staffOptions={staffOptions}
    />
  );
}

function NewTicketModalForm({
  onClose,
  onCreate,
  defaultSendAcknowledgementEmail,
  staffOptions,
}: {
  onClose: () => void;
  onCreate: (data: NewTicketFormData) => Promise<CreateTicketResult>;
  defaultSendAcknowledgementEmail: boolean;
  staffOptions: StaffOption[];
}) {
  const [form, setForm] = useState<NewTicketFormData>({
    source: "Phone Call",
    issueType: "",
    creatorName: "",
    phone: "",
    email: "",
    socialHandle: "",
    platform: "Instagram",
    campaignName: "",
    brand: "",
    campaignMonth: "",
    cloutflowPoc: "",
    cloutflowPocContactNumber: "",
    issueDescription: "",
    internalCallNotes: "",
    assignedExecutive: "",
    sendAcknowledgementEmail: defaultSendAcknowledgementEmail,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  function updateField<K extends keyof NewTicketFormData>(
    key: K,
    value: NewTicketFormData[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(form);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = await onCreate(form);
    if (!result.ok) {
      setSubmitError(result.message);
      setSubmitting(false);
      return;
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-3 py-6 sm:items-center sm:px-4">
      <button
        type="button"
        aria-label="Close modal overlay"
        className="absolute inset-0"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)]"
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2
            id="new-ticket-title"
            className="text-lg font-semibold text-foreground"
          >
            New Creator Ticket
          </h2>
          <p className="mt-1 text-sm text-muted">
            Log a phone inquiry into the unified inbox. Ticket numbers are
            generated by the database.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-6">
              <FormSection
                title="1. Inquiry"
                description="Capture the source and issue details."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    label="Source"
                    hint="Manual tickets are currently logged as phone calls."
                  >
                    <input
                      value="Phone Call"
                      readOnly
                      className={`${fieldInputClass} bg-surface-muted text-muted`}
                    />
                  </Field>
                  <Field label="Issue type" required error={errors.issueType}>
                    <select
                      value={form.issueType}
                      onChange={(e) => updateField("issueType", e.target.value)}
                      className={fieldInputClass}
                    >
                      <option value="">Select issue type</option>
                      {ISSUE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="md:col-span-2">
                    <Field
                      label="Issue description"
                      required
                      error={errors.issueDescription}
                    >
                      <textarea
                        value={form.issueDescription}
                        onChange={(e) =>
                          updateField("issueDescription", e.target.value)
                        }
                        className={`${fieldInputClass} min-h-24 resize-y`}
                        placeholder="Describe the creator issue"
                      />
                    </Field>
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="2. Creator"
                description="Identity and contact channels for follow-up."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    label="Creator name"
                    required
                    error={errors.creatorName}
                  >
                    <input
                      value={form.creatorName}
                      onChange={(e) =>
                        updateField("creatorName", e.target.value)
                      }
                      className={fieldInputClass}
                      placeholder="Full name"
                    />
                  </Field>
                  <Field label="Phone" required error={errors.phone}>
                    <PhoneInput
                      value={form.phone}
                      onChange={(value) => updateField("phone", value)}
                      invalid={Boolean(errors.phone)}
                      inputClassName={fieldInputClass}
                      selectClassName="w-[7.5rem] shrink-0 rounded-md border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70"
                    />
                  </Field>
                  <Field label="Email" required error={errors.email}>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => updateField("email", e.target.value)}
                      className={fieldInputClass}
                      placeholder="creator@email.com"
                    />
                  </Field>
                  <Field
                    label="Social handle"
                    required
                    error={errors.socialHandle}
                  >
                    <input
                      value={form.socialHandle}
                      onChange={(e) =>
                        updateField("socialHandle", e.target.value)
                      }
                      className={fieldInputClass}
                      placeholder="@handle"
                    />
                  </Field>
                  <Field label="Platform" required>
                    <select
                      value={form.platform}
                      onChange={(e) =>
                        updateField("platform", e.target.value as Platform)
                      }
                      className={fieldInputClass}
                    >
                      <option value="Instagram">Instagram</option>
                      <option value="YouTube">YouTube</option>
                    </select>
                  </Field>
                </div>
              </FormSection>

              <FormSection
                title="3. Campaign"
                description="Brand and campaign context for routing."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    label="Campaign name"
                    required
                    error={errors.campaignName}
                  >
                    <input
                      value={form.campaignName}
                      onChange={(e) =>
                        updateField("campaignName", e.target.value)
                      }
                      className={fieldInputClass}
                      placeholder="Campaign name"
                    />
                  </Field>
                  <Field label="Brand" required error={errors.brand}>
                    <input
                      value={form.brand}
                      onChange={(e) => updateField("brand", e.target.value)}
                      className={fieldInputClass}
                      placeholder="Brand name"
                    />
                  </Field>
                  <Field
                    label="Campaign month"
                    required
                    error={errors.campaignMonth}
                    hint='Examples: "August 2026" or "2026-08"'
                  >
                    <input
                      value={form.campaignMonth}
                      onChange={(e) =>
                        updateField("campaignMonth", e.target.value)
                      }
                      className={fieldInputClass}
                      placeholder="e.g. August 2026"
                    />
                  </Field>
                </div>
              </FormSection>

              <FormSection
                title="4. Cloutflow ownership"
                description="Internal ownership for follow-through."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field
                    label="POC name"
                    required
                    error={errors.cloutflowPoc}
                  >
                    <input
                      value={form.cloutflowPoc}
                      onChange={(e) =>
                        updateField("cloutflowPoc", e.target.value)
                      }
                      className={fieldInputClass}
                      placeholder="POC name"
                    />
                  </Field>
                  <Field
                    label="POC contact"
                    required
                    error={errors.cloutflowPocContactNumber}
                  >
                    <PhoneInput
                      value={form.cloutflowPocContactNumber}
                      onChange={(value) =>
                        updateField("cloutflowPocContactNumber", value)
                      }
                      invalid={Boolean(errors.cloutflowPocContactNumber)}
                      inputClassName={fieldInputClass}
                      selectClassName="w-[7.5rem] shrink-0 rounded-md border border-border bg-surface px-2 py-2 text-sm text-foreground outline-none transition focus:border-accent disabled:opacity-70"
                    />
                  </Field>
                  <Field
                    label="Assigned executive"
                    required
                    error={errors.assignedExecutive}
                  >
                    <select
                      value={form.assignedExecutive}
                      onChange={(e) =>
                        updateField("assignedExecutive", e.target.value)
                      }
                      className={fieldInputClass}
                    >
                      <option value="">Select executive</option>
                      {staffOptions.map((option) => (
                        <option key={option.userId} value={option.userId}>
                          {option.fullName}
                          {option.team ? ` · ${option.team}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Assigned team"
                    hint="Derived from the selected executive's staff profile."
                  >
                    <input
                      value={
                        staffOptions.find(
                          (option) => option.userId === form.assignedExecutive,
                        )?.team || "Creator Support"
                      }
                      readOnly
                      className={`${fieldInputClass} bg-surface-muted text-muted`}
                    />
                  </Field>
                </div>
              </FormSection>

              <FormSection
                title="5. Communication"
                description="Internal notes and acknowledgement preference."
              >
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Internal call notes">
                    <textarea
                      value={form.internalCallNotes}
                      onChange={(e) =>
                        updateField("internalCallNotes", e.target.value)
                      }
                      className={`${fieldInputClass} min-h-20 resize-y`}
                      placeholder="Optional notes from the call"
                    />
                  </Field>
                  <label className="flex items-start gap-3 rounded-md border border-border bg-surface-muted px-3 py-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={form.sendAcknowledgementEmail}
                      onChange={(e) =>
                        updateField(
                          "sendAcknowledgementEmail",
                          e.target.checked,
                        )
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>
                      Send acknowledgement email
                      <span className="mt-0.5 block text-xs text-muted">
                        When enabled, Cloutflow emails the creator after the
                        ticket is created (uses the creator email on this form).
                      </span>
                    </span>
                  </label>
                </div>
              </FormSection>
            </div>
          </div>

          <div className="sticky bottom-0 shrink-0 border-t border-border bg-surface px-5 py-4">
            {errorCount > 0 || submitError ? (
              <div
                role="alert"
                className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {submitError
                  ? submitError
                  : `Fix ${errorCount} required field${errorCount === 1 ? "" : "s"} before creating the ticket.`}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? "Creating..." : "Create Ticket"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-muted/40 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-foreground">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : null}
    </label>
  );
}
