// SIZE EXCEPTION (E8, F-Wave10-REVIEW-REMEDIATION): this file exceeds the
// 800-line coding-style guideline by design. The flat ROUTES table is a
// single-source-of-truth canon: every route entry, its guard, layout, and
// plugin gate live in one declaration so the routing map stays auditable in a
// single read. Splitting it would fragment the canon and add cross-file
// indirection without reducing complexity. The size is intentional, not debt.

import { type LazyExoticComponent, type ComponentType } from 'react';

import { FEATURE_FLAGS } from '@/lib/constants';
import { lazyWithReload as lazy } from '@/lib/lazyWithReload';

/**
 * Flat ROUTES table. Per 00-canon/01-architecture.md "Routing". react-router-dom
 * v6 with a flat ROUTES table and lazy code splits. No nested JSX <Route> trees.
 *
 * `guard` decides which auth wrapper wraps the element at render time. `layout`
 * is informational; ProtectedRoute / AdminProtectedRoute wrap in <AppShell>
 * themselves, public/portal routes render bare.
 *
 * `requiresPlugin` enforces the SPA mirror of the Edge bundle-level plugin
 * gate from supabase/functions/_shared/bundleGate.ts. When the flag is off
 * for the active org the route renders the NotFound surface instead of the
 * element. Constitutional rule: plugin bundle gates return 404, not 403
 * FEATURE_DISABLED (that envelope is for per-route flags). See
 * auth/RequirePlugin.tsx and F-Wave9-COWORK-SMOKE-06.
 */

export type RouteGuard = 'protected' | 'admin' | 'portal' | 'public';
export type RouteLayout = 'shell' | 'auth' | 'unauthenticated';

export interface RouteSpec {
  path: string;
  element: LazyExoticComponent<ComponentType<unknown>>;
  guard: RouteGuard;
  layout: RouteLayout;
  /**
   * Pillar plugin flag, e.g. FEATURE_FLAGS.PLUGINS_THREE_PL. When set,
   * RequirePlugin renders the NotFoundPage when the flag is off for the
   * active org. Distinct from per-route feature flag gating.
   */
  requiresPlugin?: string;
  /**
   * Marks a deep-link redirect entry (see pages/_redirects/SpineMoveRedirect).
   * Redirect entries are never plugin-gated: inferPluginForPath returns
   * undefined for them, so a legacy path that still lives under a gated
   * prefix redirects to its new spine home instead of rendering NotFound
   * when the pillar plugin is off. Part of the spine plus add-ons re-route.
   */
  isRedirect?: boolean;
}

