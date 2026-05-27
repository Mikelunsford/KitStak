# Customer portal smoke plan

Date drafted: 2026-05-27
Last walked: 2026-05-21 (Path B2 verification, empty-state only)
Target: prod (`https://www.kitstak.com`) against prod Supabase (`zmnvwhqjahwidprnjxrq`)

## Goal

Verify the customer portal works end-to-end with real (non-empty) customer data, six days after the chassis shipped. The May 21 walk only verified the invite-to-empty-portal happy path; this walk verifies what the customer actually sees when they have invoices, quotes, and projects.

## Why now

1. Staff invite chassis just shipped and was smoke-validated. Portal chassis was shipped six days ago and has not been touched since. High chance of latent drift or bug.
2. The May 21 walk used an empty test customer. We have not verified that the portal renders real data, that the data is correctly scoped to the customer's org, or that the customer can NEVER see another customer's data.
3. Path B (portal + Resend + Stripe) is the operator's next strategic priority per the pillar wiring sequence memory.

## Pre-flight (do these before clicking anything)

### F1. Verify the prod customer-portal-api is deployed and reachable

```sh
curl -i https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/customer-portal-api/portal/me \
  -H "Authorization: Bearer <invalid_token>"
```

Expected: `401` with a JSON envelope. If you get `404 Not Found` or `Function not deployed`, the portal function is not on prod and the rest of the walk is moot.

### F2. Pick a real customer to invite

Pick a customer in prod with at least:
- 1 invoice in any state (draft, sent, paid)
- 1 quote in any state
- 1 project in any state

If no single customer has all three, pick the customer with the most data and note which entities are missing. Walk what you have.

Recommended: re-use the test customer from May 21 (Malunsf@gmail.com → "Test Customer") and add 1 invoice + 1 quote + 1 project to it from the operator dashboard before walking. Easier than spinning up a fresh customer.

### F3. Make sure the email you're inviting to is one you can read in real time

The portal smoke depends on receiving the magic link. Use a Gmail / Outlook account you have open in another tab. Do NOT use the operator's `mike@team-01.com` because that's already bound to staff auth and the magic-link flow may collide.

Suggested: `mike+portaltest@team-01.com` if your provider supports plus-addressing.

### F4. Open these dashboards in adjacent tabs before clicking

Per the dashboard-link memory, paste these:

- Supabase prod SQL editor: https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/sql/new
- Supabase prod auth users: https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/auth/users
- Supabase prod logs (customer-portal-api): https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/logs/edge-functions?f=customer-portal-api
- Vercel prod logs: https://vercel.com/mikes-projects-5e3ecc74/kitstak/logs
- Sentry: https://kitstak.sentry.io/issues/?project=4511423235751936

You will want to grep logs in real time if anything looks weird.

## The walk

### Step 1. Invite the customer from the operator side

1. Sign in to `https://www.kitstak.com` as `mike@team-01.com`.
2. Navigate to the chosen customer's detail page: `/3pl-operations/customers/:id` (or wherever the canonical detail route lives).
3. Scroll to the "Customer portal access" section.
4. Enter the email from F3 in the email override field.
5. Click "Send portal invite."

**Expected**:
- Inline success feedback ("Sent. Email queued for delivery." or similar)
- No errors in the browser console
- No errors in Vercel logs

**Red flags**:
- Generic 500 → check `crm-api` Edge logs
- 403 → cap drift on `crm.customers.invite_to_portal`
- 422 with "no email" → the customer has no `primary_email` AND the override didn't apply

### Step 2. Verify the notification queued

Run in the Supabase prod SQL editor:

```sql
select id, channel, payload->>'to' as recipient, status, created_at
from notifications
where payload->>'to' = '<the email from F3>'
order by created_at desc
limit 5;
```

**Expected**: 1 fresh row, `status` is one of `pending`, `delivered`, or `failed`.

If `pending` for more than 5 minutes, the notifications-drain cron has not picked it up. Manually fire:

```sh
gh workflow run notifications-drain.yml
```

Watch the run, then re-query. Should flip to `delivered`.

### Step 3. Open the magic-link email

In the email client (F3), find the email from `Kitstak <notifications@kitstak.com>`.

**Verify**:
- Sender name reads "Kitstak", not a raw email address
- Subject includes the inviting org's display name (post-PR #156 humane copy)
- Body opens with "You have been invited to ..." not "You have been invited to Kitstak on Kitstak"
- The magic link target URL is `https://www.kitstak.com/portal` (per Supabase redirect URL allowlist; verified in May 21 fix)

**Red flags**:
- Sender is `noreply@mail.supabase.io` → Resend SMTP not wired
- Link points at a Vercel deployment URL (`kitstak-xxx.vercel.app`) instead of `www.kitstak.com` → Supabase Auth Site URL drifted; fix at https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/auth/url-configuration

### Step 4. Click the magic link (in a fresh incognito window)

Open a new incognito Chrome window. Paste the magic link.

**Expected**:
- Lands at `/portal` (not `/dashboard`, not `/signin`)
- Page renders the portal dashboard (NOT the operator dashboard)
- No console errors

