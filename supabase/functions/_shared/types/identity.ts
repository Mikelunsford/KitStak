// Identity / tenancy / branding / settings side-car canon.
// BYTE-IDENTICAL with apps/web/src/lib/types/identity.ts. Asserted by
// pnpm test:contract. Any drift is a release blocker.
//
// Shape: pure Zod schemas plus inferred types. No platform-specific
// imports. The schemas live here because they are co-evolved with the
// edge-function contracts in auth-api / tenants-api / settings-api and
// the SPA hooks that consume them; keeping one definition prevents the
// classic split-brain that happens when wire shapes drift.

import { z } from 'zod';

// ----- primitives shared with the master types canon -----

export const UuidSchema = z.string().uuid();
export const NonEmptyStringSchema = z.string().min(1);

export const HexColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Expect a six-digit hex color');

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

export const OrgStatusSchema = z.enum([
  'provisioning',
  'active',
  'suspended',
  'archived',
]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

// ----- organization -----

export const OrganizationSchema = z.object({
  id: UuidSchema,
  slug: NonEmptyStringSchema,
  display_name: NonEmptyStringSchema,
  legal_name: z.string().nullable(),
  industry: z.string().nullable(),
  region: z.string(),
  default_locale: z.string(),
  default_timezone: z.string(),
  default_currency_code: z.string(),
  date_format: z.string(),
  plan_code: z.string(),
  status: OrgStatusSchema,
  billing_email: z.string().email().nullable(),
  support_email: z.string().email().nullable(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

// ----- profiles -----

export const UserProfileSchema = z.object({
  user_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  photo_url: z.string().url().nullable(),
  phone: z.string().nullable(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  is_active: z.boolean(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

// ----- memberships -----

export const OrgMembershipSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  user_id: UuidSchema,
  role: RoleCodeSchema,
  customer_id: UuidSchema.nullable(),
  is_active: z.boolean(),
  invited_at: z.string().nullable(),
  joined_at: z.string().nullable(),
});
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;

// Lightweight membership row returned by /me. Excludes the full join detail
// so the topbar only deserialises what it renders.
export const MembershipSummarySchema = z.object({
  org_id: UuidSchema,
  org_slug: NonEmptyStringSchema,
  display_name: NonEmptyStringSchema,
  role: RoleCodeSchema,
  is_default: z.boolean(),
});
export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

// ----- role -----

export const RoleSchema = z.object({
  id: UuidSchema,
  code: RoleCodeSchema,
  label: NonEmptyStringSchema,
  description: z.string().nullable(),
  is_staff: z.boolean(),
  is_system: z.boolean(),
  scope_level: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;

// ----- branding -----

export const OrgBrandingSchema = z.object({
  org_id: UuidSchema,
  logo_url: z.string().url().nullable(),
  icon_url: z.string().url().nullable(),
  email_logo_url: z.string().url().nullable(),
  primary_color: HexColorSchema,
  accent_color: HexColorSchema,
  on_primary: HexColorSchema,
  font_family: NonEmptyStringSchema,
  invoice_pdf_footer: z.string().nullable(),
  quote_pdf_footer: z.string().nullable(),
  app_name_override: z.string().nullable(),
  support_url: z.string().url().nullable(),
  privacy_url: z.string().url().nullable(),
  terms_url: z.string().url().nullable(),
  custom_css: z.string().nullable(),
});
export type OrgBranding = z.infer<typeof OrgBrandingSchema>;

// Public response from /branding. Excludes audit columns.
export const BrandingResponseSchema = OrgBrandingSchema;
export type BrandingResponse = z.infer<typeof BrandingResponseSchema>;

// ----- domains -----

export const OrgDomainSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  host: NonEmptyStringSchema,
  is_primary: z.boolean(),
  verified_at: z.string().nullable(),
});
export type OrgDomain = z.infer<typeof OrgDomainSchema>;

export const ResolveHostResponseSchema = z.object({
  org_id: UuidSchema,
  org_slug: NonEmptyStringSchema,
});
export type ResolveHostResponse = z.infer<typeof ResolveHostResponseSchema>;

// ----- feature flags -----

export const OrgFeatureFlagSchema = z.object({
  org_id: UuidSchema,
  flag_key: NonEmptyStringSchema,
  is_enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
});
export type OrgFeatureFlag = z.infer<typeof OrgFeatureFlagSchema>;

// ----- settings -----

export const OrgSettingSchema = z.object({
  org_id: UuidSchema,
  group_key: NonEmptyStringSchema,
  setting_key: NonEmptyStringSchema,
  value: z.record(z.unknown()),
});
export type OrgSetting = z.infer<typeof OrgSettingSchema>;

export const SettingUpsertRequestSchema = z.object({
  group_key: NonEmptyStringSchema,
  setting_key: NonEmptyStringSchema,
  value: z.record(z.unknown()),
});
export type SettingUpsertRequest = z.infer<typeof SettingUpsertRequestSchema>;

// ----- numbering -----

export const NumberingSequenceSchema = z.object({
  org_id: UuidSchema,
  doc_type: NonEmptyStringSchema,
  prefix: z.string(),
  pad_width: z.number().int().min(1).max(12),
  include_year: z.boolean(),
  reset_period: z.enum(['never', 'yearly', 'monthly']),
  next_value: z.number().int().min(1),
  last_reset_period: z.string().nullable(),
});
export type NumberingSequence = z.infer<typeof NumberingSequenceSchema>;

export const NumberingResetRequestSchema = z.object({
  doc_type: NonEmptyStringSchema,
  next_value: z.number().int().min(1).default(1),
});
export type NumberingResetRequest = z.infer<typeof NumberingResetRequestSchema>;

// ----- session switching -----

export const SwitchOrgRequestSchema = z.object({
  org_id: UuidSchema,
});
export type SwitchOrgRequest = z.infer<typeof SwitchOrgRequestSchema>;

export const SwitchOrgResponseSchema = z.object({
  org_id: UuidSchema,
  role: RoleCodeSchema,
});
export type SwitchOrgResponse = z.infer<typeof SwitchOrgResponseSchema>;

// ----- /me envelope -----

export const MeResponseSchema = z.object({
  user_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
  active_org_id: UuidSchema.nullable(),
  active_role: RoleCodeSchema.nullable(),
  memberships: z.array(MembershipSummarySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ----- staff invite (F-Wave9-STAFF-INVITE-CHASSIS-01) -----
// StaffRoleCodeSchema is RoleCodeSchema narrowed to the six staff codes
// (excludes customer_user and vendor_user). The invite endpoint refuses
// portal codes server-side; mirroring the narrow shape here lets the SPA
// form bind a typed dropdown without a runtime branch on the wider enum.

export const StaffRoleCodeSchema = z.enum([
  'org_owner',
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
]);
export type StaffRoleCode = z.infer<typeof StaffRoleCodeSchema>;

export const InviteStaffRequestSchema = z.object({
  email: z.string().email(),
  role: StaffRoleCodeSchema,
});
export type InviteStaffRequest = z.infer<typeof InviteStaffRequestSchema>;

export const InviteStaffResponseSchema = z.object({
  user_id: UuidSchema,
  membership_id: UuidSchema,
  role: StaffRoleCodeSchema,
  email: z.string().email(),
});
export type InviteStaffResponse = z.infer<typeof InviteStaffResponseSchema>;

// ----- staff list (F-Wave9-STAFF-INVITE-MEMBERS-LIST-01) -----
// Flat row returned by GET /auth-api/members. Joins org_memberships to
// auth.users (for email + display_name) and roles (for the role code and
// human label) on the server; the SPA receives the projected shape directly
// and renders it without a second round-trip.
//
// Envelope: standard ok(data) flat array (NOT { items: ... }). Pagination is
// deferred per the spec; for the first year orgs are expected to have well
// under 50 members.

export const OrgMemberRowSchema = z.object({
  user_id: UuidSchema,
  org_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
  role_code: RoleCodeSchema,
  role_display_name: NonEmptyStringSchema,
  created_at: z.string(),
  is_active: z.boolean(),
  // claimed is true once the invitee has accepted the magic link (auth.users
  // email_confirmed_at is set). The SPA uses this to gate the per-row Resend
  // button: only unclaimed members can be re-invited because a re-issued
  // magic link does nothing useful for an account that already signed in.
  // F-Wave9-STAFF-INVITE-RESEND-01.
  claimed: z.boolean(),
});
export type OrgMemberRow = z.infer<typeof OrgMemberRowSchema>;

export const OrgMembersListResponseSchema = z.array(OrgMemberRowSchema);
export type OrgMembersListResponse = z.infer<typeof OrgMembersListResponseSchema>;

// ----- staff PATCH (F-Wave9-STAFF-INVITE-PATCH-01) -----
// PATCH /auth-api/members/:user_id body. At least one of role or is_active
// must be supplied; an empty body is a 422. The schema is intentionally
// narrow: role is the staff-role enum (org_owner included so an existing
// org_owner can promote a peer; the handler refuses owner-mints-owner from
// an org_admin caller via a privilege-escalation guard mirroring the invite
// path). is_active is a plain boolean; the handler refuses self-deactivation
// with 422 CANNOT_DEACTIVATE_SELF so an operator cannot lock themselves out.

export const PatchOrgMemberRequestSchema = z
  .object({
    role: StaffRoleCodeSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.is_active !== undefined,
    { message: 'At least one of role or is_active must be provided' },
  );
export type PatchOrgMemberRequest = z.infer<typeof PatchOrgMemberRequestSchema>;

// ----- staff RESEND (F-Wave9-STAFF-INVITE-RESEND-01) -----
// POST /auth-api/members/:user_id/resend response. The handler never echoes
// the magic link itself; the caller only learns that the link was generated
// and the notifications row queued. Already-claimed members get a 422
// MEMBER_ALREADY_CLAIMED. Cross-tenant members get a 404 per Pattern A.

export const ResendOrgMemberInviteResponseSchema = z.object({
  status: z.literal('sent'),
  resent_at: z.string(),
});
export type ResendOrgMemberInviteResponse = z.infer<
  typeof ResendOrgMemberInviteResponseSchema
>;

// ----- password reset (F-Wave9-INVITE-PASSWORD-SETUP-01) -----
// Public, anti-enumeration endpoint. The caller posts an email; the server
// always replies with `accepted: true` regardless of whether the email
// resolves to an auth.users row, so the response shape cannot be used to
// probe membership. Same posture as RequestSignInLinkSchema in the portal
// flow. See auth-api postRequestPasswordReset for the handler.

export const RequestPasswordResetSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetRequest = z.infer<typeof RequestPasswordResetSchema>;

export const RequestPasswordResetResponseSchema = z.object({
  accepted: z.literal(true),
});
export type RequestPasswordResetResponse = z.infer<typeof RequestPasswordResetResponseSchema>;
