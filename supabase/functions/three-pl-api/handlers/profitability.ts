// three-pl-api profitability handlers. view_job_profitability (read-only view;
// Job Profitability, Phase A7). Read via the service-role admin() client, which
// bypasses RLS, so the org filter is applied EXPLICITLY here; the view's
// security_invoker is only a backstop for non-admin readers. Handler bodies
// moved verbatim from the former monolithic index.ts during the R-W13-DX-01
// structural split; no behaviour change.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import { admin, parseUuidParam, requireCap } from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { JobProfitabilityRowSchema } from '../../_shared/types/threepl.ts';
import { BUNDLE } from './_helpers.ts';

export async function listProfitability({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.profitability.read');
  const jobRunId = url.searchParams.get('job_run_id');
  const projectId = url.searchParams.get('project_id');
  let q = admin()
    .from('view_job_profitability').select('*')
    .eq('org_id', caller.orgId);
  if (jobRunId) q = q.eq('job_run_id', jobRunId);
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => JobProfitabilityRowSchema.parse(r)));
}

export async function getProfitability({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.profitability.read');
  parseUuidParam(params.jobRunId, 'jobRunId');
  const { data, error } = await admin()
    .from('view_job_profitability').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', params.jobRunId)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return ok(JobProfitabilityRowSchema.parse(data));
}
