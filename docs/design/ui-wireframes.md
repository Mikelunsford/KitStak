# Kitstak End-to-End Wireframes

Status: living reference for the UI overhaul. Reflects the app as built on 2026-06-02.
Source of truth: `apps/web/src/routes.ts` (route table), `components/shell/*` (chrome),
`components/shell/sidebarModes.ts` (navigation IA), and the page archetypes under
`apps/web/src/pages/*`.

Scope: two distinct applications share the codebase.
1. The operator app (authenticated staff shell: Topbar plus Sidebar plus main).
2. The customer portal (separate chrome: PortalTopbar, no operator Sidebar).

Notation: ASCII frames are structural, not pixel-accurate. `[ ... ]` is a control,
`{ ... }` is dynamic content, `( flag )` marks a gated element.

---

## 1. Global shell (operator app)

Every authenticated route except the portal renders inside `AppShell`
(`components/shell/AppShell.tsx`): a fixed Topbar, a fixed left Sidebar at the `md`
breakpoint and up, and a scrolling main region. Below `md` the Sidebar collapses to a
slide-in drawer opened by the Topbar hamburger.

```
+-----------------------------------------------------------------------------+
| TrialBanner (conditional: only while the org is in trial)                    |
+-----------------------------------------------------------------------------+
| [#] Logo  {App name}            [ {Workspace} v ]   [ (O) profile v ]        |  Topbar  h-14
+----------------+------------------------------------------------------------+
|  SIDEBAR w-56  |  MAIN (scrolls independently)                              |
|                |                                                            |
|  [home] DASH   |   { route content renders here }                          |
|                |                                                            |
|  v SELL        |                                                            |
|    Quote...    |                                                            |
|  v MAKE        |                                                            |
|  v SHIP        |                                                            |
|  v GET PAID    |                                                            |
|  v LIBRARY     |                                                            |
|  v WORKFORCE   |                                                            |
|                |                                                            |
|  ---- ADMIN ---|                                                            |
|  Settings      |                                                            |
|  Branding      |                                                            |
|  Feature flags |                                                            |
|  Numbering     |                                                            |
|  Members       |                                                            |
|  Billing       |                                                            |
|  Imports       |                                                            |
|  Exports       |                                                            |
+----------------+------------------------------------------------------------+
```

### Topbar detail (`components/shell/Topbar.tsx`)

```
+-----------------------------------------------------------------------------+
| [logo] {appName}                  [ {activeOrg.display_name}  v ]  [ (O) v ] |
+-----------------------------------------------------------------------------+
            |                              |                          |
            |                              |                          +-- Profile menu (popover):
            |                              |                                 "Signed in as {email}"
            |                              |                                 [key] Account security -> /account/security
            |                              |                                 [out] Sign out
            |                              +-- Workspace switcher (popover, role-radio list):
            |                                     {org A}  {role}   [Active]
            |                                     {org B}  {role}
            |                                     posts /auth-api/sessions/switch-org
            +-- app name fallback: branding.app_name_override -> org display_name -> "Kitstak"
```

### Sidebar detail (`components/shell/Sidebar.tsx`, `sidebarModes.ts`)

Job-mode IA: the rail is grouped by stage of work, not by pillar. Each mode is a
collapsible group; expansion state persists per user in localStorage. The mode that
owns the active route auto-expands. Per-route entries hide when their `requiresFlag`
is off for the active org.

```
[home] DASHBOARD                         -> /dashboard

v SELL        Quote, qualify, and close work.
  | Leads                 /crm/leads
  | Opportunities         /crm/opportunities
  | Activities            /crm/activities
  | Quotes                /3pl-operations/quotes
  | Sales orders          /copack/orders            ( plugins.copack_ecom )

v MAKE        Build it. Track the lines.
  | Projects              /3pl-operations/projects
  | Bills of materials    /3pl-operations/boms
  | Manufacturing runs    /manufacturing/runs       ( plugins.manufacturing )
  | Kitting jobs          /copack/kitting           ( plugins.copack_ecom )
  | Receiving             /3pl-operations/receiving

v SHIP        Outbound and stock movements.
  | Shipments             /3pl-operations/shipments
  | Fulfillments          /copack/fulfillments      ( plugins.copack_ecom )
  | Stock levels          /3pl-operations/stock/levels
  | Stock movements       /3pl-operations/stock/movements

v GET PAID    Invoice, collect, reconcile.
  | Invoices              /invoicing/invoices
  | Credit notes          /invoicing/credit-notes
  | Payments              /invoicing/payments
  | Cost dashboard        /kitcost/dashboard
  | Chart of accounts     /finance/coa
  | Period close          /finance/period-close
  | Journal entries       /finance/journal-entries  ( finance.journal_entries.enabled )

v LIBRARY     Reference data and procurement.
  | Customers             /crm/customers
  | Contacts              /crm/contacts
  | Sales channels        /copack/channels          ( plugins.copack_ecom )
  | Items                 /3pl-operations/items
  | Warehouses            /3pl-operations/warehouses
  | Vendors               /3pl-operations/vendors
  | Purchase orders       /3pl-operations/purchase-orders
  | Vendor bills          /3pl-operations/vendor-bills
  | Expenses              /3pl-operations/expenses

v WORKFORCE   People, schedules, and labor.
  | Members               /kitforce/members         ( plugins.kitforce )
  | Teams                 /kitforce/teams           ( plugins.kitforce )
  | Schedule              /kitforce/shifts          ( plugins.kitforce )
  | Assignments          /kitforce/assignments      ( plugins.kitforce )
  | Time entries          /kitforce/time-entries    ( plugins.kitforce )

---- ADMIN ----  (always shown; pages guard on AdminProtectedRoute)
  Settings /admin/settings   Branding /admin/branding   Feature flags /admin/flags
  Numbering /admin/numbering  Members /admin/members     Billing /admin/billing
  Imports /imports           Exports /exports
```

