import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

/**
 * Flat ROUTES table. Per 00-canon/01-architecture.md "Routing". react-router-dom
 * v6 with a flat ROUTES table and lazy code splits. No nested JSX <Route> trees.
 *
 * `guard` decides which auth wrapper wraps the element at render time. `layout`
 * is informational; ProtectedRoute / AdminProtectedRoute wrap in <AppShell>
 * themselves, public/portal routes render bare.
 */

export type RouteGuard = 'protected' | 'admin' | 'portal' | 'public';
export type RouteLayout = 'shell' | 'auth' | 'unauthenticated';

export interface RouteSpec {
  path: string;
  element: LazyExoticComponent<ComponentType<unknown>>;
  guard: RouteGuard;
  layout: RouteLayout;
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
const FeatureUnavailablePage = lazy(() =>
  import('./pages/FeatureUnavailablePage').then((m) => ({
    default: m.FeatureUnavailablePage,
  })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
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
// === End Agent A ===

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
// === End Agent B: CRM lazy imports ===

// === Agent F: Cross-cutting lazy imports ===
const DashboardSummaryPage = lazy(() =>
  import('./pages/dashboard/DashboardSummaryPage').then((m) => ({
    default: m.DashboardSummaryPage,
  })),
);
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
const QuoteSendPage = lazy(() =>
  import('./pages/3pl-operations/quotes/QuoteSendPage').then((m) => ({
    default: m.QuoteSendPage,
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
const ExpensesListPage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpensesListPage').then((m) => ({ default: m.ExpensesListPage })),
);
const ExpenseDetailPage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpenseDetailPage').then((m) => ({ default: m.ExpenseDetailPage })),
);
const ExpenseCreatePage = lazy(() =>
  import('./pages/3pl-operations/expenses/ExpenseCreatePage').then((m) => ({ default: m.ExpenseCreatePage })),
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
const ProductionRunsListPage = lazy(() =>
  import('./pages/3pl-operations/production/ProductionRunsListPage').then((m) => ({ default: m.ProductionRunsListPage })),
);
const ProductionRunDetailPage = lazy(() =>
  import('./pages/3pl-operations/production/ProductionRunDetailPage').then((m) => ({ default: m.ProductionRunDetailPage })),
);
const ProductionRunCreatePage = lazy(() =>
  import('./pages/3pl-operations/production/ProductionRunCreatePage').then((m) => ({ default: m.ProductionRunCreatePage })),
);
const ShipmentsListPage = lazy(() =>
  import('./pages/3pl-operations/shipments/ShipmentsListPage').then((m) => ({ default: m.ShipmentsListPage })),
);
const ShipmentDetailPage = lazy(() =>
  import('./pages/3pl-operations/shipments/ShipmentDetailPage').then((m) => ({ default: m.ShipmentDetailPage })),
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

export const ROUTES: ReadonlyArray<RouteSpec> = [
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
  {
    path: '/feature-unavailable',
    element: FeatureUnavailablePage,
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
  // === End Agent A ===
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
  // === End Agent B ===
  // === Agent F: Cross-cutting routes ===
  {
    path: '/dashboard/summary',
    element: DashboardSummaryPage,
    guard: 'protected',
    layout: 'shell',
  },
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
    path: '/3pl-operations/items',
    element: ItemsListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/items/new',
    element: ItemCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/items/:id',
    element: ItemDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/sales-config/taxes',
    element: TaxesPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/sales-config/currencies',
    element: CurrenciesPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/sales-config/exchange-rates',
    element: ExchangeRatesPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/sales-config/payment-methods',
    element: PaymentMethodsPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/sales-config/pricing-tiers',
    element: PricingTiersPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/vas',
    element: ValueAddedServicesPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/quotes',
    element: QuotesListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/quotes/new',
    element: QuoteCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/quotes/:id',
    element: QuoteDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/quotes/:id/send',
    element: QuoteSendPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/projects',
    element: ProjectsListPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/projects/new',
    element: ProjectCreatePage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/3pl-operations/projects/:id',
    element: ProjectDetailPage,
    guard: 'protected',
    layout: 'shell',
  },
  // === End Agent C ===
  // === Agent E: Vendors/Inventory/Ops routes ===
  { path: '/3pl-operations/vendors',                element: VendorsListPage,           guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/vendors/new',            element: VendorCreatePage,          guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/vendors/:id',            element: VendorDetailPage,          guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/purchase-orders',        element: POsListPage,               guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/purchase-orders/new',    element: POCreatePage,              guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/purchase-orders/:id',    element: PODetailPage,              guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/vendor-bills',           element: VendorBillsListPage,       guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/vendor-bills/:id',       element: VendorBillDetailPage,      guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/expenses',               element: ExpensesListPage,          guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/expenses/new',           element: ExpenseCreatePage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/expenses/:id',           element: ExpenseDetailPage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/warehouses',             element: WarehousesListPage,        guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/warehouses/new',         element: WarehouseCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/warehouses/:id',         element: WarehouseDetailPage,       guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/stock/levels',           element: StockLevelsPage,           guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/stock/movements',        element: StockMovementsPage,        guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/receiving',              element: ReceivingOrdersListPage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/receiving/:id',          element: ReceivingOrderDetailPage,  guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/production',             element: ProductionRunsListPage,    guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/production/new',         element: ProductionRunCreatePage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/production/:id',         element: ProductionRunDetailPage,   guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/shipments',              element: ShipmentsListPage,         guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/shipments/:id',          element: ShipmentDetailPage,        guard: 'protected', layout: 'shell' },
  // === End Agent E ===
  // === Agent D: Invoicing + Finance routes ===
  { path: '/invoicing/invoices',               element: InvoicesListPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/new',           element: InvoiceCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/:id',           element: InvoiceDetailPage,       guard: 'protected', layout: 'shell' },
  { path: '/invoicing/invoices/:id/send',      element: InvoiceSendPage,         guard: 'protected', layout: 'shell' },
  { path: '/invoicing/payments',               element: PaymentsListPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/payments/:id/apply',     element: PaymentApplyPage,        guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes',           element: CreditNotesListPage,     guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes/:id',       element: CreditNoteDetailPage,    guard: 'protected', layout: 'shell' },
  { path: '/invoicing/credit-notes/:id/apply', element: CreditNoteApplyPage,     guard: 'protected', layout: 'shell' },
  { path: '/finance/coa',                      element: ChartOfAccountsPage,     guard: 'protected', layout: 'shell' },
  { path: '/finance/journal-entries',          element: JournalEntriesListPage,  guard: 'protected', layout: 'shell' },
  { path: '/finance/journal-entries/:id',      element: JournalEntryDetailPage,  guard: 'protected', layout: 'shell' },
  { path: '/finance/period-close',             element: PeriodClosePage,         guard: 'admin',     layout: 'shell' },
  // === End Agent D ===
  // === Agent 6.5-A: quote-to-cash create routes ===
  { path: '/3pl-operations/payments/new',      element: PaymentCreatePage,       guard: 'protected', layout: 'shell' },
  { path: '/3pl-operations/credit-notes/new',  element: CreditNoteCreatePage,    guard: 'protected', layout: 'shell' },
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
  { path: '/3pl-operations/vendor-bills/new',  element: VendorBillCreatePage,     guard: 'protected', layout: 'shell' },
  // === End Agent 6.5-C ===
  // === Path A5: Manufacturing pillar routes ===
  // /new MUST precede /:id (F-Wave6-WAREHOUSE-CREATE-01 trap: react-router v6
  // matches the first hit, and a literal segment beats a param, but routing
  // pages also need to be registered in this order for clarity and to mirror
  // the warehouses/production_runs precedent set by 6.5-C).
  { path: '/manufacturing/runs',     element: ManufacturingRunsListPage,   guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs/new', element: ManufacturingRunCreatePage,  guard: 'protected', layout: 'shell' },
  { path: '/manufacturing/runs/:id', element: ManufacturingRunDetailPage,  guard: 'protected', layout: 'shell' },
  // === End Path A5 ===
  // === Path C2: KitCost pillar routes ===
  { path: '/kitcost/dashboard',      element: KitCostDashboardPage,        guard: 'protected', layout: 'shell' },
  // === End Path C2 ===
] as const;
