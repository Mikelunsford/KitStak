// F-Wave9-AUDIT-V3-WAVE-C3-01: the UUID-guard implementation moved to
// `apps/web/src/lib/urlParams.ts` so the same parser is shared with the
// shipment and manufacturing create pages. This module re-exports for
// backward compatibility with the existing import sites in
// ReceivingOrderCreatePage and ReceivingOrdersListPage.
export { parseProjectIdParam } from '@/lib/urlParams';
