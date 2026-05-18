# Managing your workspace

Kitstak gives owners and admins a small set of admin pages to keep a
workspace healthy. This guide walks through the four screens under the
`/admin` path.

## Who can see these pages

The admin pages are visible only to `Owner` and `Admin` roles. Other team
members see no menu entry and a direct visit redirects to the dashboard.
The server checks every save against the role policy; a clever URL trick
will not bypass the gate.

## Settings

Path: `/admin/settings`

A workspace setting is a typed JSON value stored under a group and a key.
Use settings for small pieces of configuration that change rarely.
Common groups:

* `general` for workspace-wide defaults
* `finance` for invoice and quote defaults
* `sales` for quote defaults and customer-facing labels
* `ops` for receiving and shipment defaults

Each setting is a JSON object. To remove a setting, click `Remove`. To
add or update one, fill the form at the bottom: group, key, and the
value as a JSON object (always wrapped in `{}`).

## Branding

Path: `/admin/branding`

Controls the in-app shell colors, the workspace name shown in the
topbar, the favicon, and the footer printed on invoices and quotes. The
form has a live preview panel so you can see the chrome before you save.

Fields:

* `App name override` overrides the topbar label. Leave blank to default
  to your workspace display name.
* `Primary color` is the navy chrome behind the topbar and sidebar.
* `Accent color` is the call-to-action color.
* `Logo URL` and `Favicon URL` point to hosted images. A storage upload
  helper is on the roadmap.
* `Invoice PDF footer` prints on every rendered invoice. Use this for a
  bank routing line or a remit-to address.

Save applies immediately. The shell re-renders with the new tokens on
the next render cycle.

## Feature flags

Path: `/admin/flags`

Every workspace carries a row in `org_feature_flags` for each pillar and
add-on. The page lists them and lets you flip the toggle. Some flags
control whole plugins; others gate single routes. Disabling a plugin
flag hides the plugin's surface. Disabling a route flag shows the
"Feature unavailable" page when a teammate tries to reach it.

Changes take effect within five minutes (the cache window) on every
server worker.

## Document numbering

Path: `/admin/numbering`

Kitstak generates numbered identifiers for quotes, invoices, payments,
purchase orders, and other documents. The page lists every sequence,
its prefix, its reset period, and the next value that will be assigned.

`Reset to 1` rolls the sequence back to 1. This is rare; use it when
switching prefix conventions or when a parallel system has already
issued numbers you want to align with. Reset is recorded in the
workspace audit log.

## Switching workspaces

If you belong to more than one workspace, the topbar shows a workspace
switcher menu. Pick a workspace and the page reloads against the new
tenant. Your last workspace is remembered across sign-ins.
