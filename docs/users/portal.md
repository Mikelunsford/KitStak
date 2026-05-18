# Customer Portal

The customer portal is the read-only surface your customers see at `/portal`. It is the only place in Kitstak where an external account (`customer_user` role) can sign in. Internal staff cannot reach the portal pages even if they manually visit the URL; the SPA guard bounces them and the API returns 404.

## What customers see

- `/portal` - dashboard with the customer's invoices, quotes, and projects.
- `/portal/invoices` - full invoice list.
- `/portal/quotes` - full quote list.
- `/portal/projects` - full project list.

## What customers cannot do

- Edit any record.
- Comment on internal threads (only `is_internal = false` comments would be visible; portal v1 hides comments entirely).
- View attachments that are not tied to one of their own invoices, quotes, or projects.

## How access is granted

An internal admin invites the customer user with an `org_memberships` row pointing at the customer record (`customer_id`). The portal API resolves `customer_id` from this membership row, and every query is filtered by `org_id` AND `customer_id`.

## What is not in v1

- Self-service password reset, customization, or branded sign-in (the portal sign-in surface is shared with the internal sign-in form).
- Vendor portal (deferred per the Wave 2 audit).
- Comment or attachment write access for customers.
- Payments or invoice acceptance from inside the portal.

These ship in later waves.
