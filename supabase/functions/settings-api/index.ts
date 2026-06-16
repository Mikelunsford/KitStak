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
  requireCap,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { ok, ApiError, noContent } from '../_shared/responses.ts';
import { FEATURE_FLAGS, PAID_PLUGIN_FLAGS } from '../_shared/constants.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { OidcConfigSchema, SamlConfigSchema } from '../_shared/types.ts';
import {
  BrandingResponseSchema,
  HexColorSchema,
  NumberingResetRequestSchema,
  NumberingSequenceSchema,
  OrgFeatureFlagSchema,
  OrgSettingSchema,
  SettingUpsertRequestSchema,
} from '../_shared/types/identity.ts';

const BUNDLE = 'settings-api';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function listSettings(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.read');
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
  requireCap(caller, 'settings.read');
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
  requireCap(caller, 'settings.write');
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
  requireCap(caller, 'settings.write');
  const group = ctx.params.group;
  const key = ctx.params.key;
  if (!group || !key) {
    throw new ApiError('VALIDATION_ERROR', 422, 'group and key required');
  }

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/settings/:group/:key',
    null,
    async () => {
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
    },
  );
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
  requireCap(caller, 'flags.read');
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

// Subscription statuses that entitle an org to enable paid pillar plugins.
// Mirrors the billing-api / stripe-webhook vocabulary; any other status
// (past_due, canceled, unpaid, paused, incomplete, ...) is not entitled.
const ENTITLED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

/**
 * Gate enabling a paid pillar plugin behind an active billing subscription.
 *
 * Only fires when the flag being written is a paid pillar plugin AND the
 * write is an enable (is_enabled = true). Disabling is always allowed so an
 * org can wind a pillar down regardless of billing state. Non-plugin flags
 * are never gated here.
 *
 * The org's subscription_status is read with the service-role admin client;
 * the explicit `.eq('id', orgId)` is the tenant guard. A missing org row or
 * a non-entitled status both deny the enable with 403 BILLING_REQUIRED. This
 * is distinct from the bundle gate, which returns 404 for sub-plan tenants.
 */
async function requirePaidPluginEntitlement(
  orgId: string,
  flagKey: string,
  isEnabled: boolean,
): Promise<void> {
  if (!isEnabled) return;
  if (!PAID_PLUGIN_FLAGS.has(flagKey)) return;

  const sb = admin();
  const { data, error } = await sb
    .from('organizations')
    .select('subscription_status')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `subscription status read failed: ${error.message}`,
    );
  }
  const status = (data as { subscription_status?: string } | null)
    ?.subscription_status;
  if (!status || !ENTITLED_SUBSCRIPTION_STATUSES.has(status)) {
    throw new ApiError(
      'BILLING_REQUIRED',
      403,
      'An active subscription is required to enable this plugin.',
      { flag: flagKey },
    );
  }
}

async function upsertFlag(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'flags.write');
  const flagKey = ctx.params.flag_key;
  if (!flagKey) {
    throw new ApiError('VALIDATION_ERROR', 422, 'flag_key required');
  }
  const body = await parseBody(ctx.req, FlagUpsertSchema);

  await requirePaidPluginEntitlement(caller.orgId, flagKey, body.is_enabled);

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
  requireCap(caller, 'branding.read');
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
  requireCap(caller, 'branding.update');
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
  requireCap(caller, 'settings.numbering.read');
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
  requireCap(caller, 'settings.numbering.read');
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
  requireCap(caller, 'settings.numbering.reset');
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

// ---------------------------------------------------------------------------
// SSO provider metadata (F-Wave13-SSO-HANDSHAKE-01, MVP store-metadata)
// ---------------------------------------------------------------------------
//
// The SPA manages the sso_connections record directly through RLS. Storing the
// IdP metadata (cert, endpoints, client secret) is a workflow, not plain config:
// it is gated behind the auth.sso_saml flag, requires org.sso.write, enforces an
// Idempotency-Key, and writes via the service-role client after confirming the
// connection belongs to the caller org. provider_validated_at is NOT stamped
// here: storing metadata does not prove the live handshake works. The operator
// wires the provider in the Supabase project, then marks the connection
// validated (sso_connections.provider_validated_at) and activates it; the
// sso_connections_active_requires_validation CHECK enforces that ordering.

async function requireSsoSamlFlag(caller: Caller): Promise<void> {
  const flag = await getFlag(caller.orgId, FEATURE_FLAGS.AUTH_SSO_SAML);
  if (!flag.enabled) {
    throw new ApiError(
      'FEATURE_DISABLED',
      403,
      'auth.sso_saml feature is disabled for this org',
      { flag: FEATURE_FLAGS.AUTH_SSO_SAML },
    );
  }
}

