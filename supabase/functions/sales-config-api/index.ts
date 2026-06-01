// sales-config-api: CRUD for the sales-chassis configuration tables.
// Tables: taxes, payment_methods, currencies (read-only), exchange_rates,
// pricing_tiers, customer_pricing_overrides, value_added_services, job_types,
// items, item_categories, units.
//
// Routing: flat `Route[]` dispatched via `_shared/route.ts`. Every non-GET
// goes through `respondWithIdempotency` + `requireCap`. RLS lives in the DB;
// handlers still pass an explicit `.eq('org_id', caller.orgId)` filter so a
// caller without an org claim cannot read another org's row.
//
// BUNDLE GATE (cross-pillar OR predicate). Constitutional rule
// (CLAUDE.md / 00-canon): plugin bundle gates return 404 NOT_FOUND when the
// caller's org lacks the plugin. taxes/items/payment-methods/pricing-tiers
// /currencies are CROSS-PILLAR config: the 3PL, Manufacturing, and Co-Pack
// surfaces all read and write them (e.g. the ItemPicker on quotes, invoices,
// sales orders, kitting jobs, and manufacturing runs). Gating on a single
// pillar flag would lock out a manufacturing-only or copack-only org that
// legitimately needs taxes and items. The gate therefore passes when ANY of
// the three commerce pillar plugins is enabled, and returns 404 only when ALL
// are off. Closes F-Wave9-SALES-CONFIG-3PL-GATE-01.

import { z } from 'zod';

import { type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseLimit, paginate, parseUuidParam, respondWithIdempotency,
  created, requireCap,
} from '../_shared/handler-helpers.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import { type Capability } from '../_shared/capabilities.ts';
import {
  CreateQuoteRequestSchema,
} from '../_shared/types/sales.ts';

const BUNDLE = 'sales-config-api';

// --- request schemas for config tables ---

const TaxWriteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rate_bps: z.number().int().min(0).max(100_000),
  is_compound: z.boolean().default(false),
  is_active: z.boolean().default(true),
  default_for_org: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

const PaymentMethodWriteSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['manual', 'ach', 'wire', 'card', 'check', 'other']).default('manual'),
  is_active: z.boolean().default(true),
  default_for_org: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

const PricingTierWriteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  discount_bps: z.number().int().min(0).max(100_000).default(0),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const ExchangeRateWriteSchema = z.object({
  base_currency_code: z.string().length(3),
  quote_currency_code: z.string().length(3),
  rate_e9: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  effective_date: z.string(),
  source: z.string().default('manual'),
});

const ItemWriteSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  unit_id: z.string().uuid().nullable().optional(),
  kind: z.enum(['product', 'service', 'kit', 'subscription', 'bundle']).default('product'),
  unit_price_cents: z.union([z.number().int().min(0), z.string().regex(/^\d+$/)]).default(0),
  unit_cost_cents: z.union([z.number().int().min(0), z.string().regex(/^\d+$/)]).nullable().optional(),
  currency_code: z.string().length(3).default('USD'),
  default_tax_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
  is_taxable: z.boolean().default(true),
  is_sellable: z.boolean().default(true),
  is_purchasable: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

const ItemCategoryWriteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  parent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const UnitWriteSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  is_active: z.boolean().default(true),
});

const VasWriteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: z.enum(['flat', 'per_unit', 'hourly', 'tiered']).default('flat'),
  base_price_cents: z.union([z.number().int().min(0), z.string().regex(/^\d+$/)]).default(0),
  currency_code: z.string().length(3).default('USD'),
  default_tax_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
});

const JobTypeWriteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const SetDefaultBodySchema = z.object({});

// --- generic CRUD ---

function genericList(table: string, orderCol = 'created_at') {
  return async (ctx: RouteCtx) => {
    const caller = requireCaller(ctx.req);
    requireCap(caller, capForRead(table));
    const limit = parseLimit(ctx.url);
    const client = admin();
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order(orderCol, { ascending: false })
      .limit(limit + 1);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    const rows = data ?? [];
    return ok(paginate(rows as Array<{ id: string; created_at: string }>, limit));
  };
}