### Mobile (`< md`) drawer

```
+----------------------------------------+
| [=] [logo]        [ws v]  [ (O) v ]    |   Topbar with hamburger
+----------------------------------------+
   tap [=] ->
+------------------+ . . . . . . . . . . .   slide-in w-64 drawer over a
| [x]              | .  dimmed backdrop  .   black/40 backdrop. Pathname
| DASHBOARD        | .                   .   change closes it automatically.
| v SELL ...       | .                   .
+------------------+ . . . . . . . . . . .
```

---

## 2. Navigation map (sitemap)

Two URL namespaces exist and do not fully match the job-mode IA above. This is a
known overhaul decision point (folder-versus-URL drift, plugin-gate gap on
invoicing/finance). The route guard column: P = protected, A = admin, X = public,
T = portal.

```
/signin ...................................... X   auth
/auth/recovery ............................... X   set-a-new-password
/no-active-org ............................... X   hard-stop surface
/feature-unavailable ......................... X
/404 ......................................... X

/dashboard ................................... P   operator home
/dashboard/summary ........................... P
/search ...................................... P   global search results
/account/security ............................ P   set/change password

CRM (/crm)
  /crm/customers  [list|new|:id|:id/edit] .... P
  /crm/contacts   [list|new|:id|:id/edit] .... P
  /crm/activities [list|new] ................. P
  /crm/leads      [board|new|:id|:id/edit|:id/convert] . P
  /crm/opportunities [pipeline|new|:id|:id/edit] ...... P

3PL OPERATIONS (/3pl-operations)            ( plugins.three_pl gates the whole tree )
  items, sales-config/{taxes,currencies,exchange-rates,payment-methods,
        pricing-tiers}, vas, quotes, projects, vendors, purchase-orders,
        vendor-bills, expenses, warehouses, boms, stock/{levels,movements},
        receiving, production (legacy redirect -> manufacturing), shipments
        each as [list|new|:id|:id/edit] where the entity supports it

INVOICING (/invoicing)                       ( NOT plugin-gated today )
  /invoicing/invoices      [list|new|:id|:id/send]
  /invoicing/payments      [list|:id/apply]
  /invoicing/credit-notes  [list|:id|:id/apply]

FINANCE (/finance)                           ( NOT plugin-gated today )
  /finance/coa             [list|new|:id/edit]
  /finance/journal-entries [list|new|:id]
  /finance/period-close    (admin guard)

MANUFACTURING (/manufacturing)               ( plugins.manufacturing )
  home, runs [list|new|from-bom|:id]

CO-PACK AND ECOM (/copack)                   ( plugins.copack_ecom )
  home, orders, kitting, channels, fulfillments  ([list|new|:id] per entity)

KITCOST (/kitcost)                           ( plugins.kitcost )
  /kitcost/dashboard

KITFORCE (/kitforce)                         ( plugins.kitforce )
  home, members, teams, shifts, assignments, time-entries

ADMIN (/admin)                               ( AdminProtectedRoute: owner/admin )
  settings, branding, flags, numbering, members, billing
  /imports [wizard|history], /exports

PORTAL (/portal)                             ( separate chrome, T guard )
  /portal/signin (X), /portal, /portal/invoices, /portal/quotes, /portal/projects
```

---

## 3. Page archetypes

Most of the 154 pages are one of six archetypes. Overhaul leverage comes from
turning each archetype into a shared scaffold.

### 3a. Dashboard (`pages/DashboardPage.tsx`)