// Lazy code splits. keep imports inside the lazy() callback so each route
// pulls its own chunk. Pages export named components; lazy() needs a default,
// so we adapt at the dynamic-import boundary.
const SignInPage = lazy(() =>
  import('./pages/SignInPage').then((m) => ({ default: m.SignInPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
// Section Dashboards (Phase 1). One page serves all eight task-section homes;
// it resolves which section from the pathname. Lazy so the section panels and
// their summary hooks stay out of the eager index chunk.
const SectionHomePage = lazy(() =>
  import('./pages/sections/SectionHomePage').then((m) => ({
    default: m.SectionHomePage,
  })),
);
const FeatureUnavailablePage = lazy(() =>
  import('./pages/FeatureUnavailablePage').then((m) => ({
    default: m.FeatureUnavailablePage,
  })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
// F-Wave9-COWORK-SMOKE-03: hard-error surface for the NO_ACTIVE_ORG state.
// ProtectedRoute renders this inline when the JWT lacks the claim; the
// standalone route keeps the surface deep-linkable for support flows.
const NoActiveOrgPage = lazy(() =>
  import('./pages/NoActiveOrgPage').then((m) => ({
    default: m.NoActiveOrgPage,
  })),
);

// === Agent A: Admin routes ===
const SettingsPage = lazy(() =>
  import('./pages/admin/SettingsPage').then((m) => ({
    default: m.SettingsPage,
  })),
);
const BrandingSettingsPage = lazy(() =>
  import('./pages/admin/BrandingSettingsPage').then((m) => ({
    default: m.BrandingSettingsPage,
  })),
);
const FeatureFlagsAdminPage = lazy(() =>
  import('./pages/admin/FeatureFlagsAdminPage').then((m) => ({
    default: m.FeatureFlagsAdminPage,
  })),
);
const NumberingAdminPage = lazy(() =>
  import('./pages/admin/NumberingAdminPage').then((m) => ({
    default: m.NumberingAdminPage,
  })),
);
// F-Wave9-STAFF-INVITE-CHASSIS-01: /admin/members staff invite surface.
const MembersPage = lazy(() =>
  import('./pages/admin/MembersPage').then((m) => ({
    default: m.MembersPage,
  })),
);
// Stripe wiring (item 9): /admin/billing. Lazy so the page lands in its
// own chunk and the SPA index chunk stays under the 40 kB gzip budget.
const BillingPage = lazy(() =>
  import('./pages/admin/billing/BillingPage').then((m) => ({
    default: m.BillingPage,
  })),
);
// R-W13-AUTH-01: /admin/sso single sign-on connection management.
const SsoConnectionsPage = lazy(() =>
  import('./pages/admin/SsoConnectionsPage').then((m) => ({
    default: m.SsoConnectionsPage,
  })),
);
// === End Agent A ===

// === Feedback / support ticketing (migration 0140) ===
// Tester surfaces (/feedback/*) are protected-shell, open to any authenticated
// tenant user. Staff surfaces (/admin/feedback*) are also protected-shell, not
// admin-guarded: gating is by platform_staff via useIsPlatformStaff() inside
// the page, not a tenant role cap. lazy() so each lands in its own chunk.
const MyFeedbackListPage = lazy(() =>
  import('./pages/feedback/MyFeedbackListPage').then((m) => ({
    default: m.MyFeedbackListPage,
  })),
);
const MyFeedbackDetailPage = lazy(() =>
  import('./pages/feedback/MyFeedbackDetailPage').then((m) => ({
    default: m.MyFeedbackDetailPage,
  })),
);
const AdminFeedbackInboxPage = lazy(() =>
  import('./pages/admin/AdminFeedbackInboxPage').then((m) => ({
    default: m.AdminFeedbackInboxPage,
  })),
);
const AdminFeedbackTicketPage = lazy(() =>
  import('./pages/admin/AdminFeedbackTicketPage').then((m) => ({
    default: m.AdminFeedbackTicketPage,
  })),
);
// === End Feedback ===

// === Agent B: CRM lazy imports ===
const CustomersListPage = lazy(() =>
  import('./pages/crm/customers/CustomersListPage').then((m) => ({
    default: m.CustomersListPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import('./pages/crm/customers/CustomerDetailPage').then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const CustomerCreatePage = lazy(() =>
  import('./pages/crm/customers/CustomerCreatePage').then((m) => ({
    default: m.CustomerCreatePage,
  })),
);
const CustomerEditPage = lazy(() =>
  import('./pages/crm/customers/CustomerEditPage').then((m) => ({
    default: m.CustomerEditPage,
  })),
);
const ContactsListPage = lazy(() =>
  import('./pages/crm/contacts/ContactsListPage').then((m) => ({
    default: m.ContactsListPage,
  })),
);
const ContactDetailPage = lazy(() =>
  import('./pages/crm/contacts/ContactDetailPage').then((m) => ({
    default: m.ContactDetailPage,
  })),
);
const ActivitiesListPage = lazy(() =>
  import('./pages/crm/activities/ActivitiesListPage').then((m) => ({
    default: m.ActivitiesListPage,
  })),
);
const ActivityCreatePage = lazy(() =>
  import('./pages/crm/activities/ActivityCreatePage').then((m) => ({
    default: m.ActivityCreatePage,
  })),
);
const LeadsKanbanPage = lazy(() =>
  import('./pages/crm/leads/LeadsKanbanPage').then((m) => ({
    default: m.LeadsKanbanPage,
  })),
);
const LeadDetailPage = lazy(() =>
  import('./pages/crm/leads/LeadDetailPage').then((m) => ({
    default: m.LeadDetailPage,
  })),
);
const LeadConvertPage = lazy(() =>
  import('./pages/crm/leads/LeadConvertPage').then((m) => ({
    default: m.LeadConvertPage,
  })),
);
const OpportunitiesPipelinePage = lazy(() =>
  import('./pages/crm/opportunities/OpportunitiesPipelinePage').then((m) => ({
    default: m.OpportunitiesPipelinePage,
  })),
);
const OpportunityDetailPage = lazy(() =>
  import('./pages/crm/opportunities/OpportunityDetailPage').then((m) => ({
    default: m.OpportunityDetailPage,
  })),
);
const LeadEditPage = lazy(() =>
  import('./pages/crm/leads/LeadEditPage').then((m) => ({
    default: m.LeadEditPage,
  })),
);
const OpportunityEditPage = lazy(() =>
  import('./pages/crm/opportunities/OpportunityEditPage').then((m) => ({
    default: m.OpportunityEditPage,
  })),
);
const ContactEditPage = lazy(() =>
  import('./pages/crm/contacts/ContactEditPage').then((m) => ({
    default: m.ContactEditPage,
  })),
);
// === End Agent B: CRM lazy imports ===

// === Agent F: Cross-cutting lazy imports ===
const GlobalSearchResultsPage = lazy(() =>
  import('./pages/search/GlobalSearchResultsPage').then((m) => ({
    default: m.GlobalSearchResultsPage,
  })),
);
const ImportWizardPage = lazy(() =>
  import('./pages/imports/ImportWizardPage').then((m) => ({
    default: m.ImportWizardPage,
  })),
);
const ImportHistoryPage = lazy(() =>
  import('./pages/imports/ImportHistoryPage').then((m) => ({
    default: m.ImportHistoryPage,
  })),
);
const ExportsPage = lazy(() =>
  import('./pages/exports/ExportsPage').then((m) => ({ default: m.ExportsPage })),
);
const PortalSignInPage = lazy(() =>
  import('./pages/portal/PortalSignInPage').then((m) => ({
    default: m.PortalSignInPage,
  })),
);
const PortalDashboardPage = lazy(() =>
  import('./pages/portal/PortalDashboardPage').then((m) => ({
    default: m.PortalDashboardPage,
  })),
);
const PortalInvoicesPage = lazy(() =>
  import('./pages/portal/PortalInvoicesPage').then((m) => ({
    default: m.PortalInvoicesPage,
  })),
);
const PortalQuotesPage = lazy(() =>
  import('./pages/portal/PortalQuotesPage').then((m) => ({
    default: m.PortalQuotesPage,
  })),
);
const PortalProjectsPage = lazy(() =>
  import('./pages/portal/PortalProjectsPage').then((m) => ({
    default: m.PortalProjectsPage,
  })),
);
// === End Agent F: Cross-cutting lazy imports ===

// === Agent C: Sales lazy imports ===
const ItemsListPage = lazy(() =>
  import('./pages/3pl-operations/items/ItemsListPage').then((m) => ({
    default: m.ItemsListPage,
  })),
);
const ItemDetailPage = lazy(() =>
  import('./pages/3pl-operations/items/ItemDetailPage').then((m) => ({
    default: m.ItemDetailPage,
  })),
);
const ItemCreatePage = lazy(() =>
  import('./pages/3pl-operations/items/ItemCreatePage').then((m) => ({
    default: m.ItemCreatePage,
  })),
);
const ItemEditPage = lazy(() =>
  import('./pages/3pl-operations/items/ItemEditPage').then((m) => ({
    default: m.ItemEditPage,
  })),
);
const TaxesPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/TaxesPage').then((m) => ({
    default: m.TaxesPage,
  })),
);
const CurrenciesPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/CurrenciesPage').then((m) => ({
    default: m.CurrenciesPage,
  })),
);
const ExchangeRatesPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/ExchangeRatesPage').then((m) => ({
    default: m.ExchangeRatesPage,
  })),
);
const PaymentMethodsPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PaymentMethodsPage').then((m) => ({
    default: m.PaymentMethodsPage,
  })),
);
const PricingTiersPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PricingTiersPage').then((m) => ({
    default: m.PricingTiersPage,
  })),
);
const ValueAddedServicesPage = lazy(() =>
  import('./pages/3pl-operations/vas/ValueAddedServicesPage').then((m) => ({
    default: m.ValueAddedServicesPage,
  })),
);
// === WS4 sales-config self-serve routes ===
const TaxCreatePage = lazy(() =>
  import('./pages/3pl-operations/sales-config/TaxCreatePage').then((m) => ({
    default: m.TaxCreatePage,
  })),
);
const TaxEditPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/TaxEditPage').then((m) => ({
    default: m.TaxEditPage,
  })),
);
const PaymentMethodCreatePage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PaymentMethodCreatePage').then((m) => ({
    default: m.PaymentMethodCreatePage,
  })),
);
const PaymentMethodEditPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PaymentMethodEditPage').then((m) => ({
    default: m.PaymentMethodEditPage,
  })),
);
const PricingTierCreatePage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PricingTierCreatePage').then((m) => ({
    default: m.PricingTierCreatePage,
  })),
);
const PricingTierEditPage = lazy(() =>
  import('./pages/3pl-operations/sales-config/PricingTierEditPage').then((m) => ({
    default: m.PricingTierEditPage,
  })),
);
const ExchangeRateCreatePage = lazy(() =>
  import('./pages/3pl-operations/sales-config/ExchangeRateCreatePage').then((m) => ({
    default: m.ExchangeRateCreatePage,
  })),
);
const ValueAddedServiceCreatePage = lazy(() =>
  import('./pages/3pl-operations/vas/ValueAddedServiceCreatePage').then((m) => ({
    default: m.ValueAddedServiceCreatePage,
  })),
);
const ValueAddedServiceEditPage = lazy(() =>
  import('./pages/3pl-operations/vas/ValueAddedServiceEditPage').then((m) => ({
    default: m.ValueAddedServiceEditPage,
  })),
);
// === End WS4 sales-config self-serve routes ===
const QuotesListPage = lazy(() =>
  import('./pages/3pl-operations/quotes/QuotesListPage').then((m) => ({
    default: m.QuotesListPage,
  })),
);
const QuoteDetailPage = lazy(() =>
  import('./pages/3pl-operations/quotes/QuoteDetailPage').then((m) => ({
    default: m.QuoteDetailPage,
  })),
);
const QuoteCreatePage = lazy(() =>
  import('./pages/3pl-operations/quotes/QuoteCreatePage').then((m) => ({
    default: m.QuoteCreatePage,
  })),
);
const ProjectsListPage = lazy(() =>
  import('./pages/3pl-operations/projects/ProjectsListPage').then((m) => ({
    default: m.ProjectsListPage,
  })),
);
const ProjectDetailPage = lazy(() =>
  import('./pages/3pl-operations/projects/ProjectDetailPage').then((m) => ({
    default: m.ProjectDetailPage,
  })),
);
const ProjectCreatePage = lazy(() =>
  import('./pages/3pl-operations/projects/ProjectCreatePage').then((m) => ({
    default: m.ProjectCreatePage,
  })),
);
const ProjectEditPage = lazy(() =>
  import('./pages/3pl-operations/projects/ProjectEditPage').then((m) => ({
    default: m.ProjectEditPage,
  })),
);
// === End Agent C: Sales lazy imports ===

