// AUTO-GENERATED design-sync barrel entry. Re-exports every components/ui
// primitive onto window.KitstakUI, plus a preview provider (Router + QueryClient).
// Providers use createElement (no JSX) so this file needs no jsx tsconfig.
import { createElement as h, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

// Kitstak is a navy-first dark theme: --bg is navy and --ink is cream, applied
// by the app's <body>. Preview cards have no <body> styling, so paint the brand
// surface here — otherwise cream-on-white text (ghost buttons, labels) is
// invisible. Matches how every component actually renders in the app.
export function DsPreviewProvider({ children }: { children?: ReactNode }) {
  const surface = h(
    'div',
    { className: 'bg-bg text-ink', style: { padding: '24px', minHeight: '100%' } },
    children,
  );
  return h(MemoryRouter, null, h(QueryClientProvider, { client: qc } as any, surface));
}

export { ActionTile } from '../apps/web/src/components/ui/ActionTile';
export { BillableLineItemsEditor } from '../apps/web/src/components/ui/BillableLineItemsEditor';
export { Button } from '../apps/web/src/components/ui/Button';
export { ColorField } from '../apps/web/src/components/ui/ColorField';
export { ConfirmDialogHost } from '../apps/web/src/components/ui/ConfirmDialogHost';
export { CurrencyField } from '../apps/web/src/components/ui/CurrencyField';
export { CursorPager } from '../apps/web/src/components/ui/CursorPager';
export { DataTable } from '../apps/web/src/components/ui/DataTable';
export { DetailHeader } from '../apps/web/src/components/ui/DetailHeader';
export { DetailLayout } from '../apps/web/src/components/ui/DetailLayout';
export { Disclosure } from '../apps/web/src/components/ui/Disclosure';
export { EntityPicker } from '../apps/web/src/components/ui/EntityPicker';
export { FilterBar } from '../apps/web/src/components/ui/FilterBar';
export { FormGrid } from '../apps/web/src/components/ui/FormGrid';
export { ImageUploadField } from '../apps/web/src/components/ui/ImageUploadField';
export { ListToolbar } from '../apps/web/src/components/ui/ListToolbar';
export { Logo } from '../apps/web/src/components/ui/Logo';
export { Modal } from '../apps/web/src/components/ui/Modal';
export { PageHeader } from '../apps/web/src/components/ui/PageHeader';
export { Pagination } from '../apps/web/src/components/ui/Pagination';
export { RelativeTime } from '../apps/web/src/components/ui/RelativeTime';
export { SavedViewsBar } from '../apps/web/src/components/ui/SavedViewsBar';
export { Select } from '../apps/web/src/components/ui/Select';
export { StatCard } from '../apps/web/src/components/ui/StatCard';
export { StatusBadge } from '../apps/web/src/components/ui/StatusBadge';
export { Tabs } from '../apps/web/src/components/ui/Tabs';
export { TextInput } from '../apps/web/src/components/ui/TextInput';
export { ChannelPicker } from '../apps/web/src/components/ui/pickers/ChannelPicker';
export { CustomerPicker } from '../apps/web/src/components/ui/pickers/CustomerPicker';
export { InvoicePicker } from '../apps/web/src/components/ui/pickers/InvoicePicker';
export { ItemPicker } from '../apps/web/src/components/ui/pickers/ItemPicker';
export { PaymentMethodPicker } from '../apps/web/src/components/ui/pickers/PaymentMethodPicker';
export { PricingTierPicker } from '../apps/web/src/components/ui/pickers/PricingTierPicker';
export { ProjectPicker } from '../apps/web/src/components/ui/pickers/ProjectPicker';
export { QuotePicker } from '../apps/web/src/components/ui/pickers/QuotePicker';
export { TaxPicker } from '../apps/web/src/components/ui/pickers/TaxPicker';
export { VendorPicker } from '../apps/web/src/components/ui/pickers/VendorPicker';