function genericGet(table: string) {
  return async (ctx: RouteCtx) => {
    const caller = requireCaller(ctx.req);
    requireCap(caller, capForRead(table));
    parseUuidParam(ctx.params.id);
    const client = admin();
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('id', ctx.params.id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(data);
  };
}

function capForRead(table: string): Capability {
  switch (table) {
    case 'taxes': return 'taxes.tax.read';
    case 'payment_methods': return 'payment_methods.method.read';
    case 'pricing_tiers': return 'pricing_tiers.tier.read';
    case 'customer_pricing_overrides': return 'pricing_tiers.override.read';
    case 'items': return 'items.item.read';
    case 'item_categories': return 'items.category.read';
    case 'units': return 'items.unit.read';
    case 'value_added_services': return 'vas.service.read';
    case 'job_types': return 'jobs.job_type.read';
    case 'exchange_rates': return 'currencies.exchange_rate.read';
    default: return 'items.item.read';
  }
}

function capForWrite(table: string): Capability {
  switch (table) {
    case 'taxes': return 'taxes.tax.write';
    case 'payment_methods': return 'payment_methods.method.write';
    case 'pricing_tiers': return 'pricing_tiers.tier.write';
    case 'customer_pricing_overrides': return 'pricing_tiers.override.write';
    case 'items': return 'items.item.write';
    case 'item_categories': return 'items.category.write';
    case 'units': return 'items.unit.write';
    case 'value_added_services': return 'vas.service.write';
    case 'job_types': return 'jobs.job_type.write';
    case 'exchange_rates': return 'currencies.exchange_rate.write';
    default: return 'items.item.write';
  }
}

function genericCreate<S extends z.ZodTypeAny>(table: string, schema: S, route: string) {
  return async (ctx: RouteCtx) => {
    const caller = requireCaller(ctx.req);
    requireCap(caller, capForWrite(table));
    const body = await parseBody(ctx.req, schema);
    return respondWithIdempotency(
      ctx.req, caller, BUNDLE, route, body,
      async () => {
        const client = admin();
        const insert = {
          ...(body as Record<string, unknown>),
          org_id: caller.orgId,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await client
          .from(table).insert(insert).select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(data);
      },
    );
  };
}

function genericUpdate<S extends z.ZodTypeAny>(table: string, schema: S, route: string) {
  return async (ctx: RouteCtx) => {
    const caller = requireCaller(ctx.req);
    requireCap(caller, capForWrite(table));
    parseUuidParam(ctx.params.id);
    const body = await parseBody(ctx.req, schema);
    return respondWithIdempotency(
      ctx.req, caller, BUNDLE, route, body,
      async () => {
        const client = admin();
        const patch = {
          ...(body as Record<string, unknown>),
          updated_by: caller.userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client
          .from(table).update(patch)
          .eq('id', ctx.params.id).eq('org_id', caller.orgId)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(data);
      },
    );
  };
}

function genericSoftDelete(table: string, route: string) {
  return async (ctx: RouteCtx) => {
    const caller = requireCaller(ctx.req);
    requireCap(caller, capForWrite(table));
    parseUuidParam(ctx.params.id);
    return respondWithIdempotency(
      ctx.req, caller, BUNDLE, route, null,
      async () => {
        const client = admin();
        const { data, error } = await client
          .from(table)
          .update({
            deleted_at: new Date().toISOString(),
            updated_by: caller.userId,
          })
          .eq('id', ctx.params.id).eq('org_id', caller.orgId)
          .select('id').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: data.id, deleted: true });
      },
    );
  };
}

// --- set_default RPCs ---

const setDefaultTax = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'taxes.tax.set_default');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/taxes/:id/set-default', {},
    async () => {
      const client = admin();
      const { error } = await client.rpc('set_default_tax', { p_tax_id: ctx.params.id });
      if (error) {
        if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
        if (/FORBIDDEN/.test(error.message)) throw new ApiError('FORBIDDEN', 403);
        throw new ApiError('INTERNAL_ERROR', 500, error.message);
      }
      return ok({ id: ctx.params.id, default_for_org: true });
    },
  );
};

const setDefaultPaymentMethod = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'payment_methods.method.set_default');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/payment-methods/:id/set-default', {},
    async () => {
      const client = admin();
      const { error } = await client.rpc('set_default_payment_method', { p_method_id: ctx.params.id });
      if (error) {
        if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
        if (/FORBIDDEN/.test(error.message)) throw new ApiError('FORBIDDEN', 403);
        throw new ApiError('INTERNAL_ERROR', 500, error.message);
      }
      return ok({ id: ctx.params.id, default_for_org: true });
    },
  );
};

// --- currencies (global, read-only for non-admins) ---

const listCurrencies = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'currencies.currency.read');
  const client = admin();
  const { data, error } = await client
    .from('currencies').select('*').order('code', { ascending: true });
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  return ok(data ?? []);
};

const listExchangeRates = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'currencies.exchange_rate.read');
  const client = admin();
  const limit = parseLimit(ctx.url);
  const { data, error } = await client
    .from('exchange_rates').select('*')
    .order('effective_date', { ascending: false })
    .limit(limit + 1);
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  const rows = data ?? [];
  return ok(paginate(rows as Array<{ id: string; created_at: string }>, limit));
};

