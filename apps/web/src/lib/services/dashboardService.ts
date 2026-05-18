// Dashboard service. Wraps GET /dashboard-api/dashboard/summary.

import { apiRequest } from '@/lib/apiClient';
import {
  DashboardSummarySchema,
  type DashboardSummary,
} from '@/lib/types/cross_cutting';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/summary', {
    method: 'GET',
  });
  return DashboardSummarySchema.parse(data);
}