```
+-------------------------------------------------------------------+
|  BUILT TO SHIP.                                          (h1 6xl) |
|  Signed in to {appName}. Your work for the day is below.          |
|                                                                   |
|  [ SetupCompleteCelebration ]   (one-shot, only when setup done)  |
|                                                                   |
|  --- when setup INCOMPLETE: guided checklist ------------------   |
|  +-----------------------------------------------------------+    |
|  | SET UP YOUR WORKSPACE              {3 of 7 complete}      |    |
|  | [x] Add a customer        [ ] Create an item             |    |
|  | [x] Invite a teammate     [ ] Add a warehouse ...        |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  --- when setup COMPLETE: TODAY work cards (4-up grid) --------   |
|  TODAY                                                            |
|  +-----------+ +-----------+ +-----------+ +-----------+          |
|  | {n}       | | {n}       | | {n}       | | {n}       |          |
|  | Quotes    | | Runs in   | | Shipments | | Unpaid    |          |
|  | awaiting  | | production| | ready     | | invoices  |          |
|  | approval  | |           | |           | |           |          |
|  +-----------+ +-----------+ +-----------+ +-----------+          |
|   each card deep-links into a filtered list                       |
|                                                                   |
|  PILLARS  (PillarGrid: tiles per enabled pillar plugin)           |
|  +--------+ +--------+ +--------+ +--------+ +--------+            |
|  | 3PL    | | Mfg    | | Co-Pack| | KitFor.| | KitCost|            |
|  +--------+ +--------+ +--------+ +--------+ +--------+            |
+-------------------------------------------------------------------+
```

### 3b. List (`pages/crm/customers/CustomersListPage.tsx`, representative of ~50 lists)

```
+-------------------------------------------------------------------+
|  CUSTOMERS                                       [ NEW CUSTOMER ]  |   header
|                                                                   |
|  [ Search by name........ ]  [ All statuses v ]                   |   filter bar
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | Name        | Kind     | Status   | Email                |    |   table
|  |-------------+----------+----------+----------------------|    |
|  | {link}      | {kind}   | {status} | {email}              |    |
|  | ...                                                       |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  [ Prev ]   {page} of {n}   [ Next ]                              |   pagination
+-------------------------------------------------------------------+

Empty state (no rows, no filters): ListEmptyState component
  +-----------------------------------------------------------+
  |  No customers yet.                                        |
  |  Customers are the businesses you sell to. Add one to     |
  |  start a quote.                       [ Add customer ]    |
  +-----------------------------------------------------------+

Note (overhaul): table, header, filter bar, and pagination are hand-rolled per
page. Status renders as raw text (no badge). Pagination is client-side slice().
```

### 3c. Detail with state machine (`pages/3pl-operations/quotes/QuoteDetailPage.tsx`)

The richest archetype. Drives every transactional entity (quotes, invoices,
projects, runs, shipments, POs, kitting jobs, fulfillments). Combines:
Breadcrumbs, a StateStepper, a state pill, FSM action buttons gated by capability,
a line-item editor with an ItemPicker, money totals, a NextStepCTA, and an
AuditTimeline.

```
+-------------------------------------------------------------------+
|  Quotes / {QUOTE-0001}                                  Breadcrumbs|
|                                                                   |
|  QUOTE-0001                                  [ state: Draft ]     |   header + state pill
|  Customer: {link to customer}                                     |
|                                                                   |
|  ( o )---( o )---( o )---( o )   StateStepper                     |
|  Draft  Sent   Approved  Won     (off-path states shown distinct) |
|                                                                   |
|  [ Send for approval ]  [ Approve ]  [ Revise ]  [ Cancel ]      |   FSM actions
|  [ Send to customer ]   [ Convert to project ]  [ Download PDF ] |   (each cap-gated;
|                                                  PDF off in Draft) |    canTransition + hasCap)
|                                                                   |
|  >> NextStepCTA: "Send this quote for approval to move forward."  |   coaching banner
|                                                                   |
|  LINE ITEMS                                                       |
|  +-----------------------------------------------------------+    |
|  | SKU | Description | Qty | Unit | Tax | Disc | Amount | [x]|    |
|  |-----+-------------+-----+------+-----+------+--------+----|    |
|  | ... lines ...                                             |    |
|  +-----------------------------------------------------------+    |
|  Add line: [ ItemPicker v ] [Qty] [Unit$] [Tax%] [Disc%] [Add]   |
|                                       Subtotal / Tax / Total $    |
|                                                                   |
|  ACTIVITY                                                         |
|  +-----------------------------------------------------------+    |
|  | AuditTimeline: state transitions, who/when, hash-chained  |    |
|  +-----------------------------------------------------------+    |
+-------------------------------------------------------------------+
```

### 3d. Create / Edit form (`pages/*/[Entity]CreatePage.tsx`, `[Entity]EditPage.tsx`)

```
+-------------------------------------------------------------------+
|  Customers / New customer                               Breadcrumbs|
|                                                                   |
|  NEW CUSTOMER                                          (h1)       |
|                                                                   |
|  FormGrid (label/control pairs)                                  |
|  +-----------------------------------------------------------+    |
|  | Display name    [ TextInput.................... ]         |    |
|  | Kind            [ select v ]                              |    |
|  | Primary email   [ TextInput.................... ]         |    |
|  | Currency        [ picker  v ]                             |    |
|  | Amount fields   [ DollarInput ] cents-safe               |    |
|  +-----------------------------------------------------------+    |
|  inline Zod validation messages under each control               |
|                                                                   |
|                              [ Cancel ]   [ Save ]               |
+-------------------------------------------------------------------+

Shared form primitives: FormGrid, TextInput, DollarInput, PercentInput,
QuantityInput, LineItemsEditor, entity pickers (Customer/Item/Vendor/Quote/
Invoice/Project). Validation: useState plus Zod safeParse (no form library).
```

