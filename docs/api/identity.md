# Identity, tenancy, branding, and settings API

Wave 2 ships four edge function bundles that cover the identity surface
for the SPA and for service-to-service callers. This document is the
contract reference. The shapes are defined in
`supabase/functions/_shared/types/identity.ts` (byte-identical to
`apps/web/src/lib/types/identity.ts`).

## Bundles

| Bundle | Purpose | JWT verify |
| --- | --- | --- |
| `auth-api` | Session resolve, capability self-read, workspace switch. | true |
| `tenants-api` | Branding read, active tenant, public host resolver. | true (host resolver: false) |
| `settings-api` | Settings CRUD, branding writes, flags admin, numbering admin. | true |
| `admin-console-api` | Platform admin surface, gated behind `platform_admin.enabled`. | true |

## Error envelope

Every response uses the canonical envelope:

```json
{ "data": ... }            // 2xx
{ "error": { "code": "...", "message": "...", "details": {} } }  // 4xx / 5xx
```

Codes are constitutional: `UNAUTHORIZED` 401, `NO_ACTIVE_ORG` 401,
`FORBIDDEN` 403, `FEATURE_DISABLED` 403, `NOT_FOUND` 404,
`METHOD_NOT_ALLOWED` 405, `STATE_CONFLICT` 409,
`IDEMPOTENCY_CONFLICT` 409, `VALIDATION_ERROR` 422.

Idempotency: every non-GET endpoint requires an `Idempotency-Key` UUID v4
header. Replay returns the original status with `Idempotent-Replay: true`.

## auth-api

### GET `/auth-api/me`

Returns the caller's identity row, active org claim, role, and active
memberships.

Response (200):
```json
{
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "display_name": "Casey Owner",
    "active_org_id": "uuid | null",
    "active_role": "org_owner | org_admin | sales | ops | accounting | viewer | customer_user | vendor_user | null",
    "memberships": [
      {
        "org_id": "uuid",
        "org_slug": "acme",
        "display_name": "Acme Logistics",
        "role": "org_owner",
        "is_default": true
      }
    ]
  }
}
```

Sole-membership fallback: if the JWT carries no org claim and the user
has exactly one active membership, the response projects that membership
as the active context so the SPA can land directly on the dashboard.

### GET `/auth-api/me/capabilities`

Returns the effective identity-side-car capability set for the active
role.

```json
{ "data": { "role": "org_owner", "capabilities": ["identity.session.read", "..."] } }
```

### POST `/auth-api/sessions/switch-org`

Idempotent. Stamps the active org claim on the caller's
`app_metadata.kitstak_org_id` and `kitstak_org_role`.

Request:
```json
{ "org_id": "uuid" }
```

Returns 201 with `{ "data": { "org_id": "...", "role": "..." } }`.
404 NOT_FOUND when the caller has no active membership in the requested
org (no existence leak across tenants).

The SPA calls `supabase.auth.refreshSession()` after this returns so the
new JWT is in scope.

## tenants-api

### GET `/tenants-api/tenants/resolve-host?host=<host>`

**Public.** Verify-JWT is false at the deploy boundary. Used at app boot
before authentication so the SPA can pick the right branding for custom
host deployments. Returns 404 NOT_FOUND when the host is unknown or
unverified.

```json
{ "data": { "org_id": "uuid", "org_slug": "acme" } }
```

### GET `/tenants-api/branding`

Authenticated. Returns the active org's branding row. Falls back to
404 NOT_FOUND if the row is missing (provisioning bug); the SPA treats a
404 as "use platform defaults" rather than redirecting.

### GET `/tenants-api/tenants/me`

Authenticated. Returns the active organization row (no joins).

## settings-api

Read routes require `settings.read`; writes require `settings.write`.
Flag routes require `flags.read` / `flags.write`. Branding writes require
`branding.update`. Numbering admin requires `settings.numbering.read` /
`settings.numbering.reset`. Capabilities are defined in
`_shared/capabilities/identity.ts`.

### Settings

* `GET /settings-api/settings` -> `{ items: OrgSetting[] }`
* `GET /settings-api/settings/:group` -> `{ items: OrgSetting[] }`
* `PUT /settings-api/settings` (idempotent) -> upserted row
* `DELETE /settings-api/settings/:group/:key` -> 204 No Content

