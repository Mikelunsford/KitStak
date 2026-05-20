// search-api: GET /search?q=...
//
// Global search across customers, quotes, invoices, projects. v1 ships an
// ILIKE multi-table union as fallback; Wave 3+ will replace with a tsvector
// + GIN index per a future migration. Results are grouped by entity_type and
// trimmed to TOP_PER_GROUP per entity to keep payloads bounded.

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
          href: `/sales/customers/${r.id}`,
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
          href: `/sales/quotes/${r.id}`,
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
          href: `/billing/invoices/${r.id}`,
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
          href: `/sales/projects/${r.id}`,
        }));
        if (items.length > 0) groups.project = items;
      }
    }

    const result: SearchResult = { query: q, groups };
    return ok(result);
  },
};

Deno.serve((req) => route(req, [globalSearch], { bundle: BUNDLE }));

export { globalSearch };
