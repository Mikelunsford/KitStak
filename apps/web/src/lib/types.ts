import { z } from 'zod';

export const CentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);

export const UuidSchema = z.string().uuid();

export const OrgStatusSchema = z.enum([
  'provisioning',
  'active',
  'suspended',
  'archived',
]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const OrgSchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  display_name: z.string(),
  default_currency_code: z.string().default('USD'),
  status: OrgStatusSchema,
});
export type Org = z.infer<typeof OrgSchema>;

export const RoleCodeSchema = z.enum([
  'org_owner',
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
  'customer_user',
  'vendor_user',
]);
export type RoleCode = z.infer<typeof RoleCodeSchema>;

export const UserSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const FeatureFlagSchema = z.object({
  org_id: UuidSchema,
  flag_key: z.string(),
  is_enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const AuditEntrySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entity_type: z.string(),
  entity_id: UuidSchema,
  from_state: z.string().nullable(),
  to_state: z.string(),
  action: z.string().nullable(),
  triggered_by: UuidSchema.nullable(),
  triggered_at: z.string(),
  diff_json: z.record(z.unknown()).nullable(),
  prev_hash: z.string().nullable(),
  payload_hash: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const IdempotencyKeySchema = z.object({
  key: z.string().uuid(),
  user_id: UuidSchema,
  org_id: UuidSchema,
  route_hash: z.string().nullable(),
  body_hash: z.string().nullable(),
  status_code: z.number().int(),
  response_jsonb: z.unknown().nullable(),
  created_at: z.string(),
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const BrandingSchema = z.object({
  org_id: UuidSchema,
  primary_color: z.string(),
  accent_color: z.string(),
  on_primary: z.string(),
  font_family: z.string(),
  logo_url: z.string().url().nullable(),
  icon_url: z.string().url().nullable(),
  app_name_override: z.string().nullable(),
});
export type Branding = z.infer<typeof BrandingSchema>;

export const SsoProviderSchema = z.enum(['saml', 'oidc']);
export type SsoProvider = z.infer<typeof SsoProviderSchema>;

export const SamlConfigSchema = z.object({
  idp_entity_id: z.string(),
  idp_sso_url: z.string(),
  idp_metadata_url: z.string().nullable(),
  idp_x509_cert: z.string(),
  sp_entity_id: z.string(),
  sp_acs_url: z.string(),
  attribute_mappings: z.record(z.unknown()).default({}),
  signature_algorithm: z.string().default('rsa-sha256'),
  want_assertions_signed: z.boolean().default(true),
});
export type SamlConfig = z.infer<typeof SamlConfigSchema>;

export const OidcConfigSchema = z.object({
  issuer_url: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  userinfo_endpoint: z.string(),
  client_id: z.string(),
  client_secret: z.string(),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
  attribute_mappings: z.record(z.unknown()).default({}),
});
export type OidcConfig = z.infer<typeof OidcConfigSchema>;

// The OIDC client_secret is write-only: it is never echoed back to the caller.
// The store endpoint returns the config without it, and a future read would use
// this shape too.
export const OidcConfigResponseSchema = OidcConfigSchema.omit({ client_secret: true });
export type OidcConfigResponse = z.infer<typeof OidcConfigResponseSchema>;

export const SsoConnectionSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  provider: SsoProviderSchema,
  display_name: z.string(),
  is_active: z.boolean(),
  default_role_code: RoleCodeSchema,
  provider_validated_at: z.string().nullable(),
});
export type SsoConnection = z.infer<typeof SsoConnectionSchema>;
