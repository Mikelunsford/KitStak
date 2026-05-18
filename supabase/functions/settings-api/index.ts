// settings-api: per-tenant settings, feature flags, branding writes,
// numbering sequence administration.
//
// Routes:
//   GET    /settings                          list all settings for the org
//   GET    /settings/:group                   list one group
//   PUT    /settings                          upsert one (group, key, value)
//   DELETE /settings/:group/:key              remove one setting
//
//   GET    /flags                             list all flag rows for the org
//   PUT    /flags/:flag_key                   set is_enabled / config
//
//   GET    /branding                          read branding row
//   PUT    /branding                          patch branding row
//
//   GET    /numbering                         list numbering seed rows
//   GET    /numbering/:doc_type               one row
//   POST   /numbering/reset                   reset a sequence (audited)
//
// Capability gates are identity-side-car. Write routes require an
// Idempotency-Key header.

import { z } from 'zod';

import { route, type RouteCtx } from '../_shared/route.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
} from '../_shared/handler-helpers.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { ok, ApiError, noContent } from '../_shared/responses.ts';
import {
  BrandingResponseSchema,
  HexColorSchema,
  NumberingResetRequestSchema,
  NumberingSequenceSchema,
  OrgFeatureFlagSchema,
  OrgSettingSchema,
  SettingUpsertRequestSchema,
} from '../_shared/types/identity.ts';
import {
  hasIdentityCap,
  type IdentityCapability,
} from '../_shared/capabilities/identity.ts';
import type { Caller } from '../_shared/tenant.ts';

const BUNDLE = 'settings-api';

function requireIdentityCap(caller: Caller, cap: IdentityCapability): void {
  if (hasIdentityCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function listSettings(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.read');
  const sb = admin();
  const { data, error } = await sb
    .from('org_settings')
    .select('org_id, group_key, setting_key, value')
    .eq('org_id', caller.orgId)
    .order('group_key', { ascending: true })
    .order('setting_key', { ascending: true });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `settings list failed: ${error.message}`,
    );
  }
  const items = (data ?? []).map((row) => OrgSettingSchema.parse(row));
  return ok({ items });
}

async function listSettingGroup(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.read');
  const group = ctx.params.group;
  if (!group) {
    throw new ApiError('VALIDATION_ERROR', 422, 'group required');
  }
  const sb = admin();
  const { data, error } = await sb
    .from('org_settings')
    .select('org_id, group_key, setting_key, value')
    .eq('org_id', caller.orgId)
    .eq('group_key', group);
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `settings group failed: ${error.message}`,
    );
  }
  const items = (data ?? []).map((row) => OrgSettingSchema.parse(row));
  return ok({ items });
}

async function upsertSetting(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.write');
  const body = await parseBody(ctx.req, SettingUpsertRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/settings',
    body,
    async () => {
      const sb = admin();
      const row = {
        org_id: caller.orgId,
        group_key: body.group_key,
        setting_key: body.setting_key,
        value: body.value,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      };
      const { data, error } = await sb
        .from('org_settings')
        .upsert(row, { onConflict: 'org_id,group_key,setting_key' })
        .select('org_id, group_key, setting_key, value')
        .single();
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `settings upsert failed: ${error.message}`,
        );
      }
      return ok(OrgSettingSchema.parse(data));
    },
  );
}

async function deleteSetting(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.write');
  const group = ctx.params.group;
  const key = ctx.params.key;
  if (!group || !key) {
    throw new ApiError('VALIDATION_ERROR', 422, 'group and key required');
  }
  const sb = admin();
  const { error } = await sb
    .from('org_settings')
    .delete()
    .eq('org_id', caller.orgId)
    .eq('group_key', group)
    .eq('setting_key', key);
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `settings delete failed: ${error.message}`,
    );
  }
  return noContent();
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FlagUpsertSchema = z.object({
  is_enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
});

async function listFlags(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'flags.read');
  const sb = admin();
  const { data, error } = await sb
    .from('org_feature_flags')
    .select('org_id, flag_key, is_enabled, config')
    .eq('org_id', caller.orgId)
    .order('flag_key', { ascending: true });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `flags list failed: ${error.message}`,
    );
  }
  const items = (data ?? []).map((row) => OrgFeatureFlagSchema.parse(row));
  return ok({ items });
}

async function upsertFlag(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'flags.write');
  const flagKey = ctx.params.flag_key;
  if (!flagKey) {
    throw new ApiError('VALIDATION_ERROR', 422, 'flag_key required');
  }
  const body = await parseBody(ctx.req, FlagUpsertSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `/flags/:flag_key`,
    { flag_key: flagKey, ...body },
    async () => {
      const sb = admin();
      const row = {
        org_id: caller.orgId,
        flag_key: flagKey,
        is_enabled: body.is_enabled,
        config: body.config,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      };
      const { data, error } = await sb
        .from('org_feature_flags')
        .upsert(row, { onConflict: 'org_id,flag_key' })
        .select('org_id, flag_key, is_enabled, config')
        .single();
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `flag upsert failed: ${error.message}`,
        );
      }
      return ok(OrgFeatureFlagSchema.parse(data));
    },
  );
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

