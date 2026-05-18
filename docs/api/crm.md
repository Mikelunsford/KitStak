# crm-api

Wave 2 / Agent B. The crm-api edge bundle ships customers, contacts,
activities, leads, and opportunities. Tenant scope: RLS Pattern A on every
table; handlers also filter by `org_id = caller.orgId` defense in depth.

All non-GET routes enforce `Idempotency-Key` (UUID v4) and require a CRM
capability via `requireCrmCap()`. All list responses paginate by cursor on
`(created_at desc, id desc)` with `?limit=` clamped to [1, 200].

## Routes

### Customers

| Method | Path | Capability |
| --- | --- | --- |
| GET | /customers | crm.customers.read |
| POST | /customers | crm.customers.write |
| GET | /customers/:id | crm.customers.read |
| PATCH | /customers/:id | crm.customers.write |
| DELETE | /customers/:id | crm.customers.delete |

DELETE is soft (sets `deleted_at`).

### Contacts

| Method | Path | Capability |
| --- | --- | --- |
| GET | /contacts | crm.contacts.read |
| POST | /contacts | crm.contacts.write |
| GET | /contacts/:id | crm.contacts.read |
| PATCH | /contacts/:id | crm.contacts.write |
| DELETE | /contacts/:id | crm.contacts.delete |

List supports `?customer_id=<uuid>` to filter by parent customer.

### Activities

| Method | Path | Capability |
| --- | --- | --- |
| GET | /activities | crm.activities.read |
| POST | /activities | crm.activities.write |
| GET | /activities/:id | crm.activities.read |
| PATCH | /activities/:id | crm.activities.write |

Polymorphic against `entity_type` in (`customer`, `contact`, `lead`,
`opportunity`). List supports `?entity_type=&entity_id=`.

### Leads

| Method | Path | Capability |
| --- | --- | --- |
| GET | /leads | crm.leads.read |
| POST | /leads | crm.leads.write |
| GET | /leads/:id | crm.leads.read |
| PATCH | /leads/:id | crm.leads.write |
| POST | /leads/:id/convert | crm.leads.convert |

State machine (`_shared/workflow/crm.ts` `leadStateMachine`):
`new -> working -> qualified -> converted` plus side exits to `disqualified`.
`PATCH /:id` rejects a status move to `converted` with 409; clients must use
the convert endpoint, which wraps `public.convert_lead` for atomicity.

### Opportunities

| Method | Path | Capability |
| --- | --- | --- |
| GET | /opportunities | crm.opportunities.read |
| POST | /opportunities | crm.opportunities.write |
| GET | /opportunities/:id | crm.opportunities.read |
| PATCH | /opportunities/:id | crm.opportunities.write |
| POST | /opportunities/:id/transition | crm.opportunities.stage.transition |

Stage machine (`opportunityStageMachine`): `discovery -> evaluation -> proposal
-> negotiation -> closed_won / closed_lost`. Generic PATCH rejects a stage
field with 409; the transition endpoint runs `canCrmTransition` before the
UPDATE and stamps `closed_at` on closed_won / closed_lost.

## Errors

Standard envelope from `_shared/responses.ts`:

```
{
  "error": {
    "code": "STATE_CONFLICT",
    "message": "illegal lead transition new -> converted",
    "details": {}
  }
}
```

`404 NOT_FOUND` is returned for cross-tenant ids (RLS hides them). `403
FORBIDDEN` is returned for capability gaps. `409 STATE_CONFLICT` for illegal
transitions or already-converted leads.
