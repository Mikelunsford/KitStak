// Dashboard service. Wraps the dashboard-api summary reads: the org-wide
// /dashboard/summary plus the per-section /dashboard/sell-summary and
// /dashboard/money-summary (Section Dashboards, Phase 1).

import { apiRequest } from '@/lib/apiClient';
import {
  DashboardSummarySchema,
  MoneySummarySchema,
  SellSummarySchema,
  type DashboardSummary,
  type MoneySummary,
  type SellSummary,
} from '@/lib/types/cross_cutting';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/summary', {
    method: 'GET',
  });
  return DashboardSummarySchema.parse(data);
}

export async function getSellSummary(): Promise<SellSummary> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/sell-summary', {
    method: 'GET',
  });
  return SellSummarySchema.parse(data);
}

export async function getMoneySummary(): Promise<MoneySummary> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/money-summary', {
    method: 'GET',
  });
  return MoneySummarySchema.parse(data);
}