### 3e. Board / Pipeline (`pages/crm/leads/LeadsKanbanPage.tsx`, `OpportunitiesPipelinePage.tsx`)

Verified against source. Both read the full list once and group client-side. Columns
come from the entity state machine. Drag-and-drop is NOT wired yet (a transition
patch endpoint is a follow-up); cards are read-only links into the detail page.

Leads (5 columns from `leadStateMachine.states`):

```
+-------------------------------------------------------------------+
|  LEADS                                               [ New lead ]  |
|                                                                   |
|  +----------+ +----------+ +----------+ +----------+ +----------+ |
|  |{STATE}(n)| |{STATE}(n)| |{STATE}(n)| |{STATE}(n)| |{STATE}(n)| |
|  |----------| |----------| |----------| |----------| |----------| |
|  | name     | | name     | |          | |          | |          | |
|  | company  | | company  | |          | |          | |          | |
|  +----------+ +----------+ +----------+ +----------+ +----------+ |
|   card = display_name (link) + company_name. No drag-drop.        |
+-------------------------------------------------------------------+
```

Opportunities (titled PIPELINE, 6 columns from `opportunityStageMachine.states`):

```
+-------------------------------------------------------------------+
|  PIPELINE                                    [ New opportunity ]   |
|                                                                   |
|  +--------+ +--------+ +--------+ +--------+ +--------+ +--------+ |
|  |{STG}(n)| |{STG}(n)| |{STG}(n)| |{STG}(n)| |{STG}(n)| |{STG}(n)| |
|  | total  | | total  | | ...    |                                | |
|  | cents: | | cents: |                                          | |
|  |--------| |--------|                                          | |
|  | name   | | name   |                                          | |
|  | {cents}| | {cents}|                                          | |
|  +--------+ +--------+ +--------+ +--------+ +--------+ +--------+ |
|   OVERHAUL FLAG: column total and per-card amount render RAW       |
|   amount_cents (font-mono), not formatCents. Money-format gap.     |
+-------------------------------------------------------------------+
```

### 3f. Pillar home (`pages/copack/CoPackHomePage.tsx`, `manufacturing/ManufacturingHomePage.tsx`, `kitforce/KitForceHomePage.tsx`)

```
+-------------------------------------------------------------------+
|  CO-PACK AND ECOM                                                 |
|  {one-line pillar description}                                    |
|                                                                   |
|  +-----------+ +-----------+ +-----------+ +-----------+          |
|  | Orders    | | Kitting   | | Channels  | | Fulfill.  |          |
|  | {count}   | | {count}   | | {count}   | | {count}   |          |
|  | ->        | | ->        | | ->        | | ->        |          |
|  +-----------+ +-----------+ +-----------+ +-----------+          |
|   entry tiles into the pillar sub-surfaces                        |
+-------------------------------------------------------------------+
```

---

## 4. Admin surfaces

### 4a. Team / Members (`pages/admin/MembersPage.tsx`)

Verified against source. Titled TEAM (not "Members"). Two stacked sections: a live
members table, then an invite form card below it (not a top-right button or modal).

```
+-------------------------------------------------------------------+
|  TEAM                                                             |
|  Add staff members to your workspace. Each teammate signs in      |
|  with a magic link sent to their email.                          |
|                                                                   |
|  [users] TEAM MEMBERS                                            |
|  +-----------------------------------------------------------+    |
|  | NAME        | EMAIL        | ROLE     | JOINED | ACTIONS   |    |
|  |-------------+--------------+----------+--------+----------|    |
|  | {name} (you)| {email}      | [chip]   | {rel}  | none      |    |
|  | {name}      | {email}      | [chip]   | {rel}  | [role v]  |    |
|  |             |              |          |        | [Deactiv.]|    |
|  |             |              |          |        | [Resend]  |    |
|  | {name}(deac)| {email}      | [chip]   | {rel}  | [Reactiv.]|    |
|  +-----------------------------------------------------------+    |
|   role is an inline select (PATCH on change); Deactivate is       |
|   destructive-confirmed; Resend shows only when not yet claimed;  |
|   caller's own row has no actions. No Status column: state shows   |
|   as (you) / (deactivated) markers plus row opacity.             |
|                                                                   |
|  [user+] INVITE A TEAMMATE          (bordered form card)         |
|  +-----------------------------------------------------------+    |
|  | Email  [........................]                         |    |
|  | Role   [ select: admin/sales/ops/accounting/viewer v ]    |    |
|  | [ Send invite ]      -> success/error chip below          |    |
|  +-----------------------------------------------------------+    |
+-------------------------------------------------------------------+
```

### 4b. Settings / Branding / Feature flags / Numbering / Billing