**Red flags**:
- Lands at `/dashboard` → IndexRoute guard is mis-routing customer_user role to staff dashboard
- Lands at `/signin` → magic link expired or the auth handshake failed
- Lands at portal but renders empty / blank → portal-api `/portal/me` is failing; check Edge logs

### Step 5. Verify the dashboard shows the right tenant data

The portal dashboard should show:
- Customer's display_name in the header / topbar
- Counts of invoices, quotes, projects (or list previews)

**Verify the counts match what the customer actually has** in the operator-side view. If you added 1 invoice / 1 quote / 1 project in F2, the portal should show 1 each.

**Red flags**:
- Counts are higher than expected → RLS bleed (customer is seeing OTHER customers' data). STOP IMMEDIATELY. This is a constitutional violation. Open a P0 follow-up.
- Counts are lower than expected → data not making it through `customer-portal-api` filters
- Counts are zero → check `/portal/me` returns the right `customer_id` and `org_id`

### Step 6. Walk each portal section

Click into each section in order:

#### 6a. Invoices (`/portal/invoices`)

- List renders with the customer's invoices only
- Status badges render (use `StatusBadge` component)
- Click into one invoice → detail view renders (if there is one; if portal invoices are list-only, note that and skip)
- For paid invoices, the amount + paid date show correctly
- For draft invoices, they should NOT appear (drafts are operator-internal)

#### 6b. Quotes (`/portal/quotes`)

- Same shape as invoices
- Approved quotes should show approval timestamp
- Sent quotes should show "Pending your review" or similar CTA

#### 6c. Projects (`/portal/projects`)

- List renders
- Each project shows its state (active, completed, on hold)
- Verify NO project line-items are visible (those are operator-internal)

### Step 7. Cross-tenant attack test (the critical RLS check)

While signed in as the customer in the incognito window, open the browser dev tools network tab and:

1. Find a `GET /customer-portal-api/portal/invoices` request
2. Right-click → copy as cURL
3. In a terminal, modify the URL to add a query param attempting to access another org's data:

```sh
# Original
curl 'https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/customer-portal-api/portal/invoices' \
  -H 'Authorization: Bearer <copied-jwt>' \
  -H 'apikey: <copied-anon-key>'

# Attack attempt: try to bypass tenant scope via query param
curl 'https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/customer-portal-api/portal/invoices?org_id=<some-other-org-id>' \
  -H 'Authorization: Bearer <copied-jwt>' \
  -H 'apikey: <copied-anon-key>'
```

**Expected**: BOTH return the SAME set of invoices (the customer's own). The query param should be ignored. The handler resolves `org_id` from the JWT, not from query params.

**Red flag**: if the second request returns different (or more) invoices, the portal-api is honoring caller-supplied tenant scope. P0 constitutional violation.

Also test:
```sh
# Direct entity-id fetch for an entity the customer does not own
curl 'https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/customer-portal-api/portal/attachments?entity_type=invoice&entity_id=<some-other-customer-invoice-id>' \
  -H 'Authorization: Bearer <copied-jwt>' \
  -H 'apikey: <copied-anon-key>'
```

**Expected**: `404` (per constitutional Pattern B rule: cross-tenant returns 404, not 403). NOT 200 with data. NOT 403 with a message saying "you don't have access" (that leaks existence).

### Step 8. Sign out + sign back in via the portal sign-in page

1. From the portal, sign out (if there is a sign-out control; check Topbar / dropdown).
2. Land on `/portal/signin` or `/signin`.
3. Enter the customer email, request magic link.
4. Receive second email, click link.
5. Land back at `/portal` cleanly.

**Red flags**:
- No sign-out control on the portal → file a UX follow-up
- Request-magic-link on portal-signin returns an error → portal-signin handler drift
- Second magic link routes to `/dashboard` instead of `/portal` → IndexRoute guard regression

### Step 9. Sign-out cleanup

Verify in the operator-side Supabase auth users dashboard (F4 link) that the customer user row exists, has `email_confirmed_at` set, and has a recent `last_sign_in_at`. Confirms the round-trip wrote.

## What to do with findings

For each red-flag observation, file a follow-up:

- `F-Wave9-PORTAL-SMOKE-2026-05-27-NN` — short scope, one sentence
- Severity: P0 if RLS bleed, P1 if functional regression, P2 if UX gap
- Link the SQL or curl that reproduces

If everything is green: walk is done in ~30 minutes, no follow-ups filed, portal chassis confirmed durable. Move to Stripe scoping.

If anything is P0: stop the walk, file the follow-up immediately, dispatch a fix agent before continuing. Cross-tenant data bleed is the only constitutional violation that warrants stopping the world.

## Stretch goal (only if everything in steps 1-9 is green)

Try one workflow from the customer side: download an invoice PDF if the portal exposes one. The PDF chassis from F-Wave2-CO-01 may or may not be wired through to the portal yet. If it is not, file `F-Wave9-PORTAL-PDF-DOWNLOAD-01`.