// === Agent E: Vendors/Inventory/Ops routes ===
const VendorsListPage = lazy(() =>
  import('./pages/3pl-operations/vendors/VendorsListPage').then((m) => ({ default: m.VendorsListPage })),
);
const VendorDetailPage = lazy(() =>
  import('./pages/3pl-operations/vendors/VendorDetailPage').then((m) => ({ default: m.VendorDetailPage })),
);
const VendorCreatePage = lazy(() =>
  import('./pages/3pl-operations/vendors/VendorCreatePage').then((m) => ({ default: m.VendorCreatePage })),
);
const VendorEditPage = lazy(() =>
  import('./pages/3pl-operations/vendors/VendorEditPage').then((m) => ({ default: m.VendorEditPage })),
);
const POsListPage = lazy(() =>
  import('./pages/3pl-operations/purchase-orders/POsListPage').then((m) => ({ default: m.POsListPage })),
);
const PODetailPage = lazy(() =>
  import('./pages/3pl-operations/purchase-orders/PODetailPage').then((m) => ({ default: m.PODetailPage })),
);
const POCreatePage = lazy(() =>
  import('./pages/3pl-operations/purchase-orders/POCreatePage').then((m) => ({ default: m.POCreatePage })),
);
const VendorBillsListPage = lazy(() =>
  import('./pages/3pl-operations/vendor-bills/VendorBillsListPage').then((m) => ({ default: m.VendorBillsListPage })),
);
const VendorBillDetailPage = lazy(() =>
  import('./pages/3pl-operations/vendor-bills/VendorBillDetailPage').then((m) => ({ default: m.VendorBillDetailPage })),
);
const VendorBillEditPage = lazy(() =>
  import('./pages/3pl-operations/vendor-bills/VendorBillEditPage').then((m) => ({ default: m.VendorBillEditPage })),
);
const ExpensesListPage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpensesListPage').then((m) => ({ default: m.ExpensesListPage })),
);
const ExpenseDetailPage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage })),
);
const ExpenseCreatePage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpenseCreatePage').then((m) => ({ default: m.ExpenseCreatePage })),
);
const ExpenseEditPage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpenseEditPage').then((m) => ({ default: m.ExpenseEditPage })),
);
const WarehousesListPage = lazy(() =>
  import('./pages/3pl-operations/warehouses/WarehousesListPage').then((m) => ({ default: m.WarehousesListPage })),
);
const WarehouseDetailPage = lazy(() =>
  import('./pages/3pl-operations/warehouses/WarehouseDetailPage').then((m) => ({ default: m.WarehouseDetailPage })),
);
const WarehouseCreatePage = lazy(() =>
  import('./pages/3pl-operations/warehouses/WarehouseCreatePage').then((m) => ({ default: m.WarehouseCreatePage })),
);
const WarehouseEditPage = lazy(() =>
  import('./pages/3pl-operations/warehouses/WarehouseEditPage').then((m) => ({ default: m.WarehouseEditPage })),
);
const BomsListPage = lazy(() =>
  import('./pages/3pl-operations/boms/BomsListPage').then((m) => ({ default: m.BomsListPage })),
);
const BomCreatePage = lazy(() =>
  import('./pages/3pl-operations/boms/BomCreatePage').then((m) => ({ default: m.BomCreatePage })),
);
const BomDetailPage = lazy(() =>
  import('./pages/3pl-operations/boms/BomDetailPage').then((m) => ({ default: m.BomDetailPage })),
);
const StockLevelsPage = lazy(() =>
  import('./pages/3pl-operations/stock/StockLevelsPage').then((m) => ({ default: m.StockLevelsPage })),
);
const StockMovementsPage = lazy(() =>
  import('./pages/3pl-operations/stock/StockMovementsPage').then((m) => ({ default: m.StockMovementsPage })),
);
const ReceivingOrdersListPage = lazy(() =>
  import('./pages/3pl-operations/receiving/ReceivingOrdersListPage').then((m) => ({ default: m.ReceivingOrdersListPage })),
);
const ReceivingOrderDetailPage = lazy(() =>
  import('./pages/3pl-operations/receiving/ReceivingOrderDetailPage').then((m) => ({ default: m.ReceivingOrderDetailPage })),
);
const ProductionRunDetailPage = lazy(() =>
  import('./pages/3pl-operations/production/ProductionRunDetailPage').then((m) => ({ default: m.ProductionRunDetailPage })),
);
// BNEW-2 (PR-A, 2026-05-22 v2 smoke): the legacy production list/create
// surfaces are replaced by /manufacturing/runs and /manufacturing/runs/new.
// The list and create routes stay registered as <Navigate> redirects so
// existing deep links and bookmarks land on the canonical surface; the
// detail route at /3pl-operations/production/:id keeps rendering the
// detail page so deep links from before the migration still resolve.
// Follow-up: F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01.
const LegacyProductionListRedirect = lazy(() =>
  import('./pages/3pl-operations/production/LegacyProductionRedirect').then((m) => ({
    default: m.LegacyProductionListRedirect,
  })),
);
const LegacyProductionCreateRedirect = lazy(() =>
  import('./pages/3pl-operations/production/LegacyProductionRedirect').then((m) => ({
    default: m.LegacyProductionCreateRedirect,
  })),
);
// Spine plus add-ons re-route: one generic redirect serves every moved spine
// path. See pages/_redirects/SpineMoveRedirect and the redirect block at the
// tail of RAW_ROUTES.
const SpineMoveRedirect = lazy(() =>
  import('./pages/_redirects/SpineMoveRedirect').then((m) => ({
    default: m.SpineMoveRedirect,
  })),
);
const ShipmentsListPage = lazy(() =>
  import('./pages/3pl-operations/shipments/ShipmentsListPage').then((m) => ({ default: m.ShipmentsListPage })),
);
const ShipmentDetailPage = lazy(() =>
  import('./pages/3pl-operations/shipments/ShipmentDetailPage').then((m) => ({ default: m.ShipmentDetailPage })),
);
// Wave 12 Phase A1: 3PL commercial layer (Accounts).
const AccountsListPage = lazy(() =>
  import('./pages/3pl-operations/accounts/AccountsListPage').then((m) => ({ default: m.AccountsListPage })),
);
const AccountDetailPage = lazy(() =>
  import('./pages/3pl-operations/accounts/AccountDetailPage').then((m) => ({ default: m.AccountDetailPage })),
);
const AccountCreatePage = lazy(() =>
  import('./pages/3pl-operations/accounts/AccountCreatePage').then((m) => ({ default: m.AccountCreatePage })),
);
const AccountEditPage = lazy(() =>
  import('./pages/3pl-operations/accounts/AccountEditPage').then((m) => ({ default: m.AccountEditPage })),
);
// Wave 12 Phase A2: 3PL Job Builder.
const JobTemplatesListPage = lazy(() =>
  import('./pages/3pl-operations/job-builders/JobTemplatesListPage').then((m) => ({ default: m.JobTemplatesListPage })),
);
const JobTemplateDetailPage = lazy(() =>
  import('./pages/3pl-operations/job-builders/JobTemplateDetailPage').then((m) => ({ default: m.JobTemplateDetailPage })),
);
const JobTemplateCreatePage = lazy(() =>
  import('./pages/3pl-operations/job-builders/JobTemplateCreatePage').then((m) => ({ default: m.JobTemplateCreatePage })),
);
// Wave 12 Phase A5: 3PL Supply Plan.
const SupplyPlansListPage = lazy(() =>
  import('./pages/3pl-operations/supply-plans/SupplyPlansListPage').then((m) => ({ default: m.SupplyPlansListPage })),
);
const SupplyPlanDetailPage = lazy(() =>
  import('./pages/3pl-operations/supply-plans/SupplyPlanDetailPage').then((m) => ({ default: m.SupplyPlanDetailPage })),
);
const SupplyPlanCreatePage = lazy(() =>
  import('./pages/3pl-operations/supply-plans/SupplyPlanCreatePage').then((m) => ({ default: m.SupplyPlanCreatePage })),
);
// Wave 12 Phase A6: 3PL Job Runs.
const JobRunsListPage = lazy(() =>
  import('./pages/3pl-operations/job-runs/JobRunsListPage').then((m) => ({ default: m.JobRunsListPage })),
);
const JobRunDetailPage = lazy(() =>
  import('./pages/3pl-operations/job-runs/JobRunDetailPage').then((m) => ({ default: m.JobRunDetailPage })),
);
const JobRunCreatePage = lazy(() =>
  import('./pages/3pl-operations/job-runs/JobRunCreatePage').then((m) => ({ default: m.JobRunCreatePage })),
);
// Wave 12 Phase A7: 3PL Billing Review + Job Profitability.
const BillingReviewsListPage = lazy(() =>
  import('./pages/3pl-operations/billing-reviews/BillingReviewsListPage').then((m) => ({ default: m.BillingReviewsListPage })),
);
const BillingReviewDetailPage = lazy(() =>
  import('./pages/3pl-operations/billing-reviews/BillingReviewDetailPage').then((m) => ({ default: m.BillingReviewDetailPage })),
);
const BillingReviewCreatePage = lazy(() =>
  import('./pages/3pl-operations/billing-reviews/BillingReviewCreatePage').then((m) => ({ default: m.BillingReviewCreatePage })),
);
const ProfitabilityPage = lazy(() =>
  import('./pages/3pl-operations/profitability/ProfitabilityPage').then((m) => ({ default: m.ProfitabilityPage })),
);
// === End Agent E ===