Verified against source. Note the heading inconsistency: the CRUD and Team pages use
a 4xl uppercase display headline, but Settings, Feature flags, and Numbering use a
3xl sentence-case headline. Worth normalizing in the overhaul.

```
SETTINGS (/admin/settings)
  "Org settings" listing grouped by group_key, plus a one-row-at-a-time
  upsert form at the bottom that accepts RAW JSON text for the value
  (developer-grade surface, not polished label/control rows).

BRANDING (/admin/branding)
  App-name override, logo, palette tokens, live preview.

FEATURE FLAGS (/admin/flags)  heading "Feature flags" (3xl, sentence case)
  +-----------------------------------------------------------+
  | FLAG KEY (mono)        | STATE             | [ Disable ]  |
  | plugins.three_pl       | Enabled           | [ Disable ]  |
  | plugins.kitforce       | Disabled          | [ Enable  ]  |
  +-----------------------------------------------------------+
  per-row Enable/Disable button (no optimistic UI; waits for server).

NUMBERING (/admin/numbering)  heading "Document numbering" (3xl)
  Per-doc-type sequence seeds in a table; each row has a [ Reset ]
  action that restarts the counter at 1 (audit-relevant).

BILLING (/admin/billing)
  +-- Current plan card: status, plan name, trial countdown, period end,
  |   [ Manage in Stripe ] (hidden until a stripe_customer_id exists)
  +-- Plan grid: SIX cards (3 tiers x 2 cadences), each [ Upgrade ] ->
      Stripe Checkout. Redirect URL asserted to be a *.stripe.com https
      host before navigation. sonner toast for outcomes.
```

### 4c. Imports wizard (`pages/imports/ImportWizardPage.tsx`)

Verified against source. THREE steps, not five.

```
+-------------------------------------------------------------------+
|  IMPORT                                                           |
|  step 1: pick entity_type                                        |
|     ->  step 2: paste CSV text (or upload file) -> parse ->       |
|             validate dry-run                                      |
|     ->  step 3: review row errors -> commit                      |
|  (history at /imports/history)                                    |
+-------------------------------------------------------------------+
```

---

## 5. Auth and edge-state screens (no shell)

These render bare (no Topbar/Sidebar), centered on the bg surface with the Logo.

```
SIGN IN  (/signin)                      RECOVERY  (/auth/recovery)
+---------------------------+           +---------------------------+
|         [ Logo ]          |           |         [ Logo ]          |
|  SIGN IN                  |           |  SET A NEW PASSWORD       |
|  Email    [...........]   |           |  Built to Ship.           |
|  Password [...........]   |           |  New password [........]  |
|  [ Sign in ]              |           |  Confirm      [........]  |
|  Forgot password?         |           |  [ Set password ]         |
+---------------------------+           |  (invalid/expired -> back |
                                        |   to sign in fallback)    |
                                        +---------------------------+

NO ACTIVE WORKSPACE (/no-active-org)    NOT FOUND (/404) and
+---------------------------+           FEATURE UNAVAILABLE (/feature-unavailable)
|         [ Logo ]          |           +---------------------------+
|  NO ACTIVE WORKSPACE      |           |  centered message + a     |
|  Your account is not      |           |  link back to /dashboard  |
|  linked to a workspace.   |           |  or /signin               |
|  [ Sign Out ]             |           +---------------------------+
+---------------------------+

FIRST-SIGNIN NUDGE: a signed-in user with password_set = false is redirected
once to /account/security?welcome=1, which shows the WELCOME TO KITSTAK banner
above the set-password form (Skip-for-now allowed). Server-gated as of
F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01.
```

---

## 6. Customer portal (separate application)

The portal is a distinct chrome (`pages/portal/components/PortalTopbar.tsx`), with
no operator Sidebar. Customer users authenticate via a magic link and see only
their own org-scoped invoices, quotes, and projects.

Verified against source. The portal is more polished than the operator list pages:
it already uses a shared `StatusBadge` and `formatCents`, which the operator side
does not. Worth harvesting those patterns during the overhaul.

