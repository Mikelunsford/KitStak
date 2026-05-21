// KitCost service. Path C / C2 of the KitCost pillar wiring plan.
//
// One read-only endpoint backed by the dashboard-api bundle. The dashboard
// composes four panels (KPIs, revenue trend, top customers, project margins)
// in a single round-trip; the SPA never needs to fan out.

import { apiRequest } from '@/lib/apiClient';
import {
  KitCostSummarySchema,
  type KitCostSummary,
} from '@/lib/types/cross_cutting';

export type { KitCostSummary };

export async function fetchKitCostSummary(): Promise<KitCostSummary> {
  const data = await apiRequest<unknown>('/dashboard-api/kitcost/summary', {
    method: 'GET',
  });
  return KitCostSummarySchema.parse(data);
}