// === Agent D: Invoicing + Finance routes ===
const InvoicesListPage = lazy(() =>
  import('./pages/3pl-operations/invoicing/InvoicesListPage').then((m) => ({
    default: m.InvoicesListPage,
  })),
);
const InvoiceDetailPage = lazy(() =>
  import('./pages/3pl-operations/invoicing/InvoiceDetailPage').then((m) => ({
    default: m.InvoiceDetailPage,
  })),
);
const InvoiceCreatePage = lazy(() =>
  import('./pages/3pl-operations/invoicing/InvoiceCreatePage').then((m) => ({
    default: m.InvoiceCreatePage,
  })),
);
const InvoiceSendPage = lazy(() =>
  import('./pages/3pl-operations/invoicing/InvoiceSendPage').then((m) => ({
    default: m.InvoiceSendPage,
  })),
);
const PaymentDetailPage = lazy(() =>
  import('./pages/3pl-operations/payments/PaymentDetailPage').then((m) => ({
    default: m.PaymentDetailPage,
  })),
);
const PaymentsListPage = lazy(() =>
  import('./pages/3pl-operations/payments/PaymentsListPage').then((m) => ({
    default: m.PaymentsListPage,
  })),
);
const PaymentApplyPage = lazy(() =>
  import('./pages/3pl-operations/payments/PaymentApplyPage').then((m) => ({
    default: m.PaymentApplyPage,
  })),
);
const CreditNotesListPage = lazy(() =>
  import('./pages/3pl-operations/credit-notes/CreditNotesListPage').then((m) => ({
    default: m.CreditNotesListPage,
  })),
);
const CreditNoteDetailPage = lazy(() =>
  import('./pages/3pl-operations/credit-notes/CreditNoteDetailPage').then((m) => ({
    default: m.CreditNoteDetailPage,
  })),
);
const CreditNoteApplyPage = lazy(() =>
  import('./pages/3pl-operations/credit-notes/CreditNoteApplyPage').then((m) => ({
    default: m.CreditNoteApplyPage,
  })),
);
const ChartOfAccountsPage = lazy(() =>
  import('./pages/finance/ChartOfAccountsPage').then((m) => ({
    default: m.ChartOfAccountsPage,
  })),
);
const ChartOfAccountCreatePage = lazy(() =>
  import('./pages/finance/ChartOfAccountCreatePage').then((m) => ({
    default: m.ChartOfAccountCreatePage,
  })),
);
const ChartOfAccountEditPage = lazy(() =>
  import('./pages/finance/ChartOfAccountEditPage').then((m) => ({
    default: m.ChartOfAccountEditPage,
  })),
);
const JournalEntriesListPage = lazy(() =>
  import('./pages/finance/JournalEntriesListPage').then((m) => ({
    default: m.JournalEntriesListPage,
  })),
);
const JournalEntryDetailPage = lazy(() =>
  import('./pages/finance/JournalEntryDetailPage').then((m) => ({
    default: m.JournalEntryDetailPage,
  })),
);
const PeriodClosePage = lazy(() =>
  import('./pages/finance/PeriodClosePage').then((m) => ({
    default: m.PeriodClosePage,
  })),
);
// === End Agent D ===

// === Agent 6.5-A: quote-to-cash create routes ===
const PaymentCreatePage = lazy(() =>
  import('./pages/3pl-operations/payments/PaymentCreatePage').then((m) => ({
    default: m.PaymentCreatePage,
  })),
);
const CreditNoteCreatePage = lazy(() =>
  import('./pages/3pl-operations/credit-notes/CreditNoteCreatePage').then((m) => ({
    default: m.CreditNoteCreatePage,
  })),
);
const JournalEntryCreatePage = lazy(() =>
  import('./pages/finance/JournalEntryCreatePage').then((m) => ({
    default: m.JournalEntryCreatePage,
  })),
);
// === End Agent 6.5-A ===

// === Agent 6.5-D: crm lazy imports ===
const LeadCreatePage = lazy(() =>
  import('./pages/crm/leads/LeadCreatePage').then((m) => ({
    default: m.LeadCreatePage,
  })),
);
const OpportunityCreatePage = lazy(() =>
  import('./pages/crm/opportunities/OpportunityCreatePage').then((m) => ({
    default: m.OpportunityCreatePage,
  })),
);
const ContactCreatePage = lazy(() =>
  import('./pages/crm/contacts/ContactCreatePage').then((m) => ({
    default: m.ContactCreatePage,
  })),
);
// === End Agent 6.5-D ===

// === Agent 6.5-C: ops + procurement lazy imports ===
const ReceivingOrderCreatePage = lazy(() =>
  import('./pages/3pl-operations/receiving/ReceivingOrderCreatePage').then((m) => ({
    default: m.ReceivingOrderCreatePage,
  })),
);
const ShipmentCreatePage = lazy(() =>
  import('./pages/3pl-operations/shipments/ShipmentCreatePage').then((m) => ({
    default: m.ShipmentCreatePage,
  })),
);
const VendorBillCreatePage = lazy(() =>
  import('./pages/3pl-operations/vendor-bills/VendorBillCreatePage').then((m) => ({
    default: m.VendorBillCreatePage,
  })),
);
// === End Agent 6.5-C ===

// === Path A5: Manufacturing pillar routes ===
const ManufacturingHomePage = lazy(() =>
  import('./pages/manufacturing/ManufacturingHomePage').then((m) => ({
    default: m.ManufacturingHomePage,
  })),
);
const ManufacturingRunsListPage = lazy(() =>
  import('./pages/manufacturing/ManufacturingRunsListPage').then((m) => ({
    default: m.ManufacturingRunsListPage,
  })),
);
const ManufacturingRunCreatePage = lazy(() =>
  import('./pages/manufacturing/ManufacturingRunCreatePage').then((m) => ({
    default: m.ManufacturingRunCreatePage,
  })),
);
const ManufacturingRunFromBomPage = lazy(() =>
  import('./pages/manufacturing/ManufacturingRunFromBomPage').then((m) => ({
    default: m.ManufacturingRunFromBomPage,
  })),
);
const ManufacturingRunDetailPage = lazy(() =>
  import('./pages/manufacturing/ManufacturingRunDetailPage').then((m) => ({
    default: m.ManufacturingRunDetailPage,
  })),
);
// === End Path A5 ===

// === Path C2: KitCost pillar routes ===
const KitCostDashboardPage = lazy(() =>
  import('./pages/kitcost/KitCostDashboardPage').then((m) => ({
    default: m.KitCostDashboardPage,
  })),
);
// === End Path C2 ===

// === Co-Pack and Ecom pillar routes ===
const CoPackHomePage = lazy(() =>
  import('./pages/copack/CoPackHomePage').then((m) => ({
    default: m.CoPackHomePage,
  })),
);
const SalesOrdersListPage = lazy(() =>
  import('./pages/copack/SalesOrdersListPage').then((m) => ({
    default: m.SalesOrdersListPage,
  })),
);
const SalesOrderCreatePage = lazy(() =>
  import('./pages/copack/SalesOrderCreatePage').then((m) => ({
    default: m.SalesOrderCreatePage,
  })),
);
const SalesOrderDetailPage = lazy(() =>
  import('./pages/copack/SalesOrderDetailPage').then((m) => ({
    default: m.SalesOrderDetailPage,
  })),
);
const KittingJobsListPage = lazy(() =>
  import('./pages/copack/KittingJobsListPage').then((m) => ({
    default: m.KittingJobsListPage,
  })),
);
const KittingJobCreatePage = lazy(() =>
  import('./pages/copack/KittingJobCreatePage').then((m) => ({
    default: m.KittingJobCreatePage,
  })),
);
const KittingJobDetailPage = lazy(() =>
  import('./pages/copack/KittingJobDetailPage').then((m) => ({
    default: m.KittingJobDetailPage,
  })),
);
const ChannelsListPage = lazy(() =>
  import('./pages/copack/ChannelsListPage').then((m) => ({
    default: m.ChannelsListPage,
  })),
);
const FulfillmentsListPage = lazy(() =>
  import('./pages/copack/FulfillmentsListPage').then((m) => ({
    default: m.FulfillmentsListPage,
  })),
);
const FulfillmentCreatePage = lazy(() =>
  import('./pages/copack/FulfillmentCreatePage').then((m) => ({
    default: m.FulfillmentCreatePage,
  })),
);
const FulfillmentDetailPage = lazy(() =>
  import('./pages/copack/FulfillmentDetailPage').then((m) => ({
    default: m.FulfillmentDetailPage,
  })),
);
// === End Co-Pack and Ecom ===

