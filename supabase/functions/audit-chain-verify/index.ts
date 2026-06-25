// audit-chain-verify: nightly walker over every active org's audit_log chain.
// Calls public.verify_audit_chain(org_id) for each row in organizations.
// Returns the first broken row (if any) per org. A non-empty array is a P0:
// the nightly workflow fails and pages the operator. Known pre-0085 residue
// breaks are baselined out of broken_count (see BASELINED_BROKEN_IDS below)
// so the alert keeps its signal; they are still reported under `baselined`.

import { fromApiError, ApiError, ok, internalError } from '../_shared/responses.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { serverCorsHeaders } from '../_shared/cors.ts';
import { ERROR_CODES, HTTP_HEADERS } from '../_shared/constants.ts';

type BrokenRow = {
  org_id: string;
  broken_id: string;
  broken_triggered_at: string;
  expected_hash: string;
  stored_hash: string | null;
};

Deno.serve(async (req: Request) => {
  // Server-only worker: emit the non-browser CORS origin (D6).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: serverCorsHeaders() });
  }

  const authHeader = req.headers.get(HTTP_HEADERS.AUTHORIZATION) ?? '';
  const expected = Deno.env.get('AUDIT_VERIFY_SECRET');
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return fromApiError(new ApiError(ERROR_CODES.UNAUTHORIZED));
  }

  let client;
  try {
    client = admin();
  } catch (err) {
    if (err instanceof ApiError) return fromApiError(err);
    return fromApiError(internalError('audit-chain-verify:admin', err));
  }

  const { data: orgs, error: orgErr } = await client
    .from('organizations')
    .select('id')
    .is('deleted_at', null);

  if (orgErr) {
    return fromApiError(internalError('audit-chain-verify:org_list', orgErr));
  }

  const allBroken: BrokenRow[] = [];
  for (const row of orgs ?? []) {
    const { data, error } = await client.rpc('verify_audit_chain', {
      p_org_id: row.id,
    });
    if (error) {
      return fromApiError(internalError('audit-chain-verify:rpc', error));
    }
    for (const r of (data as Array<Omit<BrokenRow, 'org_id'>>) ?? []) {
      allBroken.push({ org_id: row.id, ...r });
    }
  }

  // Baselined residue: hash-chain breaks that predate migration 0085 (audit
  // chain same-transaction ordering fix). Both rows live in internal and smoke
  // orgs, not a customer org, and are benign historical artifacts, not
  // tampering. They cannot be repaired without rewriting append-only audit_log
  // history, so they are excluded from broken_count to keep the nightly alert
  // meaningful: any NEW break (an id not listed here) still fails the job.
  // Verified 2026-06-24; see docs/operations/probes.md.
  const BASELINED_BROKEN_IDS = new Set<string>([
    '0e1ff7df-5bf4-4843-9c7e-aeb60bd8b0ba', // org "Kitstak", triggered 2026-05-22
    '378e9157-adbf-4679-a9b5-9bcd29b06623', // org "Cowork Smoke Test Co.", triggered 2026-05-27
  ]);

  const broken = allBroken.filter((r) => !BASELINED_BROKEN_IDS.has(r.broken_id));
  const baselined = allBroken.filter((r) => BASELINED_BROKEN_IDS.has(r.broken_id));

  return ok({
    checked_org_count: (orgs ?? []).length,
    broken_count: broken.length,
    broken,
    baselined_count: baselined.length,
    baselined,
  });
});