const createExchangeRate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'currencies.exchange_rate.write');
  const body = await parseBody(ctx.req, ExchangeRateWriteSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/exchange-rates', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('exchange_rates')
        .insert({ ...body, created_by: caller.userId })
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

// Silence unused export from types/sales.ts; ensures bundler keeps the file.
void CreateQuoteRequestSchema;
void SetDefaultBodySchema;

const ROUTES: Route[] = [
  // taxes
  { method: 'GET',    path: '/taxes',                    handler: genericList('taxes') },
  { method: 'GET',    path: '/taxes/:id',                handler: genericGet('taxes') },
  { method: 'POST',   path: '/taxes',                    handler: genericCreate('taxes', TaxWriteSchema, '/taxes') },
  { method: 'PATCH',  path: '/taxes/:id',                handler: genericUpdate('taxes', TaxWriteSchema.partial(), '/taxes/:id') },
  { method: 'DELETE', path: '/taxes/:id',                handler: genericSoftDelete('taxes', '/taxes/:id') },
  { method: 'POST',   path: '/taxes/:id/set-default',    handler: setDefaultTax },

  // payment methods
  { method: 'GET',    path: '/payment-methods',          handler: genericList('payment_methods') },
  { method: 'GET',    path: '/payment-methods/:id',      handler: genericGet('payment_methods') },
  { method: 'POST',   path: '/payment-methods',          handler: genericCreate('payment_methods', PaymentMethodWriteSchema, '/payment-methods') },
  { method: 'PATCH',  path: '/payment-methods/:id',      handler: genericUpdate('payment_methods', PaymentMethodWriteSchema.partial(), '/payment-methods/:id') },
  { method: 'DELETE', path: '/payment-methods/:id',      handler: genericSoftDelete('payment_methods', '/payment-methods/:id') },
  { method: 'POST',   path: '/payment-methods/:id/set-default', handler: setDefaultPaymentMethod },

  // currencies + exchange rates
  { method: 'GET',    path: '/currencies',               handler: listCurrencies },
  { method: 'GET',    path: '/exchange-rates',           handler: listExchangeRates },
  { method: 'POST',   path: '/exchange-rates',           handler: createExchangeRate },

  // pricing tiers
  { method: 'GET',    path: '/pricing-tiers',            handler: genericList('pricing_tiers', 'sort_order') },
  { method: 'GET',    path: '/pricing-tiers/:id',        handler: genericGet('pricing_tiers') },
  { method: 'POST',   path: '/pricing-tiers',            handler: genericCreate('pricing_tiers', PricingTierWriteSchema, '/pricing-tiers') },
  { method: 'PATCH',  path: '/pricing-tiers/:id',        handler: genericUpdate('pricing_tiers', PricingTierWriteSchema.partial(), '/pricing-tiers/:id') },
  { method: 'DELETE', path: '/pricing-tiers/:id',        handler: genericSoftDelete('pricing_tiers', '/pricing-tiers/:id') },

  // items
  { method: 'GET',    path: '/items',                    handler: genericList('items') },
  { method: 'GET',    path: '/items/:id',                handler: genericGet('items') },
  { method: 'POST',   path: '/items',                    handler: genericCreate('items', ItemWriteSchema, '/items') },
  { method: 'PATCH',  path: '/items/:id',                handler: genericUpdate('items', ItemWriteSchema.partial(), '/items/:id') },
  { method: 'DELETE', path: '/items/:id',                handler: genericSoftDelete('items', '/items/:id') },

  // categories + units
  { method: 'GET',    path: '/item-categories',          handler: genericList('item_categories', 'sort_order') },
  { method: 'POST',   path: '/item-categories',          handler: genericCreate('item_categories', ItemCategoryWriteSchema, '/item-categories') },
  { method: 'PATCH',  path: '/item-categories/:id',      handler: genericUpdate('item_categories', ItemCategoryWriteSchema.partial(), '/item-categories/:id') },
  { method: 'DELETE', path: '/item-categories/:id',      handler: genericSoftDelete('item_categories', '/item-categories/:id') },
  { method: 'GET',    path: '/units',                    handler: genericList('units') },
  { method: 'POST',   path: '/units',                    handler: genericCreate('units', UnitWriteSchema, '/units') },
  { method: 'PATCH',  path: '/units/:id',                handler: genericUpdate('units', UnitWriteSchema.partial(), '/units/:id') },
  { method: 'DELETE', path: '/units/:id',                handler: genericSoftDelete('units', '/units/:id') },

  // VAS + job types
  { method: 'GET',    path: '/value-added-services',     handler: genericList('value_added_services') },
  { method: 'POST',   path: '/value-added-services',     handler: genericCreate('value_added_services', VasWriteSchema, '/value-added-services') },
  { method: 'PATCH',  path: '/value-added-services/:id', handler: genericUpdate('value_added_services', VasWriteSchema.partial(), '/value-added-services/:id') },
  { method: 'DELETE', path: '/value-added-services/:id', handler: genericSoftDelete('value_added_services', '/value-added-services/:id') },
  { method: 'GET',    path: '/job-types',                handler: genericList('job_types', 'sort_order') },
  { method: 'POST',   path: '/job-types',                handler: genericCreate('job_types', JobTypeWriteSchema, '/job-types') },
  { method: 'PATCH',  path: '/job-types/:id',            handler: genericUpdate('job_types', JobTypeWriteSchema.partial(), '/job-types/:id') },
  { method: 'DELETE', path: '/job-types/:id',            handler: genericSoftDelete('job_types', '/job-types/:id') },
];

// Bundle-level dispatcher: gate on the three commerce pillar plugins
// (OR predicate) before any route runs. Shared with crm-api via
// _shared/bundleGate.ts.
serveBundleWithGate({
  flagKeys: [
    FEATURE_FLAGS.PLUGINS_THREE_PL,
    FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  ],
  routes: ROUTES,
  bundle: BUNDLE,
});