// === KitForce pillar routes (Pillar 4, labor / workforce) ===
const KitForceHomePage = lazy(() =>
  import('./pages/kitforce/KitForceHomePage').then((m) => ({
    default: m.KitForceHomePage,
  })),
);
const MembersListPage = lazy(() =>
  import('./pages/kitforce/MembersListPage').then((m) => ({
    default: m.MembersListPage,
  })),
);
const MemberCreatePage = lazy(() =>
  import('./pages/kitforce/MemberCreatePage').then((m) => ({
    default: m.MemberCreatePage,
  })),
);
const MemberDetailPage = lazy(() =>
  import('./pages/kitforce/MemberDetailPage').then((m) => ({
    default: m.MemberDetailPage,
  })),
);
const MemberEditPage = lazy(() =>
  import('./pages/kitforce/MemberEditPage').then((m) => ({
    default: m.MemberEditPage,
  })),
);
const TeamsListPage = lazy(() =>
  import('./pages/kitforce/TeamsListPage').then((m) => ({
    default: m.TeamsListPage,
  })),
);
const TeamDetailPage = lazy(() =>
  import('./pages/kitforce/TeamDetailPage').then((m) => ({
    default: m.TeamDetailPage,
  })),
);
const TeamEditPage = lazy(() =>
  import('./pages/kitforce/TeamEditPage').then((m) => ({
    default: m.TeamEditPage,
  })),
);
const ShiftsListPage = lazy(() =>
  import('./pages/kitforce/ShiftsListPage').then((m) => ({
    default: m.ShiftsListPage,
  })),
);
const ShiftDetailPage = lazy(() =>
  import('./pages/kitforce/ShiftDetailPage').then((m) => ({
    default: m.ShiftDetailPage,
  })),
);
const AssignmentsListPage = lazy(() =>
  import('./pages/kitforce/AssignmentsListPage').then((m) => ({
    default: m.AssignmentsListPage,
  })),
);
const AssignmentDetailPage = lazy(() =>
  import('./pages/kitforce/AssignmentDetailPage').then((m) => ({
    default: m.AssignmentDetailPage,
  })),
);
const AssignmentEditPage = lazy(() =>
  import('./pages/kitforce/AssignmentEditPage').then((m) => ({
    default: m.AssignmentEditPage,
  })),
);
const TimeEntriesListPage = lazy(() =>
  import('./pages/kitforce/TimeEntriesListPage').then((m) => ({
    default: m.TimeEntriesListPage,
  })),
);
const TimeEntryEditPage = lazy(() =>
  import('./pages/kitforce/TimeEntryEditPage').then((m) => ({
    default: m.TimeEntryEditPage,
  })),
);
// === End KitForce ===

// === WMS add-on routes (add-on six, warehouse execution; Wave 12 Body B) ===
// Phase B0 stands up the gated chassis with one landing route. Locations (B1),
// Bin stock (B2), Putaway (B3), and Lots (B4) add their routes per phase.
// Gated on plugins.wms via inferPluginForPath above; lazy so the WMS chunk
// stays out of the eager SPA index.
const WmsHomePage = lazy(() =>
  import('./pages/wms/WmsHomePage').then((m) => ({ default: m.WmsHomePage })),
);
const WmsLocationsListPage = lazy(() =>
  import('./pages/wms/WmsLocationsListPage').then((m) => ({
    default: m.WmsLocationsListPage,
  })),
);
const WmsLocationCreatePage = lazy(() =>
  import('./pages/wms/WmsLocationCreatePage').then((m) => ({
    default: m.WmsLocationCreatePage,
  })),
);
const WmsLocationDetailPage = lazy(() =>
  import('./pages/wms/WmsLocationDetailPage').then((m) => ({
    default: m.WmsLocationDetailPage,
  })),
);
const WmsBinStockListPage = lazy(() =>
  import('./pages/wms/WmsBinStockListPage').then((m) => ({
    default: m.WmsBinStockListPage,
  })),
);
const WmsPutawayListPage = lazy(() =>
  import('./pages/wms/WmsPutawayListPage').then((m) => ({
    default: m.WmsPutawayListPage,
  })),
);
const WmsPutawayCreatePage = lazy(() =>
  import('./pages/wms/WmsPutawayCreatePage').then((m) => ({
    default: m.WmsPutawayCreatePage,
  })),
);
const WmsPutawayDetailPage = lazy(() =>
  import('./pages/wms/WmsPutawayDetailPage').then((m) => ({
    default: m.WmsPutawayDetailPage,
  })),
);
const WmsLotsListPage = lazy(() =>
  import('./pages/wms/WmsLotsListPage').then((m) => ({
    default: m.WmsLotsListPage,
  })),
);
const WmsLotCreatePage = lazy(() =>
  import('./pages/wms/WmsLotCreatePage').then((m) => ({
    default: m.WmsLotCreatePage,
  })),
);
const WmsLotDetailPage = lazy(() =>
  import('./pages/wms/WmsLotDetailPage').then((m) => ({
    default: m.WmsLotDetailPage,
  })),
);
// === End WMS ===

// === F-Wave9-INVITE-PASSWORD-SETUP-01: account-security + recovery ===
const SecurityPage = lazy(() =>
  import('./pages/account/SecurityPage').then((m) => ({
    default: m.SecurityPage,
  })),
);
const RecoveryPage = lazy(() =>
  import('./pages/auth/RecoveryPage').then((m) => ({
    default: m.RecoveryPage,
  })),
);
// === End F-Wave9-INVITE-PASSWORD-SETUP-01 ===

