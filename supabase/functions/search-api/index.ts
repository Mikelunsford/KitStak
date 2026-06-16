// search-api: GET /search?q=...
//
// Global search across customers, quotes, invoices, projects, items, and job
// runs. v1 ships an ILIKE multi-table union as fallback; Wave 3+ will replace
// with a tsvector + GIN index per a future migration. Results are grouped by
// entity_type and trimmed to TOP_PER_GROUP per entity to keep payloads
// bounded.
//
// Every per-table read is org-scoped with .eq('org_id', caller.orgId) on top
// of the service-role admin client, so the multi-tenant boundary is enforced
// in the handler exactly as the four original groups already do. A query that
// matches no rows in the caller's org returns 200 with no group, never a
// cross-tenant leak.

import { route, type Route } from '../_shared/route.ts';
import { admin, requireCap } from '../_shared/handler-helpers.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import type {
  SearchResult,
  SearchResultItem,
} from '../_shared/types/cross_cutting.ts';

const BUNDLE = 'search-api';
const TOP_PER_GROUP = 10;

function escapeIlike(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`);
}

const globalSearch: Route = {
  method: 'GET',
  path: '/search',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    requireCap(caller, 'search.global.read');

    const q = url.searchParams.get('q')?.trim() ?? '';
    if (q.length === 0) {
      const empty: SearchResult = { query: q, groups: {} };
      return ok(empty);
    }
    if (q.length > 200) {
      throw new ApiError('VALIDATION_ERROR', 422, 'q must be 200 chars or fewer');
    }

    const pattern = `%${escapeIlike(q)}%`;
    const client = admin();
    const groups: SearchResult['groups'] = {};

    // Customers
    {
      const { data, error } = await client
        .from('customers')
        .select('id, display_name, email')
        .eq('org_id', caller.orgId)
        .ilike('display_name', pattern)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'customer',
          entity_id: r.id,
          title: r.display_name as string,
          subtitle: (r.email as string | null) ?? null,
          href: `/crm/customers/${r.id}`,
        }));
        if (items.length > 0) groups.customer = items;
      }
    }

    // Quotes
    {
      const { data, error } = await client
        .from('quotes')
        .select('id, number, status')
        .eq('org_id', caller.orgId)
        .ilike('number', pattern)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'quote',
          entity_id: r.id,
          title: r.number as string,
          subtitle: (r.status as string | null) ?? null,
          href: `/3pl-operations/quotes/${r.id}`,
        }));
        if (items.length > 0) groups.quote = items;
      }
    }

    // Invoices
    {
      const { data, error } = await client
        .from('invoices')
        .select('id, number, status')
        .eq('org_id', caller.orgId)
        .ilike('number', pattern)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'invoice',
          entity_id: r.id,
          title: r.number as string,
          subtitle: (r.status as string | null) ?? null,
          href: `/invoicing/invoices/${r.id}`,
        }));
        if (items.length > 0) groups.invoice = items;
      }
    }

    // Projects
    {
      const { data, error } = await client
        .from('projects')
        .select('id, name, status')
        .eq('org_id', caller.orgId)
        .ilike('name', pattern)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'project',
          entity_id: r.id,
          title: r.name as string,
          subtitle: (r.status as string | null) ?? null,
          href: `/3pl-operations/projects/${r.id}`,
        }));
        if (items.length > 0) groups.project = items;
      }
    }

    // Items. Match on either the SKU or the display name so an operator can
    // pull a catalog record by code or by what it is called. Excludes
    // soft-deleted rows. The title leads with the SKU; the name carries as the
    // subtitle so the SKU is the scannable anchor in the result list.
    //
    // The two-column match uses .or(); the ILIKE values are double-quoted so a
    // comma or parenthesis in the query text cannot break out of the PostgREST
    // .or() grammar. escapeIlike still neutralises the %/_/\ wildcards, and any
    // double quote in the input is doubled per PostgREST quoting rules.
    {
      const orValue = `*${escapeIlike(q).replace(/"/g, '""')}*`;
      const { data, error } = await client
        .from('items')
        .select('id, sku, name')
        .eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .or(`sku.ilike."${orValue}",name.ilike."${orValue}"`)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'item',
          entity_id: r.id,
          title: r.sku as string,
          subtitle: (r.name as string | null) ?? null,
          href: `/catalog/items/${r.id}`,
        }));
        if (items.length > 0) groups.item = items;
      }
    }

    // Job runs. Match on the run number (the JR- job number an operator reads
    // off the floor). Excludes soft-deleted rows. run_number is nullable on
    // the table, so an unnumbered draft run never matches the ILIKE.
    {
      const { data, error } = await client
        .from('job_runs')
        .select('id, run_number, status')
        .eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .ilike('run_number', pattern)
        .limit(TOP_PER_GROUP);
      if (!error && data) {
        const items: SearchResultItem[] = data.map((r) => ({
          entity_type: 'job_run',
          entity_id: r.id,
          title: (r.run_number as string | null) ?? '',
          subtitle: (r.status as string | null) ?? null,
          href: `/3pl-operations/job-runs/${r.id}`,
        }));
        if (items.length > 0) groups.job_run = items;
      }
    }

    const result: SearchResult = { query: q, groups };
    return ok(result);
  },
};

Deno.serve((req) => route(req, [globalSearch], { bundle: BUNDLE }));

export { globalSearch };