async function assertSsoConnectionInOrg(
  sb: ReturnType<typeof admin>,
  connectionId: string,
  orgId: string,
  expectedProvider: 'saml' | 'oidc',
): Promise<void> {
  const { data, error } = await sb
    .from('sso_connections')
    .select('id, provider')
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `sso connection lookup failed: ${error.message}`,
    );
  }
  // Cross-tenant or unknown connection: 404, never 403 (constitutional).
  if (!data) {
    throw new ApiError('NOT_FOUND', 404, 'SSO connection not found.');
  }
  if ((data as { provider: string }).provider !== expectedProvider) {
    throw new ApiError(
      'VALIDATION_ERROR',
      422,
      `connection provider is ${(data as { provider: string }).provider}, not ${expectedProvider}`,
    );
  }
}

const SamlMetadataRequestSchema = z.object({
  sso_connection_id: z.string().uuid(),
  idp_entity_id: z.string().min(1),
  idp_sso_url: z.string().url(),
  idp_metadata_url: z.string().url().nullable().optional(),
  idp_x509_cert: z.string().min(1),
  sp_entity_id: z.string().min(1),
  sp_acs_url: z.string().url(),
  attribute_mappings: z.record(z.unknown()).optional(),
  signature_algorithm: z.string().min(1).optional(),
  want_assertions_signed: z.boolean().optional(),
});

const SAML_CONFIG_COLS =
  'idp_entity_id, idp_sso_url, idp_metadata_url, idp_x509_cert, sp_entity_id, sp_acs_url, attribute_mappings, signature_algorithm, want_assertions_signed';

async function configureSsoSamlMetadata(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.sso.write');
  await requireSsoSamlFlag(caller);
  const body = await parseBody(ctx.req, SamlMetadataRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/sso/saml-metadata',
    body,
    async () => {
      const sb = admin();
      await assertSsoConnectionInOrg(sb, body.sso_connection_id, caller.orgId, 'saml');
      const row = {
        sso_connection_id: body.sso_connection_id,
        idp_entity_id: body.idp_entity_id,
        idp_sso_url: body.idp_sso_url,
        idp_metadata_url: body.idp_metadata_url ?? null,
        idp_x509_cert: body.idp_x509_cert,
        sp_entity_id: body.sp_entity_id,
        sp_acs_url: body.sp_acs_url,
        attribute_mappings: body.attribute_mappings ?? {},
        signature_algorithm: body.signature_algorithm ?? 'rsa-sha256',
        want_assertions_signed: body.want_assertions_signed ?? true,
        created_by: caller.userId,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      };
      const { data, error } = await sb
        .from('saml_configs')
        .upsert(row, { onConflict: 'sso_connection_id' })
        .select(SAML_CONFIG_COLS)
        .single();
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `saml config upsert failed: ${error.message}`,
        );
      }
      return ok(SamlConfigSchema.parse(data));
    },
  );
}

const OidcMetadataRequestSchema = z.object({
  sso_connection_id: z.string().uuid(),
  issuer_url: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  attribute_mappings: z.record(z.unknown()).optional(),
});

const OIDC_CONFIG_COLS =
  'issuer_url, authorization_endpoint, token_endpoint, userinfo_endpoint, client_id, client_secret, scopes, attribute_mappings';

async function configureSsoOidcMetadata(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.sso.write');
  await requireSsoSamlFlag(caller);
  const body = await parseBody(ctx.req, OidcMetadataRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/sso/oidc-metadata',
    body,
    async () => {
      const sb = admin();
      await assertSsoConnectionInOrg(sb, body.sso_connection_id, caller.orgId, 'oidc');
      const row = {
        sso_connection_id: body.sso_connection_id,
        issuer_url: body.issuer_url,
        authorization_endpoint: body.authorization_endpoint,
        token_endpoint: body.token_endpoint,
        userinfo_endpoint: body.userinfo_endpoint,
        client_id: body.client_id,
        client_secret: body.client_secret,
        scopes: body.scopes ?? ['openid', 'profile', 'email'],
        attribute_mappings: body.attribute_mappings ?? {},
        created_by: caller.userId,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
      };
      const { data, error } = await sb
        .from('oidc_configs')
        .upsert(row, { onConflict: 'sso_connection_id' })
        .select(OIDC_CONFIG_COLS)
        .single();
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `oidc config upsert failed: ${error.message}`,
        );
      }
      return ok(OidcConfigSchema.parse(data));
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
      // sso provider metadata (store-metadata MVP)
      { method: 'POST',   path: '/sso/saml-metadata',     handler: configureSsoSamlMetadata },
      { method: 'POST',   path: '/sso/oidc-metadata',     handler: configureSsoOidcMetadata },
    ],
    { bundle: BUNDLE },
  ),
);
