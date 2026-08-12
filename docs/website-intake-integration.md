# Website enquiry intake integration

This guide explains how the public Cloutflow website can create support tickets in the Creator Support CRM for every Help Center enquiry category.

You do **not** need a staff login to use this flow.

## 1. Public API URL

```text
POST https://<your-creator-support-host>/api/public/website-tickets
```

Examples:

- Local: `http://localhost:3000/api/public/website-tickets`
- Vercel: `https://cloutflow-creator-support.vercel.app/api/public/website-tickets`

There is also a first-party page at `/help` on the same host.

## 2. Categories and required fields

Canonical `category` values (snake_case). Kebab-case aliases from cloutflow.com/help are also accepted (`creator-support`, `track-campaign`, etc.).

Common required fields for every category:

- `name` (alias: `creatorName`)
- `email`
- `message` (alias: `issueDescription`)
- `category` (aliases: `ticketType`, `requestCategory`)

Honeypot (must be empty / omit):

- `companyWebsite` and/or `website`

### creator_support

Also required:

- `phone`
- `socialHandle`
- `platform` — `Instagram` or `YouTube`
- `issueType` — one of:
  - `Payment Delayed / Not Received`
  - `TDS Query`
  - `GST Query`
  - `POC / Conduct Concern`
  - `Other`
- `campaignName` (or `campaignNameOrId`)
- `brandName`
- `campaignMonth` — e.g. `August 2026` or `2026-08`
- `cloutflowPocName`
- `cloutflowPocContactNumber`

### track_campaign

- `company`
- `campaignNameOrId` (or `campaignName`)

### product_demo

- `company`
- `phone` optional

### brand_support / reporting_analytics

- `company`

### payments_commercials

- `requesterType` (or `audience`) — `brand`, `creator`, or `agency`
- If brand/agency: `company` + `campaignNameOrId`
- If creator: `socialHandle`

### product_documentation

- `topicOrModule` (or `topic`)

Do **not** send status, priority, assignment, ticket code, acknowledgement timestamps, or other internal workflow fields. The API hardcodes:

- `source_channel = website`
- `status = open`
- `priority = normal`
- `assigned_team = Creator Support`
- `acknowledgement_email_requested = true`

Missing campaign fields stay `null`. Fake values like `Not applicable` are never written.

## 3. Example requests and response

### Creator support

```json
{
  "category": "creator_support",
  "name": "Riya Sharma",
  "phone": "+919876543210",
  "email": "riya@example.com",
  "socialHandle": "@riya.creates",
  "platform": "Instagram",
  "issueType": "Payment Delayed / Not Received",
  "campaignName": "Summer Launch",
  "brandName": "Acme",
  "campaignMonth": "August 2026",
  "cloutflowPocName": "Priya Sharma",
  "cloutflowPocContactNumber": "+919876543210",
  "message": "Payment for July deliverables is still pending.",
  "companyWebsite": ""
}
```

### Brand support (cloutflow.com style)

```json
{
  "ticketType": "brand-support",
  "name": "Alex Brand",
  "email": "alex@brand.com",
  "company": "Acme Brands",
  "message": "Need help with our account setup.",
  "website": ""
}
```

### Success response (`201`)

```json
{
  "success": true,
  "ticketCode": "CF-2026-00042",
  "acknowledgementSent": true,
  "message": "Your request has been submitted. An acknowledgement email has been sent."
}
```

If Brevo fails after ticket creation:

```json
{
  "success": true,
  "ticketCode": "CF-2026-00042",
  "acknowledgementSent": false,
  "message": "Your ticket was created successfully. Our team will contact you shortly."
}
```

## 4. Exact fetch example for cloutflow.com/help

```js
async function submitHelpEnquiry(formValues) {
  const response = await fetch(
    "https://cloutflow-creator-support.vercel.app/api/public/website-tickets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: formValues.category, // or ticketType kebab-case
        name: formValues.name,
        email: formValues.email,
        message: formValues.message,
        company: formValues.company,
        phone: formValues.phone,
        socialHandle: formValues.socialHandle,
        campaignNameOrId: formValues.campaignName,
        requesterType: formValues.audience,
        topicOrModule: formValues.topic,
        // creator_support extras when applicable:
        platform: formValues.platform,
        issueType: formValues.issueType,
        brandName: formValues.brandName,
        campaignMonth: formValues.campaignMonth,
        cloutflowPocName: formValues.cloutflowPocName,
        cloutflowPocContactNumber: formValues.cloutflowPocContactNumber,
        website: "", // honeypot must stay empty
      }),
    },
  );

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Unable to submit your request.");
  }
  return data;
}
```

## 5. Allowed-origin configuration

```bash
WEBSITE_INTAKE_ALLOWED_ORIGINS=https://cloutflow.com,https://www.cloutflow.com,https://cloutflow-creator-support.vercel.app
```

Exact matches only. No `*`. Localhost allowed only outside production.

## 6. Required Vercel environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Yes | Server-only admin insert |
| `WEBSITE_INTAKE_ALLOWED_ORIGINS` | Yes | Exact browser origins |
| Existing Brevo SMTP vars | Yes for email | Acknowledgement delivery |

## 7. Database migration

Apply locally / via your normal Supabase workflow (do not apply remotely from this agent):

`supabase/migrations/20260811190000_website_enquiry_categories.sql`

Adds:

- `request_category`
- `company_name`
- `requester_type`
- `topic_or_module`
- `intake_details jsonb`

And makes `issue_type` / `platform` nullable for general enquiries.

## 8. Testing locally

1. Apply the migration to your local/dev Supabase project.
2. Set secret key + allowed origins.
3. `npm run dev`
4. Submit from `/help` or curl with each category.
5. Confirm CRM shows **Source: Website**, enquiry category, and only relevant fields.

## 9. Testing production

1. Deploy with env vars + applied migration.
2. Submit from an allowed marketing origin.
3. Confirm ticket code, acknowledgement email, and CRM display.

## 10. Security limitations

- Honeypot only (not full bot protection)
- Exact-origin CORS
- Server-side category validation + trusted workflow defaults
- Admin/service-role insert path must stay server-only
- Public responses never include DB errors, IDs, stack traces, or credentials

## 11. Next bot-protection step

Add Cloudflare Turnstile (or similar) token verification before insert once the form is widely linked.