// Raw route registrations. ROUTES (exported below) is this list with
// pillar plugin gating injected at module evaluation by `withPluginGate`.
// Keeping the raw list separate lets us add `requiresPlugin` to every
// /3pl-operations/* and /manufacturing/* route in one place instead of
// scattering the same literal across ~30 entries.
const RAW_ROUTES: ReadonlyArray<RouteSpec> = [
  {
    path: '/signin',
    element: SignInPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/dashboard',
    element: DashboardPage,
    guard: 'protected',
    layout: 'shell',
  },
  // === Section Dashboards (header-opens-dashboard mechanic, Phase 1) ===
  // Each task section is a destination. SectionHomePage resolves the section by
  // pathname; Sell and Money render fixed KPI dashboards above the hub, the rest
  // render the hub of their sub-areas. SETTINGS is admin-guarded to mirror the
  // AdminProtectedRoute on /admin/*. URLs of the underlying pages are unchanged.
  { path: '/sell',       element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/buy',        element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/inventory',  element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/production', element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/money',      element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/workforce',  element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/insights',   element: SectionHomePage, guard: 'protected', layout: 'shell' },
  { path: '/settings',   element: SectionHomePage, guard: 'admin',     layout: 'shell' },
  // === End Section Dashboards ===
  {
    path: '/feature-unavailable',
    element: FeatureUnavailablePage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/no-active-org',
    element: NoActiveOrgPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/404',
    element: NotFoundPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  // === Agent A: Admin routes ===
  {
    path: '/admin/settings',
    element: SettingsPage,
    guard: 'admin',
    layout: 'shell',
  },
  {
    path: '/admin/branding',
    element: BrandingSettingsPage,
    guard: 'admin',
    layout: 'shell',
  },
  {
    path: '/admin/flags',
    element: FeatureFlagsAdminPage,
    guard: 'admin',
    layout: 'shell',
  },
  {
    path: '/admin/numbering',
    element: NumberingAdminPage,
    guard: 'admin',
    layout: 'shell',
  },
  // F-Wave9-STAFF-INVITE-CHASSIS-01: /admin/members staff invite surface.
  {
    path: '/admin/members',
    element: MembersPage,
    guard: 'admin',
    layout: 'shell',
  },
  // Stripe wiring (item 9): /admin/billing.
  {
    path: '/admin/billing',
    element: BillingPage,
    guard: 'admin',
    layout: 'shell',
  },
  // R-W13-AUTH-01: /admin/sso single sign-on connection management.
  // admin-guarded; the org.sso.read / org.sso.write caps gate the buttons,
  // RLS on sso_connections is the server authority. Not plugin-gated.
  {
    path: '/admin/sso',
    element: SsoConnectionsPage,
    guard: 'admin',
    layout: 'shell',
  },
  // === End Agent A ===
  // === Feedback / support ticketing (migration 0140) ===
  // Tester surfaces: any authenticated tenant user. Staff surfaces: also
  // protected (not admin), gated by platform_staff inside the page via
  // useIsPlatformStaff(). The server stays the authority on every data call.
  {
    path: '/feedback/tickets',
    element: MyFeedbackListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/feedback/tickets/:id',
    element: MyFeedbackDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/admin/feedback',
    element: AdminFeedbackInboxPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/admin/feedback/:id',
    element: AdminFeedbackTicketPage,
    guard: 'protected',
    layout: 'shell',
  },
  // === End Feedback ===
  // === Agent B: CRM routes ===
  {
    path: '/crm/customers',
    element: CustomersListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/customers/new',
    element: CustomerCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/customers/:id',
    element: CustomerDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/customers/:id/edit',
    element: CustomerEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/contacts',
    element: ContactsListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/contacts/:id',
    element: ContactDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/contacts/:id/edit',
    element: ContactEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/activities',
    element: ActivitiesListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/activities/new',
    element: ActivityCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/leads',
    element: LeadsKanbanPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/leads/:id',
    element: LeadDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/leads/:id/edit',
    element: LeadEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/leads/:id/convert',
    element: LeadConvertPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/opportunities',
    element: OpportunitiesPipelinePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/opportunities/:id',
    element: OpportunityDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/crm/opportunities/:id/edit',
    element: OpportunityEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  // === End Agent B ===
  // === Agent F: Cross-cutting routes ===
  {
    path: '/search',
    element: GlobalSearchResultsPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/imports',
    element: ImportWizardPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/imports/history',
    element: ImportHistoryPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/exports',
    element: ExportsPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/portal/signin',
    element: PortalSignInPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/portal',
    element: PortalDashboardPage,
    guard: 'portal',
    layout: 'unauthenticated',
  },
  {
    path: '/portal/invoices',
    element: PortalInvoicesPage,
    guard: 'portal',
    layout: 'unauthenticated',
  },
  {
    path: '/portal/quotes',
    element: PortalQuotesPage,
    guard: 'portal',
    layout: 'unauthenticated',
  },
  {
    path: '/portal/projects',
    element: PortalProjectsPage,
    guard: 'portal',
    layout: 'unauthenticated',
  },
  // === End Agent F ===
  // === Agent C: Sales routes ===
  {
    path: '/catalog/items',
    element: ItemsListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/catalog/items/new',
    element: ItemCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/catalog/items/:id',
    element: ItemDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/catalog/items/:id/edit',
    element: ItemEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/taxes',
    element: TaxesPage,
    guard: 'protected',
    layout: 'shell',
  },
  // WS4: taxes create/edit
  {
    path: '/settings/sales-config/taxes/new',
    element: TaxCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/taxes/:id/edit',
    element: TaxEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/currencies',
    element: CurrenciesPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/exchange-rates',
    element: ExchangeRatesPage,
    guard: 'protected',
    layout: 'shell',
  },
  // WS4: exchange-rates create (no edit - API has no PATCH)
  {
    path: '/settings/sales-config/exchange-rates/new',
    element: ExchangeRateCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/payment-methods',
    element: PaymentMethodsPage,
    guard: 'protected',
    layout: 'shell',
  },
  // WS4: payment-methods create/edit
  {
    path: '/settings/sales-config/payment-methods/new',
    element: PaymentMethodCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/payment-methods/:id/edit',
    element: PaymentMethodEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/pricing-tiers',
    element: PricingTiersPage,
    guard: 'protected',
    layout: 'shell',
  },
  // WS4: pricing-tiers create/edit
  {
    path: '/settings/sales-config/pricing-tiers/new',
    element: PricingTierCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/settings/sales-config/pricing-tiers/:id/edit',
    element: PricingTierEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/catalog/vas',
    element: ValueAddedServicesPage,
    guard: 'protected',
    layout: 'shell',
  },
  // WS4: VAS create/edit
  {
    path: '/catalog/vas/new',
    element: ValueAddedServiceCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/catalog/vas/:id/edit',
    element: ValueAddedServiceEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/quotes',
    element: QuotesListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/quotes/new',
    element: QuoteCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/quotes/:id',
    element: QuoteDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/projects',
    element: ProjectsListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/projects/new',
    element: ProjectCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/projects/:id',
    element: ProjectDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/projects/:id/edit',
    element: ProjectEditPage,
    guard: 'protected',
    layout: 'shell',
  },
  // === End Agent C ===
  // === Agent E: Vendors/Inventory/Ops routes ===
  { path: '/purchasing/vendors',                element: VendorsListPage,           guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendors/new',                element: VendorCreatePage,          guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendors/:id',                element: VendorDetailPage,          guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendors/:id/edit',           element: VendorEditPage,            guard: 'protected', layout: 'shell' },
  { path: '/purchasing/purchase-orders',            element: POsListPage,               guard: 'protected', layout: 'shell' },
  { path: '/purchasing/purchase-orders/new',        element: POCreatePage,              guard: 'protected', layout: 'shell' },
  { path: '/purchasing/purchase-orders/:id',        element: PODetailPage,              guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendor-bills',               element: VendorBillsListPage,       guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendor-bills/:id',           element: VendorBillDetailPage,      guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendor-bills/:id/edit',      element: VendorBillEditPage,        guard: 'protected', layout: 'shell' },
  { path: '/purchasing/expenses',                   element: ExpensesListPage,          guard: 'protected', layout: 'shell' },
  { path: '/purchasing/expenses/new',               element: ExpenseCreatePage,         guard: 'protected', layout: 'shell' },
  { path: '/purchasing/expenses/:id',               element: ExpenseDetailPage,         guard: 'protected', layout: 'shell' },
  { path: '/purchasing/expenses/:id/edit',          element: ExpenseEditPage,           guard: 'protected', layout: 'shell' },
  { path: '/inventory/warehouses',                  element: WarehousesListPage,        guard: 'protected', layout: 'shell' },
  { path: '/inventory/warehouses/new',              element: WarehouseCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/inventory/warehouses/:id',              element: WarehouseDetailPage,       guard: 'protected', layout: 'shell' },
  { path: '/inventory/warehouses/:id/edit',         element: WarehouseEditPage,         guard: 'protected', layout: 'shell' },
  { path: '/catalog/boms',                          element: BomsListPage,              guard: 'protected', layout: 'shell' },
  { path: '/catalog/boms/new',                      element: BomCreatePage,             guard: 'protected', layout: 'shell' },
  { path: '/catalog/boms/:id',                      element: BomDetailPage,             guard: 'protected', layout: 'shell' },
  { path: '/inventory/stock/levels',                element: StockLevelsPage,           guard: 'protected', layout: 'shell' },
  { path: '/inventory/stock/movements',             element: StockMovementsPage,        guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/receiving',              element: ReceivingOrdersListPage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/receiving/:id',          element: ReceivingOrderDetailPage,  guard: 'protected', layout: 'shell' },
  // BNEW-2 (PR-A): legacy production list + create -> /manufacturing/runs.
  // See LegacyProductionRedirect.tsx for the rationale and follow-up ID.
  { path: '/3pl-operations/production',             element: LegacyProductionListRedirect,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/production/new',         element: LegacyProductionCreateRedirect, guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/production/:id',         element: ProductionRunDetailPage,        guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/shipments',              element: ShipmentsListPage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/shipments/:id',          element: ShipmentDetailPage,        guard: 'protected', layout: 'shell' },
  // Wave 12 Phase A1: 3PL commercial layer (Accounts). /new precedes /:id
  // (react-router v6 matches the first hit; a literal beats a param, but the
  // order keeps it honest). Gated on plugins.three_pl via inferPluginForPath
  // (the /3pl-operations prefix), so no explicit requiresPlugin.
  { path: '/3pl-operations/accounts',               element: AccountsListPage,          guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/accounts/new',           element: AccountCreatePage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/accounts/:id',           element: AccountDetailPage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/accounts/:id/edit',      element: AccountEditPage,           guard: 'protected', layout: 'shell' },
  // Wave 12 Phase A2: 3PL Job Builder. /new precedes /:id (a literal beats a
  // param in react-router v6, but the order keeps it honest). Gated on
  // plugins.three_pl via inferPluginForPath (the /3pl-operations prefix), so no
  // explicit requiresPlugin.
  { path: '/3pl-operations/job-builders',           element: JobTemplatesListPage,      guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/job-builders/new',       element: JobTemplateCreatePage,     guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/job-builders/:id',       element: JobTemplateDetailPage,     guard: 'protected', layout: 'shell' },
  // Wave 12 Phase A5: 3PL Supply Plan. /new before /:id.
  { path: '/3pl-operations/supply-plans',           element: SupplyPlansListPage,       guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/supply-plans/new',       element: SupplyPlanCreatePage,      guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/supply-plans/:id',       element: SupplyPlanDetailPage,      guard: 'protected', layout: 'shell' },
  // Wave 12 Phase A6: 3PL Job Runs. /new before /:id.
  { path: '/3pl-operations/job-runs',               element: JobRunsListPage,           guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/job-runs/new',           element: JobRunCreatePage,          guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/job-runs/:id',           element: JobRunDetailPage,          guard: 'protected', layout: 'shell' },
  // Wave 12 Phase A7: 3PL Billing Review + Job Profitability. /new before /:id.
  // Profitability is a read-only report (no /new, no /:id).
  { path: '/3pl-operations/billing-reviews',        element: BillingReviewsListPage,    guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/billing-reviews/new',    element: BillingReviewCreatePage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/billing-reviews/:id',    element: BillingReviewDetailPage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/profitability',          element: ProfitabilityPage,         guard: 'protected', layout: 'shell' },
  // === End Agent E ===
  // === Agent D: Invoicing + Finance routes ===
  { path: '/invoicing/invoices',               element: InvoicesListPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/new',           element: InvoiceCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/:id',           element: InvoiceDetailPage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/:id/send',      element: InvoiceSendPage,         guard: 'protected', layout: 'shell' },
  { path: '/invoicing/payments',               element: PaymentsListPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/payments/:id',           element: PaymentDetailPage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/payments/:id/apply',     element: PaymentApplyPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes',           element: CreditNotesListPage,     guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes/:id',       element: CreditNoteDetailPage,    guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes/:id/apply', element: CreditNoteApplyPage,     guard: 'protected', layout: 'shell' },
  { path: '/finance/coa',                      element: ChartOfAccountsPage,     guard: 'protected', layout: 'shell' },
  { path: '/finance/coa/new',                  element: ChartOfAccountCreatePage, guard: 'protected', layout: 'shell' },
  { path: '/finance/coa/:id/edit',             element: ChartOfAccountEditPage,  guard: 'protected', layout: 'shell' },
  { path: '/finance/journal-entries',          element: JournalEntriesListPage,  guard: 'protected', layout: 'shell' },
  { path: '/finance/journal-entries/:id',      element: JournalEntryDetailPage,  guard: 'protected', layout: 'shell' },
  { path: '/finance/period-close',             element: PeriodClosePage,         guard: 'admin',     layout: 'shell' },
  // === End Agent D ===
  // === Agent 6.5-A: quote-to-cash create routes ===
  { path: '/invoicing/payments/new',           element: PaymentCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes/new',       element: CreditNoteCreatePage,    guard: 'protected', layout: 'shell' },
  { path: '/finance/journal-entries/new',      element: JournalEntryCreatePage,  guard: 'protected', layout: 'shell' },
  // === End Agent 6.5-A ===
  // === Agent 6.5-D: crm routes ===
  { path: '/crm/leads/new',                    element: LeadCreatePage,          guard: 'protected', layout: 'shell' },
  { path: '/crm/opportunities/new',            element: OpportunityCreatePage,   guard: 'protected', layout: 'shell' },
  { path: '/crm/contacts/new',                 element: ContactCreatePage,       guard: 'protected', layout: 'shell' },
  // === End Agent 6.5-D ===
  // === Agent 6.5-C: ops + procurement routes ===
  { path: '/3pl-operations/receiving/new',     element: ReceivingOrderCreatePage, guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/shipments/new',     element: ShipmentCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/purchasing/vendor-bills/new',      element: VendorBillCreatePage,     guard: 'protected', layout: 'shell' },
  // === End Agent 6.5-C ===
  // === Path A5: Manufacturing pillar routes ===
  // /new MUST precede /:id (F-Wave6-WAREHOUSE-CREATE-01 trap: react-router v6
  // matches the first hit, and a literal segment beats a param, but routing
  // pages also need to be registered in this order for clarity and to mirror
  // the warehouses/production_runs precedent set by 6.5-C).
  { path: '/manufacturing',          element: ManufacturingHomePage,       guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs',     element: ManufacturingRunsListPage,   guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs/new', element: ManufacturingRunCreatePage,  guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs/from-bom', element: ManufacturingRunFromBomPage, guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs/:id', element: ManufacturingRunDetailPage,  guard: 'protected', layout: 'shell' },
  // === End Path A5 ===
  // === Path C2: KitCost pillar routes ===
  { path: '/kitcost/dashboard',      element: KitCostDashboardPage,        guard: 'protected', layout: 'shell' },
  // === End Path C2 ===
  // === Co-Pack and Ecom pillar routes ===
  // /new MUST precede /:id: react-router v6 matches the first hit and a literal
  // segment beats a param, but registering /new first keeps the order honest and
  // mirrors the Manufacturing precedent above.
  { path: '/copack',                   element: CoPackHomePage,          guard: 'protected', layout: 'shell' },
  { path: '/copack/orders',            element: SalesOrdersListPage,     guard: 'protected', layout: 'shell' },
  { path: '/copack/orders/new',        element: SalesOrderCreatePage,    guard: 'protected', layout: 'shell' },
  { path: '/copack/orders/:id',        element: SalesOrderDetailPage,    guard: 'protected', layout: 'shell' },
  { path: '/copack/kitting',           element: KittingJobsListPage,     guard: 'protected', layout: 'shell' },
  { path: '/copack/kitting/new',       element: KittingJobCreatePage,    guard: 'protected', layout: 'shell' },
  { path: '/copack/kitting/:id',       element: KittingJobDetailPage,    guard: 'protected', layout: 'shell' },
  { path: '/copack/channels',          element: ChannelsListPage,        guard: 'protected', layout: 'shell' },
  { path: '/copack/fulfillments',      element: FulfillmentsListPage,    guard: 'protected', layout: 'shell' },
  { path: '/copack/fulfillments/new',  element: FulfillmentCreatePage,   guard: 'protected', layout: 'shell' },
  { path: '/copack/fulfillments/:id',  element: FulfillmentDetailPage,   guard: 'protected', layout: 'shell' },
  // === End Co-Pack and Ecom ===
  // === KitForce pillar routes (Pillar 4, labor / workforce) ===
  // /new and literal segments MUST precede /:id: react-router v6 matches the
  // first hit and a literal segment beats a param, but registering the literals
  // first keeps the order honest and mirrors the Manufacturing / Co-Pack
  // precedent above. Gated on plugins.kitforce via inferPluginForPath below.
  { path: '/kitforce',                 element: KitForceHomePage,        guard: 'protected', layout: 'shell' },
  { path: '/kitforce/members',         element: MembersListPage,         guard: 'protected', layout: 'shell' },
  { path: '/kitforce/members/new',     element: MemberCreatePage,        guard: 'protected', layout: 'shell' },
  { path: '/kitforce/members/:id',     element: MemberDetailPage,        guard: 'protected', layout: 'shell' },
  { path: '/kitforce/members/:id/edit', element: MemberEditPage,         guard: 'protected', layout: 'shell' },
  { path: '/kitforce/teams',                    element: TeamsListPage,          guard: 'protected', layout: 'shell' },
  { path: '/kitforce/teams/:id',                element: TeamDetailPage,         guard: 'protected', layout: 'shell' },
  { path: '/kitforce/teams/:id/edit',           element: TeamEditPage,           guard: 'protected', layout: 'shell' },
  { path: '/kitforce/shifts',                   element: ShiftsListPage,         guard: 'protected', layout: 'shell' },
  { path: '/kitforce/shifts/:id',               element: ShiftDetailPage,        guard: 'protected', layout: 'shell' },
  { path: '/kitforce/assignments',              element: AssignmentsListPage,    guard: 'protected', layout: 'shell' },
  { path: '/kitforce/assignments/:id',          element: AssignmentDetailPage,   guard: 'protected', layout: 'shell' },
  { path: '/kitforce/assignments/:id/edit',     element: AssignmentEditPage,     guard: 'protected', layout: 'shell' },
  { path: '/kitforce/time-entries',             element: TimeEntriesListPage,    guard: 'protected', layout: 'shell' },
  { path: '/kitforce/time-entries/:id/edit',    element: TimeEntryEditPage,      guard: 'protected', layout: 'shell' },
  // === End KitForce ===
  // === WMS add-on routes (add-on six, warehouse execution; Wave 12 Body B) ===
  // Phase B0: the gated landing route. requiresPlugin (plugins.wms) is
  // auto-injected by inferPluginForPath / withPluginGate, so the route declares
  // only path, element, guard, layout. Section routes (Locations, Bin stock,
  // Putaway, Lots) land per phase, /new before /:id.
  { path: '/wms',                    element: WmsHomePage,                 guard: 'protected', layout: 'shell' },
  // Phase B1: Locations. /new precedes /:id so react-router v6 matches the
  // literal first (mirrors the Accounts / KitForce precedent above).
  { path: '/wms/locations',          element: WmsLocationsListPage,        guard: 'protected', layout: 'shell' },
  { path: '/wms/locations/new',      element: WmsLocationCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/wms/locations/:id',      element: WmsLocationDetailPage,       guard: 'protected', layout: 'shell' },
  // Phase B2: Bin stock. Read-only rollup list (no create / detail route in B2).
  { path: '/wms/bin-stock',          element: WmsBinStockListPage,         guard: 'protected', layout: 'shell' },
  // Phase B3: Putaway. Directed-move FSM. /new precedes /:id so react-router v6
  // matches the literal first (mirrors the Locations precedent above).
  { path: '/wms/putaway',            element: WmsPutawayListPage,          guard: 'protected', layout: 'shell' },
  { path: '/wms/putaway/new',        element: WmsPutawayCreatePage,        guard: 'protected', layout: 'shell' },
  { path: '/wms/putaway/:id',        element: WmsPutawayDetailPage,        guard: 'protected', layout: 'shell' },
  // Phase B4: Lots. Near-config HUB with a quarantine hold. /new precedes /:id
  // so react-router v6 matches the literal first (mirrors the Locations precedent).
  { path: '/wms/lots',               element: WmsLotsListPage,             guard: 'protected', layout: 'shell' },
  { path: '/wms/lots/new',           element: WmsLotCreatePage,            guard: 'protected', layout: 'shell' },
  { path: '/wms/lots/:id',           element: WmsLotDetailPage,            guard: 'protected', layout: 'shell' },
  // === End WMS ===
  // === F-Wave9-INVITE-PASSWORD-SETUP-01: account-security + recovery ===
  // /account/security: any signed-in user can set or change their password.
  // /auth/recovery: public; the Supabase recovery token in the URL hash IS
  // the credential. The Supabase SDK auto-parses the hash on mount.
  { path: '/account/security',       element: SecurityPage,                guard: 'protected', layout: 'shell' },
  { path: '/auth/recovery',          element: RecoveryPage,                guard: 'public',    layout: 'unauthenticated' },
  // === End F-Wave9-INVITE-PASSWORD-SETUP-01 ===

  // === Spine plus add-ons re-route: legacy path redirects ===
  // Each entry preserves a pre-re-route deep link. SpineMoveRedirect rewrites
  // the /3pl-operations prefix to the new spine home (REDIRECT_PREFIX_MAP) and
  // keeps the dynamic segments, query string, and hash. isRedirect keeps these
  // ungated even though they still sit under the /3pl-operations prefix.
  // Follow-up F-Wave10-SPINE-REROUTE-REDIRECT-RETIRE-01 drops them once
  // analytics confirm no live bookmarks land on the old paths.
  { path: '/3pl-operations/warehouses',          element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/warehouses/new',      element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/warehouses/:id',      element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/warehouses/:id/edit', element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/stock/levels',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/stock/movements',     element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/items',               element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/items/new',           element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/items/:id',           element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/items/:id/edit',      element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/boms',                element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/boms/new',            element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/boms/:id',            element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vas',                 element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vas/new',             element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vas/:id/edit',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/taxes',                    element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/taxes/new',                element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/taxes/:id/edit',           element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/currencies',               element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/exchange-rates',           element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/exchange-rates/new',       element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/payment-methods',          element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/payment-methods/new',      element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/payment-methods/:id/edit', element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/pricing-tiers',            element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/pricing-tiers/new',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/sales-config/pricing-tiers/:id/edit',   element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendors',             element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendors/new',         element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendors/:id',         element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendors/:id/edit',    element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/purchase-orders',     element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/purchase-orders/new', element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/purchase-orders/:id', element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendor-bills',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendor-bills/new',    element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendor-bills/:id',    element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/vendor-bills/:id/edit', element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/expenses',            element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/expenses/new',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/expenses/:id',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/expenses/:id/edit',   element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/quotes',              element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/quotes/new',          element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/quotes/:id',          element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/projects',            element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/projects/new',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/projects/:id',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/payments/new',        element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  { path: '/3pl-operations/credit-notes/new',    element: SpineMoveRedirect, guard: 'protected', layout: 'shell', isRedirect: true },
  // === End spine re-route redirects ===
] as const;

/**
 * Resolve the pillar plugin flag a given path belongs to, or undefined if
 * the path is plugin-agnostic spine. After the spine plus add-ons re-route
 * the gated namespaces hold ONLY true add-on surfaces: /3pl-operations/* is
 * the 3PL add-on (receiving, shipments, and the production redirects);
 * /manufacturing/* is Manufacturing; /kitcost/* is KitCost; /copack/* is
 * Co-Pack and Ecom; /kitforce/* is KitForce. The spine and shared building
 * blocks moved to ungated neutral roots (/quotes, /projects, /purchasing/*,
 * /catalog/*, /inventory/*, /settings/sales-config/*, /invoicing/*), which
 * fall through to undefined here.
 *
 * Returns the pre-existing `requiresPlugin` value when explicitly set so
 * a route can opt out of auto-gating by declaring its own value.
 *
 * Redirect entries (`spec.isRedirect`) are never gated: they resolve to
 * undefined so a legacy path that still sits under a gated prefix
 * redirects to its new spine home rather than rendering NotFound when the
 * plugin is off. Part of the spine plus add-ons re-route.
 */
function inPillar(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function inferPluginForPath(spec: RouteSpec): string | undefined {
  if (spec.isRedirect) return undefined;
  if (spec.requiresPlugin !== undefined) return spec.requiresPlugin;
  if (inPillar(spec.path, '/3pl-operations')) {
    return FEATURE_FLAGS.PLUGINS_THREE_PL;
  }
  if (inPillar(spec.path, '/manufacturing')) {
    return FEATURE_FLAGS.PLUGINS_MANUFACTURING;
  }
  if (inPillar(spec.path, '/kitcost')) {
    return FEATURE_FLAGS.PLUGINS_KITCOST;
  }
  if (inPillar(spec.path, '/copack')) {
    return FEATURE_FLAGS.PLUGINS_COPACK_ECOM;
  }
  if (inPillar(spec.path, '/kitforce')) {
    return FEATURE_FLAGS.PLUGINS_KITFORCE;
  }
  if (inPillar(spec.path, '/wms')) {
    return FEATURE_FLAGS.PLUGINS_WMS;
  }
  return undefined;
}

/**
 * Inject the pillar plugin flag into every pillar-scoped route so the
 * SPA-side RequirePlugin guard renders NotFoundPage when the org lacks
 * the plugin. Routes outside the three pillar URL spaces pass through
 * untouched.
 *
 * Constitutional rule: plugin bundle gates return 404. The Edge gates
 * in supabase/functions/_shared/bundleGate.ts already enforce this for
 * state-changing handlers; this SPA layer mirrors the gate so org
 * members on a sub-plan never see the surface render at all.
 */
function withPluginGate(spec: RouteSpec): RouteSpec {
  const flag = inferPluginForPath(spec);
  if (flag === undefined) return spec;
  return { ...spec, requiresPlugin: flag };
}

export const ROUTES: ReadonlyArray<RouteSpec> = RAW_ROUTES.map(withPluginGate);

// Test hooks (named exports, no runtime cost outside tests).
export const __internals = { inferPluginForPath, withPluginGate, RAW_ROUTES };