```
PORTAL SIGN IN (/portal/signin, public)
+---------------------------------------------+
|                 [ Logo ]                    |
|  CUSTOMER PORTAL                            |
|  Enter your email. We will send you a       |
|  sign-in link.                             |
|  Email [............................]      |
|  [ Send sign-in link ]                     |
|  -- on submit: same confirmation always --  |
|  "If {email} is registered, a link is on    |
|   its way. Expires in 1 hour, single use."  |
|  [ Send another link ]                     |
|  ---------------------------------------    |
|  Kitstak team member? Staff sign-in ->      |
+---------------------------------------------+

PORTAL TOPBAR (every /portal/* page; PortalTopbar.tsx)
+-------------------------------------------------------------------+
| [logo]  Dashboard | Invoices | Quotes | Projects   {email} [Sign out] |
+-------------------------------------------------------------------+
   active item gets an accent bottom-border. Below md: nav drops to a
   second horizontal-scroll row.

PORTAL DASHBOARD (/portal)
+-------------------------------------------------------------------+
|  Welcome, {customer display_name or email}                       |
|  Customer portal overview.                                       |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | You owe {formatCents} across {N} open invoices.          |    |  balance banner
|  |   (or "No outstanding balance.")                          |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  INVOICES  (section header is a link -> /portal/invoices)        |
|  | Number | Issued | Due | Status[badge] | Balance$ | Actions |  |  first 5 rows
|  ... [ View all invoices -> ]                                    |  Actions: pay/view
|                                                                   |
|  QUOTES    (-> /portal/quotes)                                   |
|  | Number | Issued | Status[badge] | Total$ | Actions |          |  Actions: approve/view
|  ... [ View all quotes -> ]                                      |
|                                                                   |
|  PROJECTS  (-> /portal/projects)                                 |
|  | Name | Started | Status[badge] | Est. completion |            |
|  ... [ View all projects -> ]                                    |
|                                                                   |
|  each section has independent loading / empty / error rows        |
+-------------------------------------------------------------------+

/portal/invoices, /portal/quotes, /portal/projects: full dedicated lists
of the same data the dashboard previews (first 5).
```

---

## 7. Primary end-to-end journey: quote to cash

The flow the dashboard, sidebar, and detail archetypes are all built to serve.

```
SELL                          MAKE                 SHIP            GET PAID
----                          ----                 ----            --------
Lead                          Project              Shipment        Invoice
  -> qualify                    (from quote)         (pick/pack)      (from project/quote)
Opportunity                   Manufacturing run      -> ship          -> send to customer
  -> win                      Kitting job                            Payment
Quote (Draft)                 Receiving                                -> apply
  -> send for approval                                              Credit note (if needed)
  -> Approved                                                       Period close / journal
  -> send to customer                                               Cost dashboard (KitCost)
  -> Won -> convert to project

Customer portal runs alongside: the customer approves the Quote and views/pays the
Invoice from their own chrome.
```

---

## 8. Overhaul notes carried from the routes-and-pages review

- URL namespace is inconsistent: invoicing and finance sit at top level while their
  pages live under `pages/3pl-operations/` and `pages/finance/`. Decide folder and
  URL alignment before, or explicitly out of, the visual overhaul.
- Invoicing and finance routes are not pillar-plugin-gated; the rest of 3PL is.
- The sidebar IA (six job modes) is fully decoupled from routes, so a nav regroup is
  cheap; a URL rename is expensive. See the parked pillar-reorg and job-builder specs.
- Tables, page headers, filter bars, and pagination are hand-rolled per page. The
  highest-leverage overhaul step is extracting DataTable, PageHeader, FilterBar,
  Pagination, Badge, and Select primitives, then codemodding the CRUD quartets.
- Tokens are CSS-variable driven, so a visual restyle can be largely token-level.
- Status rendering is inconsistent: the customer portal has a shared StatusBadge,
  but operator lists render status as raw lowercase text. Promote StatusBadge to
  the shared UI layer and adopt it app-wide.
- Money formatting is inconsistent: the Opportunities pipeline renders raw
  amount_cents (font-mono), while the portal and the quote/invoice detail pages use
  formatCents. Standardize on formatCents in every operator surface. (RESOLVED
  2026-06-03 in #235: the pipeline renders formatCents on the per-card amount and
  the per-column total; formatCents is now standard on every operator surface.)
- Heading style is inconsistent: CRUD and Team pages use a 4xl uppercase display
  headline; Settings, Feature flags, and Numbering use a 3xl sentence-case headline.
  Pick one heading scale and case for the overhaul.
- Button usage is inconsistent: a Button primitive exists, but list and board pages
  style raw Links/anchors as buttons (e.g. "New customer", "New lead"). Route all
  calls-to-action through the shared Button (or a ButtonLink) variant.
- The customer portal is the most polished surface in the app (shared StatusBadge,
  formatCents, per-section loading/empty/error). Use it as the reference quality bar
  the operator side should be lifted to, not just restyled.

---

## 9. Proposed overhaul direction (after)

Direction: keep the existing brand and lift the operator app to an "operator
console". Do not invent a new look. The navy/ink/accent palette, Bebas Neue display,
Inter Tight body, JetBrains Mono numerics, and the "Built to Ship." voice stay. The
change is consistency and hierarchy: a small shared primitive kit that every page
composes, so a restyle is token-level and quality is uniform.

Non-negotiables carried in: server is authority (gates unchanged), money via
formatCents, dense and fast (this is a tool, not a marketing site), WCAG 2.2 baked
into the primitives.