const BrandingPatchSchema = z.object({
  logo_url: z.string().url().nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  email_logo_url: z.string().url().nullable().optional(),
  primary_color: HexColorSchema.optional(),
  accent_color: HexColorSchema.optional(),
  on_primary: HexColorSchema.optional(),
  font_family: z.string().min(1).optional(),
  invoice_pdf_footer: z.string().nullable().optional(),
  quote_pdf_footer: z.string().nullable().optional(),
  app_name_override: z.string().nullable().optional(),
  support_url: z.string().url().nullable().optional(),
  privacy_url: z.string().url().nullable().optional(),
  terms_url: z.string().url().nullable().optional(),
  custom_css: z.string().nullable().optional(),
});

async function getBrandingRow(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'branding.read');
  const sb = admin();
  const { data, error } = await sb
    .from('org_branding')
    .select(
      'org_id, logo_url, icon_url, email_logo_url, primary_color, accent_color, on_primary, font_family, invoice_pdf_footer, quote_pdf_footer, app_name_override, support_url, privacy_url, terms_url, custom_css',
    )
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `branding read failed: ${error.message}`,
    );
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404, 'Branding row missing.');
  }
  return ok(BrandingResponseSchema.parse(data));
}

async function patchBranding(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'branding.update');
  const body = await parseBody(ctx.req, BrandingPatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/branding',
    body,
    async () => {
      const sb = admin();
      const patch: Record<string, unknown> = {
        ...body,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      };
      const { data, error } = await sb
        .from('org_branding')
        .update(patch)
        .eq('org_id', caller.orgId)
        .select(
          'org_id, logo_url, icon_url, email_logo_url, primary_color, accent_color, on_primary, font_family, invoice_pdf_footer, quote_pdf_footer, app_name_override, support_url, privacy_url, terms_url, custom_css',
        )
        .single();
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `branding update failed: ${error.message}`,
        );
      }
      return ok(BrandingResponseSchema.parse(data));
    },
  );
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

async function listNumbering(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.numbering.read');
  const sb = admin();
  const { data, error } = await sb
    .from('numbering_sequences')
    .select(
      'org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value, last_reset_period',
    )
    .eq('org_id', caller.orgId)
    .order('doc_type', { ascending: true });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `numbering list failed: ${error.message}`,
    );
  }
  const items = (data ?? []).map((row) => NumberingSequenceSchema.parse(row));
  return ok({ items });
}

async function getNumbering(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.numbering.read');
  const docType = ctx.params.doc_type;
  if (!docType) {
    throw new ApiError('VALIDATION_ERROR', 422, 'doc_type required');
  }
  const sb = admin();
  const { data, error } = await sb
    .from('numbering_sequences')
    .select(
      'org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value, last_reset_period',
    )
    .eq('org_id', caller.orgId)
    .eq('doc_type', docType)
    .maybeSingle();
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `numbering read failed: ${error.message}`,
    );
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404, 'Sequence not seeded.');
  }
  return ok(NumberingSequenceSchema.parse(data));
}

async function resetNumbering(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'settings.numbering.reset');
  const body = await parseBody(ctx.req, NumberingResetRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/numbering/reset',
    body,
    async () => {
      const sb = admin();
      const { error } = await sb.rpc('reset_numbering_sequence', {
        p_org_id: caller.orgId,
        p_doc_type: body.doc_type,
        p_next_value: body.next_value,
      });
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `numbering reset failed: ${error.message}`,
        );
      }
      return ok({ doc_type: body.doc_type, next_value: body.next_value });
    },
  );
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      // settings
      { method: 'GET',    path: '/settings',              handler: listSettings },
      { method: 'GET',    path: '/settings/:group',       handler: listSettingGroup },
      { method: 'PUT',    path: '/settings',              handler: upsertSetting },
      { method: 'DELETE', path: '/settings/:group/:key',  handler: deleteSetting },
      // flags
      { method: 'GET',    path: '/flags',                 handler: listFlags },
      { method: 'PUT',    path: '/flags/:flag_key',       handler: upsertFlag },
      // branding writes
      { method: 'GET',    path: '/branding',              handler: getBrandingRow },
      { method: 'PUT',    path: '/branding',              handler: patchBranding },
      // numbering
      { method: 'GET',    path: '/numbering',             handler: listNumbering },
      { method: 'GET',    path: '/numbering/:doc_type',   handler: getNumbering },
      { method: 'POST',   path: '/numbering/reset',       handler: resetNumbering },
    ],
    { bundle: BUNDLE },
  ),
);
