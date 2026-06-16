// three-pl-api shared handler helpers. Loaders and parent-existence probes
// moved verbatim from the former monolithic index.ts during the R-W13-DX-01
// structural split (handlers/ layout, mirroring crm-api / finance-api). No
// behaviour change: every loader, probe, position allocator, the nowIso
// stamp, and the template-snapshot builder are byte-for-byte the same logic
// the single-file index.ts ran.
//
// Cross-tenant or soft-deleted rows resolve to NOT_FOUND 404, matching the
// copack-api / ops-api precedent.

import { ApiError, internalError } from '../../_shared/responses.ts';
import { admin } from '../../_shared/handler-helpers.ts';
import { type Caller } from '../../_shared/tenant.ts';
import {
  ThreePlAccountSchema,
  JobTemplateSchema,
  SupplyPlanSchema,
  JobRunSchema,
  JobRunDailyLogSchema,
  BillingReviewSchema,
  type ThreePlAccount,
  type JobTemplate,
  type SupplyPlan,
  type JobRun,
  type JobRunDailyLog,
  type BillingReview,
} from '../../_shared/types/threepl.ts';

export const BUNDLE = 'three-pl-api';

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function loadAccount(caller: Caller, id: string): Promise<ThreePlAccount> {
  const { data, error } = await admin()
    .from('three_pl_accounts').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return ThreePlAccountSchema.parse(data);
}

export async function assertAccountParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('three_pl_accounts').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

export async function nextServicePosition(caller: Caller, accountId: string): Promise<number> {
  const { data, error } = await admin().from('account_service_definitions')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('account_id', accountId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Job templates
// ---------------------------------------------------------------------------

export async function loadJobTemplate(caller: Caller, id: string): Promise<JobTemplate> {
  const { data, error } = await admin()
    .from('job_templates').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return JobTemplateSchema.parse(data);
}

export async function assertJobTemplateParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('job_templates').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

export async function nextLinePosition(caller: Caller, templateId: string): Promise<number> {
  const { data, error } = await admin().from('job_template_lines')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('template_id', templateId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// Builds the frozen job-template snapshot (A4 shape, 0094) from a live template
// and its lines, org-scoped so a foreign template can never be frozen. Returns
// null when the template is missing. Mirrors the 0094 jsonb_build_object block.
export async function buildTemplateSnapshot(
  caller: Caller, templateId: string,
): Promise<Record<string, unknown> | null> {
  const { data: tpl, error: e1 } = await admin().from('job_templates')
    .select('id, template_number, name, variant, job_type_id, default_bom_item_id, status, notes')
    .eq('org_id', caller.orgId).eq('id', templateId).is('deleted_at', null).maybeSingle();
  if (e1) throw internalError(BUNDLE, e1);
  if (!tpl) return null;
  const { data: lines, error: e2 } = await admin().from('job_template_lines')
    .select('id, line_kind, item_id, vas_id, name, quantity, rate_cents, rate_uom, currency_code, position')
    .eq('org_id', caller.orgId).eq('template_id', templateId)
    .order('position', { ascending: true });
  if (e2) throw internalError(BUNDLE, e2);
  return {
    snapshot_at: nowIso(),
    template_id: tpl.id,
    template_number: tpl.template_number,
    name: tpl.name,
    variant: tpl.variant,
    job_type_id: tpl.job_type_id,
    default_bom_item_id: tpl.default_bom_item_id,
    status: tpl.status,
    notes: tpl.notes,
    lines: lines ?? [],
  };
}

// ---------------------------------------------------------------------------
// Supply plans
// ---------------------------------------------------------------------------

export async function loadSupplyPlan(caller: Caller, id: string): Promise<SupplyPlan> {
  const { data, error } = await admin()
    .from('supply_plans').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return SupplyPlanSchema.parse(data);
}

export async function assertSupplyPlanParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('supply_plans').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

export async function nextSupplyPlanLinePosition(caller: Caller, planId: string): Promise<number> {
  const { data, error } = await admin().from('supply_plan_lines')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('supply_plan_id', planId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Job runs and daily logs
// ---------------------------------------------------------------------------

export async function loadJobRun(caller: Caller, id: string): Promise<JobRun> {
  const { data, error } = await admin()
    .from('job_runs').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return JobRunSchema.parse(data);
}

export async function assertJobRunParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('job_runs').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

export async function loadJobRunDailyLog(
  caller: Caller, runId: string, logId: string,
): Promise<JobRunDailyLog> {
  const { data, error } = await admin()
    .from('job_run_daily_logs').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', runId).eq('id', logId)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return JobRunDailyLogSchema.parse(data);
}

// Asserts the daily log exists under (org, run); NOT_FOUND otherwise. Used by
// the line routes so a cross-tenant or wrong-parent log resolves to 404.
export async function assertDailyLogParent(
  caller: Caller, runId: string, logId: string,
): Promise<void> {
  const { data, error } = await admin().from('job_run_daily_logs').select('id')
    .eq('org_id', caller.orgId).eq('job_run_id', runId).eq('id', logId).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

export async function nextDailyLogLinePosition(
  caller: Caller, table: string, logId: string,
): Promise<number> {
  const { data, error } = await admin().from(table)
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('job_run_daily_log_id', logId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Billing reviews
// ---------------------------------------------------------------------------

export async function loadBillingReview(caller: Caller, id: string): Promise<BillingReview> {
  const { data, error } = await admin()
    .from('billing_reviews').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return BillingReviewSchema.parse(data);
}

export async function assertBillingReviewParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('billing_reviews').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}
