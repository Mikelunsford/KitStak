// Dashboard service. Wraps the dashboard-api summary reads: the org-wide
// /dashboard/summary plus the per-section /dashboard/sell-summary and
// /dashboard/money-summary (Section Dashboards, Phase 1).

import { apiRequest } from '@/lib/apiClient';
import {
  BuySummarySchema,
  DashboardPrefSavedSchema,
  DashboardPrefsSchema,
  DashboardSummarySchema,
  InventorySummarySchema,
  MoneySummarySchema,
  ProductionSummarySchema,
  SellSummarySchema,
  WorkforceSummarySchema,
  type BuySummary,
  type DashboardPrefSaved,
  type DashboardPrefUpdate,
  type DashboardPrefs,
  type DashboardSummary,
  type InventorySummary,
  type MoneySummary,
  type ProductionSummary,
  type SellSummary,
  type WorkforceSummary,
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

export async function getInventorySummary(): Promise<InventorySummary> {
  const data = await apiRequest<unknown>(
    '/dashboard-api/dashboard/inventory-summary',
    { method: 'GET' },
  );
  return InventorySummarySchema.parse(data);
}

export async function getProductionSummary(): Promise<ProductionSummary> {
  const data = await apiRequest<unknown>(
    '/dashboard-api/dashboard/production-summary',
    { method: 'GET' },
  );
  return ProductionSummarySchema.parse(data);
}

export async function getBuySummary(): Promise<BuySummary> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/buy-summary', {
    method: 'GET',
  });
  return BuySummarySchema.parse(data);
}

export async function getWorkforceSummary(): Promise<WorkforceSummary> {
  const data = await apiRequest<unknown>(
    '/dashboard-api/dashboard/workforce-summary',
    { method: 'GET' },
  );
  return WorkforceSummarySchema.parse(data);
}

// Personalization: per-user dashboard layout. GET returns the caller's saved
// layouts as a section_key -> layout map; PUT replaces one section's layout
// (idempotency key minted by apiRequest).
export async function getDashboardPrefs(): Promise<DashboardPrefs> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/prefs', {
    method: 'GET',
  });
  return DashboardPrefsSchema.parse(data);
}

export async function setDashboardPref(
  input: DashboardPrefUpdate,
): Promise<DashboardPrefSaved> {
  const data = await apiRequest<unknown>('/dashboard-api/dashboard/prefs', {
    method: 'PUT',
    body: input,
  });
  return DashboardPrefSavedSchema.parse(data);
}