### Feature flags

* `GET /settings-api/flags` -> `{ items: OrgFeatureFlag[] }`
* `PUT /settings-api/flags/:flag_key` (idempotent) -> upserted row

### Branding

* `GET /settings-api/branding` -> branding row
* `PUT /settings-api/branding` (idempotent) -> patched branding row
* `POST /settings-api/branding/logo/upload-url` (idempotent) -> signed upload URL

The upload-url route mints a single-use signed link so the SPA can PUT a logo,
favicon, or email logo straight to the public `branding` storage bucket without
the JSON-only `apiClient` carrying the binary. It requires the
`branding.logo.upload` capability (the capability gate is the authority; storage
RLS is role-based and cannot see this capability). The object path is org-scoped
from the caller's JWT, so an asset can only ever land under the caller's own
prefix.

Request:
```json
{
  "kind": "logo | icon | email_logo",
  "content_type": "image/png | image/jpeg | image/svg+xml | image/webp | image/x-icon",
  "size_bytes": 12345
}
```

`size_bytes` is validated against a per-kind ceiling: `logo` and `email_logo`
cap at 1 MiB, `icon` caps at 256 KiB. An oversize body returns
`422 VALIDATION_ERROR` with `details: { kind, max_bytes, size_bytes }`.

Response (201):
```json
{
  "data": {
    "token": "single-use upload token",
    "path": "<org_id>/<kind>-<uuid>.<ext>",
    "public_url": "https://.../storage/v1/object/public/branding/<path>"
  }
}
```

The SPA uploads the bytes with the token, then persists `public_url` through the
`PUT /settings-api/branding` route on save. The mint itself is idempotent. A
failed signed-URL mint surfaces `500 INTERNAL_ERROR`.

### Numbering

* `GET /settings-api/numbering` -> `{ items: NumberingSequence[] }`
* `GET /settings-api/numbering/:doc_type` -> one sequence
* `POST /settings-api/numbering/reset` (idempotent) -> `{ doc_type, next_value }`

## admin-console-api

Bundle-level gate: every route returns 404 NOT_FOUND when
`platform_admin.enabled` is false for the caller's org. This is the
constitutional pattern (a 403 where 404 is required is a release
blocker). Hidden surface; the SPA must not redirect on 404.

When the flag is on, state-changing routes additionally require a
verified TOTP factor on the caller (`requireMfaVerified`).

Wave 2 ships stubs:

* `GET /admin-console-api/orgs` -> empty page
* `POST /admin-console-api/orgs/impersonate` -> 501 NOT_IMPLEMENTED
* `GET /admin-console-api/audit` -> empty page

The real implementation lands in a subsequent wave alongside the
platform-admin schema.

## Capability matrix (identity side-car)

Defined in `_shared/capabilities/identity.ts`. Composed into the master
canon at wave close.

| Prefix | Capabilities |
| --- | --- |
| `identity.*` | `session.read`, `session.switch`, `user.read.self`, `user.update.self` |
| `tenancy.*` | `org.read`, `org.update`, `memberships.read`, `memberships.write`, `domains.read`, `domains.write`, `sso.read`, `sso.write` |
| `branding.*` | `read`, `update`, `logo.upload` |
| `settings.*` | `read`, `write`, `numbering.read`, `numbering.reset` |
| `flags.*` | `read`, `write` |
| `admin.*` | `orgs.read`, `orgs.impersonate`, `audit.read` (all gated by `platform_admin.enabled`) |

## State machine

Migration 0002 defines the organizations.status CHECK and the audit
trigger. The SPA mirrors the allowed transitions in
`_shared/workflow/identity.ts`. Allowed transitions:

| From | To | Action | Capability |
| --- | --- | --- | --- |
| `provisioning` | `active` | `activate` | `tenancy.org.update` |
| `active` | `suspended` | `suspend` | `tenancy.org.update` |
| `suspended` | `active` | `reinstate` | `tenancy.org.update` |
| `active` | `archived` | `archive` | `tenancy.org.update` |
| `suspended` | `archived` | `archive` | `tenancy.org.update` |
