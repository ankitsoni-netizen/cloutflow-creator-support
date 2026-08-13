"use client";

import PhoneInput from "@/components/ui/PhoneInput";
import { isValidEmailAddress } from "@/lib/email/html";
import { PHONE_VALIDATION_MESSAGE, isValidPhoneNumber } from "@/lib/phone";
import {
  WEBSITE_CATEGORY_LABELS,
  WEBSITE_HONEYPOT_FIELDS,
  WEBSITE_ISSUE_TYPES,
  WEBSITE_PLATFORMS,
  WEBSITE_REQUEST_CATEGORIES,
  WEBSITE_REQUESTER_TYPES,
  type WebsiteIssueTypeLabel,
  type WebsitePlatformLabel,
  type WebsiteRequestCategory,
  type WebsiteRequesterType,
} from "@/lib/public-intake/constants";
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type FormState = {
  category: WebsiteRequestCategory;
  name: string;
  email: string;
  message: string;
  phone: string;
  socialHandle: string;
  platform: WebsitePlatformLabel | "";
  issueType: WebsiteIssueTypeLabel | "";
  campaignName: string;
  brandName: string;
  campaignMonth: string;
  cloutflowPocName: string;
  cloutflowPocContactNumber: string;
  company: string;
  campaignNameOrId: string;
  requesterType: WebsiteRequesterType | "";
  topicOrModule: string;
  companyWebsite: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

type SuccessState = {
  ticketCode: string;
  categoryLabel: string;
  acknowledgementSent: boolean;
  message: string;
};

const INITIAL_FORM: FormState = {
  category: "creator_support",
  name: "",
  email: "",
  message: "",
  phone: "",
  socialHandle: "",
  platform: "",
  issueType: "",
  campaignName: "",
  brandName: "",
  campaignMonth: "",
  cloutflowPocName: "",
  cloutflowPocContactNumber: "",
  company: "",
  campaignNameOrId: "",
  requesterType: "",
  topicOrModule: "",
  companyWebsite: "",
};

const fieldClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-70";

function monthInputToLabel(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const names = [
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
  ];
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${names[monthIndex]} ${year}`;
}

function validateClient(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = "Name is required.";
  if (!form.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!isValidEmailAddress(form.email)) {
    errors.email = "Enter a valid email address.";
  }

  switch (form.category) {
    case "creator_support":
      if (!form.phone.trim()) errors.phone = "Phone number is required.";
      else if (!isValidPhoneNumber(form.phone)) {
        errors.phone = PHONE_VALIDATION_MESSAGE;
      }
      if (!form.socialHandle.trim()) {
        errors.socialHandle = "Social media handle is required.";
      }
      if (!form.platform) errors.platform = "Select a platform.";
      if (!form.issueType) errors.issueType = "Select an issue type.";
      if (!form.campaignName.trim()) {
        errors.campaignName = "Campaign name is required.";
      }
      if (!form.brandName.trim()) errors.brandName = "Brand name is required.";
      if (!form.campaignMonth.trim()) {
        errors.campaignMonth = "Campaign month is required.";
      }
      if (
        form.cloutflowPocContactNumber.trim() &&
        !isValidPhoneNumber(form.cloutflowPocContactNumber)
      ) {
        errors.cloutflowPocContactNumber = PHONE_VALIDATION_MESSAGE;
      }
      break;
    case "track_campaign":
      if (!form.company.trim()) errors.company = "Company is required.";
      if (!form.campaignNameOrId.trim()) {
        errors.campaignNameOrId = "Campaign name or ID is required.";
      }
      break;
    case "product_demo":
      if (!form.company.trim()) errors.company = "Company is required.";
      if (form.phone.trim() && !isValidPhoneNumber(form.phone)) {
        errors.phone = PHONE_VALIDATION_MESSAGE;
      }
      break;
    case "brand_support":
    case "reporting_analytics":
      if (!form.company.trim()) errors.company = "Company is required.";
      break;
    case "payments_commercials":
      if (!form.requesterType) {
        errors.requesterType = "Select whether you are a brand or creator.";
      } else if (form.requesterType === "creator") {
        if (!form.socialHandle.trim()) {
          errors.socialHandle = "Social media handle is required.";
        }
      } else {
        if (!form.company.trim()) errors.company = "Company is required.";
        if (!form.campaignNameOrId.trim()) {
          errors.campaignNameOrId = "Campaign name or ID is required.";
        }
      }
      break;
    case "product_documentation":
      if (!form.topicOrModule.trim()) {
        errors.topicOrModule = "Topic or module is required.";
      }
      break;
  }

  return errors;
}

function buildRequestBody(form: FormState): Record<string, string> {
  const body: Record<string, string> = {
    category: form.category,
    name: form.name.trim(),
    email: form.email.trim(),
    message: form.message.trim(),
    [WEBSITE_HONEYPOT_FIELDS[0]]: form.companyWebsite,
  };

  if (form.category === "creator_support") {
    Object.assign(body, {
      phone: form.phone.trim(),
      socialHandle: form.socialHandle.trim(),
      platform: form.platform,
      issueType: form.issueType,
      campaignName: form.campaignName.trim(),
      brandName: form.brandName.trim(),
      campaignMonth: monthInputToLabel(form.campaignMonth.trim()),
      cloutflowPocName: form.cloutflowPocName.trim(),
      cloutflowPocContactNumber: form.cloutflowPocContactNumber.trim(),
    });
  } else if (form.category === "track_campaign") {
    Object.assign(body, {
      company: form.company.trim(),
      campaignNameOrId: form.campaignNameOrId.trim(),
    });
  } else if (form.category === "product_demo") {
    Object.assign(body, {
      company: form.company.trim(),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    });
  } else if (
    form.category === "brand_support" ||
    form.category === "reporting_analytics"
  ) {
    body.company = form.company.trim();
  } else if (form.category === "payments_commercials") {
    body.requesterType = form.requesterType;
    if (form.requesterType === "creator") {
      body.socialHandle = form.socialHandle.trim();
    } else {
      body.company = form.company.trim();
      body.campaignNameOrId = form.campaignNameOrId.trim();
    }
  } else if (form.category === "product_documentation") {
    body.topicOrModule = form.topicOrModule.trim();
  }

  return body;
}

export default function WebsiteEnquiryForm() {
  const formId = useId();
  const submittingRef = useRef(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function resetForAnotherRequest() {
    setForm(INITIAL_FORM);
    setErrors({});
    setSubmitError(null);
    setSuccess(null);
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || submitting) return;

    const nextErrors = validateClient(form);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const response = await fetch("/api/public/website-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(form)),
      });

      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        ticketCode?: string;
        acknowledgementSent?: boolean;
        message?: string;
      } | null;

      if (!response.ok || !data?.success || !data.ticketCode) {
        setSubmitError(
          data?.message ||
            "Unable to submit your request right now. Please try again.",
        );
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      setSuccess({
        ticketCode: data.ticketCode,
        categoryLabel: WEBSITE_CATEGORY_LABELS[form.category],
        acknowledgementSent: Boolean(data.acknowledgementSent),
        message:
          data.message ||
          (data.acknowledgementSent
            ? "An acknowledgement has been emailed to you."
            : "Your ticket was created successfully. Our team will contact you shortly."),
      });
    } catch {
      setSubmitError(
        "Unable to submit your request right now. Please try again.",
      );
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    submittingRef.current = false;
    setSubmitting(false);
  }

  if (success) {
    return (
      <div
        className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-md)] sm:p-8"
        role="status"
        aria-live="polite"
      >
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">
          Request received
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Your request has been submitted
        </h2>
        <p className="mt-3 text-sm text-muted">{success.message}</p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Ticket code
            </dt>
            <dd className="mt-1 font-mono text-lg font-semibold text-foreground">
              {success.ticketCode}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Enquiry category
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {success.categoryLabel}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={resetForAnotherRequest}
          className="mt-8 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Submit another request
        </button>
      </div>
    );
  }

  const category = form.category;

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-md)] sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={`${formId}-category`}
          label="What do you need help with?"
          required
          className="sm:col-span-2"
        >
          <select
            id={`${formId}-category`}
            name="category"
            required
            disabled={submitting}
            value={form.category}
            onChange={(e) =>
              updateField(
                "category",
                e.target.value as WebsiteRequestCategory,
              )
            }
            className={fieldClass}
          >
            {WEBSITE_REQUEST_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {WEBSITE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field id={`${formId}-name`} label="Name" error={errors.name} required>
          <input
            id={`${formId}-name`}
            name="name"
            autoComplete="name"
            required
            disabled={submitting}
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className={fieldClass}
            placeholder="Your full name"
          />
        </Field>

        <Field
          id={`${formId}-email`}
          label="Email address"
          error={errors.email}
          required
        >
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={submitting}
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            className={fieldClass}
            placeholder="you@example.com"
          />
        </Field>

        {category === "payments_commercials" ? (
          <Field
            id={`${formId}-requesterType`}
            label="I am a"
            error={errors.requesterType}
            required
            className="sm:col-span-2"
          >
            <select
              id={`${formId}-requesterType`}
              name="requesterType"
              required
              disabled={submitting}
              value={form.requesterType}
              onChange={(e) =>
                updateField(
                  "requesterType",
                  e.target.value as WebsiteRequesterType | "",
                )
              }
              className={fieldClass}
            >
              <option value="">Select</option>
              {WEBSITE_REQUESTER_TYPES.filter((value) => value !== "agency").map(
                (value) => (
                  <option key={value} value={value}>
                    {value === "brand" ? "Brand / agency" : "Creator"}
                  </option>
                ),
              )}
            </select>
          </Field>
        ) : null}

        {(category === "track_campaign" ||
          category === "product_demo" ||
          category === "brand_support" ||
          category === "reporting_analytics" ||
          (category === "payments_commercials" &&
            form.requesterType !== "creator")) && (
          <Field
            id={`${formId}-company`}
            label="Company"
            error={errors.company}
            required={category !== "payments_commercials" || form.requesterType !== "creator"}
            className="sm:col-span-2"
          >
            <input
              id={`${formId}-company`}
              name="company"
              disabled={submitting}
              value={form.company}
              onChange={(e) => updateField("company", e.target.value)}
              className={fieldClass}
              placeholder="Your company or brand"
            />
          </Field>
        )}

        {(category === "creator_support" ||
          (category === "payments_commercials" &&
            form.requesterType === "creator")) && (
          <Field
            id={`${formId}-socialHandle`}
            label="Social media handle"
            error={errors.socialHandle}
            required
          >
            <input
              id={`${formId}-socialHandle`}
              name="socialHandle"
              disabled={submitting}
              value={form.socialHandle}
              onChange={(e) => updateField("socialHandle", e.target.value)}
              className={fieldClass}
              placeholder="@yourhandle"
            />
          </Field>
        )}

        {(category === "track_campaign" ||
          (category === "payments_commercials" &&
            form.requesterType !== "creator" &&
            form.requesterType !== "")) && (
          <Field
            id={`${formId}-campaignNameOrId`}
            label="Campaign name or ID"
            error={errors.campaignNameOrId}
            required
            className="sm:col-span-2"
          >
            <input
              id={`${formId}-campaignNameOrId`}
              name="campaignNameOrId"
              disabled={submitting}
              value={form.campaignNameOrId}
              onChange={(e) => updateField("campaignNameOrId", e.target.value)}
              className={fieldClass}
              placeholder="Campaign name or reference ID"
            />
          </Field>
        )}

        {(category === "creator_support" || category === "product_demo") && (
          <Field
            id={`${formId}-phone`}
            label="Phone number"
            error={errors.phone}
            required={category === "creator_support"}
            className="sm:col-span-2"
          >
            <PhoneInput
              id={`${formId}-phone`}
              name="phone"
              value={form.phone}
              onChange={(value) => updateField("phone", value)}
              disabled={submitting}
              invalid={Boolean(errors.phone)}
            />
          </Field>
        )}

        {category === "product_documentation" ? (
          <Field
            id={`${formId}-topicOrModule`}
            label="Topic or module"
            error={errors.topicOrModule}
            required
            className="sm:col-span-2"
          >
            <input
              id={`${formId}-topicOrModule`}
              name="topicOrModule"
              disabled={submitting}
              value={form.topicOrModule}
              onChange={(e) => updateField("topicOrModule", e.target.value)}
              className={fieldClass}
              placeholder="e.g. Analytics, Discovery, Reporting"
            />
          </Field>
        ) : null}

        {category === "creator_support" ? (
          <>
            <Field
              id={`${formId}-platform`}
              label="Platform"
              error={errors.platform}
              required
            >
              <select
                id={`${formId}-platform`}
                name="platform"
                required
                disabled={submitting}
                value={form.platform}
                onChange={(e) =>
                  updateField(
                    "platform",
                    e.target.value as WebsitePlatformLabel | "",
                  )
                }
                className={fieldClass}
              >
                <option value="">Select platform</option>
                {WEBSITE_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={`${formId}-issueType`}
              label="Issue type"
              error={errors.issueType}
              required
            >
              <select
                id={`${formId}-issueType`}
                name="issueType"
                required
                disabled={submitting}
                value={form.issueType}
                onChange={(e) =>
                  updateField(
                    "issueType",
                    e.target.value as WebsiteIssueTypeLabel | "",
                  )
                }
                className={fieldClass}
              >
                <option value="">Select issue type</option>
                {WEBSITE_ISSUE_TYPES.map((issueType) => (
                  <option key={issueType} value={issueType}>
                    {issueType}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={`${formId}-campaignName`}
              label="Campaign name"
              error={errors.campaignName}
              required
            >
              <input
                id={`${formId}-campaignName`}
                name="campaignName"
                disabled={submitting}
                value={form.campaignName}
                onChange={(e) => updateField("campaignName", e.target.value)}
                className={fieldClass}
                placeholder="Summer Launch 2026"
              />
            </Field>

            <Field
              id={`${formId}-brandName`}
              label="Brand name"
              error={errors.brandName}
              required
            >
              <input
                id={`${formId}-brandName`}
                name="brandName"
                disabled={submitting}
                value={form.brandName}
                onChange={(e) => updateField("brandName", e.target.value)}
                className={fieldClass}
                placeholder="Brand you collaborated with"
              />
            </Field>

            <Field
              id={`${formId}-campaignMonth`}
              label="Campaign month"
              error={errors.campaignMonth}
              required
            >
              <input
                id={`${formId}-campaignMonth`}
                name="campaignMonth"
                type="month"
                disabled={submitting}
                value={form.campaignMonth}
                onChange={(e) => updateField("campaignMonth", e.target.value)}
                className={fieldClass}
              />
            </Field>

            <Field
              id={`${formId}-cloutflowPocName`}
              label="Cloutflow POC name"
              error={errors.cloutflowPocName}
            >
              <input
                id={`${formId}-cloutflowPocName`}
                name="cloutflowPocName"
                disabled={submitting}
                value={form.cloutflowPocName}
                onChange={(e) => updateField("cloutflowPocName", e.target.value)}
                className={fieldClass}
                placeholder="Your Cloutflow point of contact (optional)"
              />
            </Field>

            <Field
              id={`${formId}-cloutflowPocContactNumber`}
              label="Cloutflow POC contact number"
              error={errors.cloutflowPocContactNumber}
              className="sm:col-span-2"
            >
              <PhoneInput
                id={`${formId}-cloutflowPocContactNumber`}
                name="cloutflowPocContactNumber"
                value={form.cloutflowPocContactNumber}
                onChange={(value) =>
                  updateField("cloutflowPocContactNumber", value)
                }
                disabled={submitting}
                invalid={Boolean(errors.cloutflowPocContactNumber)}
              />
            </Field>
          </>
        ) : null}

        <Field
          id={`${formId}-message`}
          label={
            category === "creator_support"
              ? "Detailed issue description"
              : "Message"
          }
          error={errors.message}
          className="sm:col-span-2"
        >
          <textarea
            id={`${formId}-message`}
            name="message"
            disabled={submitting}
            rows={5}
            value={form.message}
            onChange={(e) => updateField("message", e.target.value)}
            className={`${fieldClass} resize-y min-h-[8rem]`}
            placeholder="Share the details we need to help you quickly. (optional)"
          />
        </Field>
      </div>

      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      >
        <label htmlFor={`${formId}-companyWebsite`}>Company website</label>
        <input
          id={`${formId}-companyWebsite`}
          name={WEBSITE_HONEYPOT_FIELDS[0]}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.companyWebsite}
          onChange={(e) => updateField("companyWebsite", e.target.value)}
        />
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted">
        By submitting this form, you agree that Cloutflow may use the details
        you provide to investigate and resolve your support request. We only
        share information with people who need it to help you.
      </p>

      {submitError ? (
        <p
          className="mt-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          You will receive a ticket code after submission.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Submitting…" : "Submit support request"}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