**STATUS: SHIPPED (F-Wave10-UI-KIT-01, complete 2026-06-03).** The kit below was
built and adopted across the entire operator app over 2026-06-02 and 2026-06-03
(PRs #213 to #235). Every list, FSM detail, create/edit form, config surface, CRM
board, and pillar home now composes the shared kit; the main DashboardPage already
composed shared components. Two tile primitives were added beyond the original 9a
list below: ActionTile and StatCard (pillar-home tiles). Three latent raw-cents
money bugs were fixed in passing (stock movements, the Opportunities pipeline
amount and column total). See STATUS.md and the closeout journal
03-workspace/journal/2026-06-03-ui-kit-overhaul-closeout.md.

### 9a. The shared primitive kit (build these first)

```
PageHeader     eyebrow (mode/breadcrumb) + title + primary action + meta line
FilterBar      search + faceted filters + active-filter chips + density toggle
DataTable      sticky header, sortable, mono right-aligned numerics, row menu,
               skeleton loading, integrated EmptyState, server pagination
StatusBadge    state -> semantic token (promote from portal, map every FSM state)
Pagination     server-driven: range, page jumps, page-size select
Money          formatCents everywhere; never raw amount_cents in UI
Button         one component for every CTA; ButtonLink variant for nav CTAs
Card / Section consistent surface, header, and padding rhythm
DetailLayout   two-column: main content + right rail (status, facts, activity)
ActionTile     pillar-home nav tile: bordered link, display title + body
StatCard       pillar-home count tile: big count + label, links to a filtered list
```

Semantic status tokens (within the existing palette, not new hues invented ad hoc):

```
neutral   ink-dim outline      Draft, New, Open
info      muted blue token     Sent, Submitted, In review
progress  ink/accent tint      Started, Picking, Packing
success   success token        Approved, Won, Paid, Completed
danger    accent (red)         Lost, Void, Overdue, Cancelled
```

### 9b. List archetype (after) - `<PageHeader>` + `<FilterBar>` + `<DataTable>`

```
+----------------------------------------------------------------------+
|  SELL / Quotes                                       (eyebrow, mono)  |
|  QUOTES                                       [ + New quote ]         |
|  312 total  .  8 awaiting approval                  (meta summary)    |
|  ------------------------------------------------------------------   |
|  [ search.............. ]  [ Status v ] [ Customer v ] [ Date v ] [=]|  FilterBar
|  Status: Sent (x)   Customer: Acme (x)                   [ Clear ]   |  active chips
|  +----------------------------------------------------------------+   |
|  | NUMBER ^   | CUSTOMER  | STATUS     |     TOTAL |   UPDATED  :  |   |  DataTable
|  |------------+-----------+------------+-----------+------------+--|   |  sticky, sortable
|  | QUOTE-0007 | Acme Co   | (Sent)     |    $1,240 |  2h ago    : |   |  money right/mono
|  | QUOTE-0006 | Beta LLC  | (Approved) |   $12,500 |  1d ago    : |   |  : = row menu
|  | QUOTE-0005 | Gamma Inc | (Draft)    |      $980 |  3d ago    : |   |  StatusBadge
|  +----------------------------------------------------------------+   |
|  Rows 1-50 of 312       [<]  1  2  3 ... 7  [>]      [ 50 / page v ] |  server pagination
+----------------------------------------------------------------------+

  loading -> shimmer skeleton rows in the same grid (no layout shift)
  empty    -> integrated EmptyState inside the table frame (keeps the toolbar)
```

Before-to-after, same screen: the title becomes a `PageHeader` with an eyebrow and a
summary line; the raw `<Link>` CTA becomes a `Button`; the bare search+select becomes
a `FilterBar` with removable chips; the hand-rolled `<table>` becomes a `DataTable`
with sortable headers, a status badge, right-aligned mono money, a row overflow menu,
and server pagination replacing the client-side slice.

### 9c. FSM detail archetype (after) - `<DetailLayout>` two-column

```
+----------------------------------------------------------------------+
|  SELL / Quotes / QUOTE-0001                                          |
|  QUOTE-0001   (Sent)                  [ Approve ]   [ ...overflow ]  |  title+badge+primary+menu
|  ------------------------------------------------------------------   |
|  +--------------------------------+  +----------------------------+  |
|  | >> NEXT STEP                   |  | STATUS                     |  |  RIGHT RAIL
|  |    Approve to convert to a     |  | ( o )                      |  |  vertical StateStepper
|  |    project.   [ Approve ]      |  |  |  Draft        done      |  |
|  |                                |  | ( o )                      |  |
|  | LINE ITEMS                     |  |  |  Sent         current   |  |
|  | +----------------------------+ |  | ( o ) Approved            |  |
|  | | DataTable: SKU/Qty/Unit/.. | |  | ( o ) Won                 |  |
|  | +----------------------------+ |  |                            |  |
|  | + add line [ ItemPicker v ]    |  | KEY FACTS                  |  |
|  |                                |  | Customer   Acme Co  ->     |  |
|  |             Subtotal   $1,100  |  | Currency   USD             |  |
|  |             Tax        $  140  |  | Issued     2026-06-01      |  |
|  |             Total      $1,240  |  | Owner      mike            |  |
|  |                                |  |                            |  |
|  |                                |  | ACTIVITY                   |  |
|  |                                |  | AuditTimeline (compact)    |  |
|  +--------------------------------+  +----------------------------+  |
+----------------------------------------------------------------------+

  Same building blocks already exist (StateStepper, NextStepCTA, AuditTimeline,
  line-item editor). The overhaul reorganizes them into a stable two-column
  DetailLayout so every transactional entity reads identically: action and state
  at the top, work in the main column, context in the rail.
```

### 9d. Dashboard (after) - metric cards + bento pillars

```
+----------------------------------------------------------------------+
|  BUILT TO SHIP.                                                      |
|  {date} . Signed in to {appName}.                                    |
|                                                                      |
|  TODAY                                                               |
|  +-------------+ +-------------+ +-------------+ +-------------+      |
|  | 8           | | 3           | | 12          | | 5           |     |  metric cards:
|  | Quotes      | | Runs in     | | Shipments   | | Unpaid      |     |  big number,
|  | to approve  | | production  | | to ship     | | invoices    |     |  label, deep link,
|  | ->          | | ->          | | ->          | | $ due ->    |     |  optional trend
|  +-------------+ +-------------+ +-------------+ +-------------+      |
|                                                                      |
|  PILLARS                                          (bento, not 5 equal)|
|  +---------------------+ +-----------+ +-----------+                  |
|  | 3PL Operations      | | Co-Pack   | | KitForce  |                 |
|  | quotes/ship/invoice | | orders... | | shifts... |                 |
|  +---------------------+ +-----------+ +-----------+                  |
|  | Manufacturing       | | KitCost (cost dashboard)             |    |
|  +---------------------+ +--------------------------------------+    |
+----------------------------------------------------------------------+

  Setup-incomplete state keeps the guided SetupChecklist (it works well already).
```

### 9e. Board archetype (after) - real kanban

```
+----------------------------------------------------------------------+
|  SELL / Pipeline                                                     |
|  PIPELINE                                     [ + New opportunity ]  |
|  ------------------------------------------------------------------   |
|  +------------+ +------------+ +------------+ +------------+          |
|  | QUALIFY  4 | | PROPOSE  3 | | NEGOTIATE 2| | WON      6 |  ...     |  column = stage
|  | $42,000    | | $18,500    | | $90,000    | | $210,000   |          |  count + formatCents sum
|  |------------| |------------| |------------| |------------|          |
|  | +--------+ | | +--------+ | | +--------+ | | +--------+ |          |  card:
|  | | Acme   | | | | Beta   | | | | Gamma  | | | | Delta  | |          |   name
|  | | $12,500| | | | $6,000 | | | | $45,000| | | | $80,000| |          |   formatCents (not raw)
|  | | Acme Co| | | | ...    | | | |        | | | |        | |          |   customer
|  | +--------+ | | +--------+ | | +--------+ | | +--------+ |          |
|  +------------+ +------------+ +------------+ +------------+          |
|   drag a card between columns to transition (wires the patch endpoint)|
+----------------------------------------------------------------------+

  Fixes the current raw-cents display and the missing drag-drop in one pass.
```

### 9f. Token and chrome refinements (small, high-impact)

```
- Normalize headings: one display scale + case for page titles (kill the
  3xl-sentence-case vs 4xl-uppercase split). Recommend 4xl uppercase Bebas for
  page titles, 2xl for section headers, both with the existing tracking.
- Add a density token set (comfortable / compact) so DataTable rows can tighten
  for power users without per-page edits.
- Add subtle elevation + radius tokens for Card and popover surfaces (today most
  surfaces are flat 1px borders; a small, consistent shadow scale adds depth
  without going glassy).
- Keep motion compositor-only (transform/opacity): row hover, drawer slide,
  badge state changes. No layout-animating properties.
```

### 9g. Migration sequence (so it ships incrementally, not as a big bang)

```
1. Build the kit (9a) against existing CSS-variable tokens. No page edits yet.
2. Promote StatusBadge out of pages/portal into components/ui; add the state map.
3. Convert ONE vertical end-to-end as the reference: Quotes
   (list -> detail -> create/edit) using PageHeader/FilterBar/DataTable/DetailLayout.
4. Codemod the remaining CRUD quartets list-by-list; each PR swaps primitives only.
5. Fold server-side pagination into DataTable adoption (kills the .slice() pattern,
   closes F-WS7-SERVER-PAGINATION).
6. Dashboard + boards last (most bespoke); enable kanban drag-drop with the kit.
7. Token/chrome pass (9f) once enough pages are on the kit to see it system-wide.

Each step is independently shippable and keeps CI green (bundle budget: the kit
must stay out of the index chunk or be tiny; byte-mirrored canon untouched).
```

**Sequence complete 2026-06-03.** Steps 1 to 4 shipped across PRs #213 to #235
(the boards and pillar homes landed in #235). Step 6 shipped for the boards and
pillar homes; the main dashboard already composed shared components, and kanban
drag-drop stays deferred (the boards keep their hand-rolled columns). Step 5
(server pagination) is the carried follow-up F-WS7-SERVER-PAGINATION, and column
sort is F-Wave10-UI-KIT-DATATABLE-SORT-01. Step 7 (token and chrome pass) is now
unblocked.
