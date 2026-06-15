import { PageHeader } from '@/components/ui/PageHeader';

/**
 * WmsHomePage. Pillar landing for WMS (warehouse execution), add-on six
 * (ADR 0002). Phase B0 of the WMS Body B deepening core: this is the gated
 * chassis only. No domain surfaces exist yet; Locations (B1), Bin stock (B2),
 * Putaway (B3), and Lots (B4) land here as later phases ship.
 *
 * Gated by plugins.wms at the route layer (RequirePlugin renders NotFoundPage,
 * 404, when the flag is off). plugins.wms defaults OFF (paid add-on), so no
 * org reaches this surface until an operator flips the flag on via
 * /admin/flags. The server bundle gate (wms-api) is the authority; this is the
 * SPA-side mirror.
 */
export function WmsHomePage() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Warehouse execution"
        meta="Bin-level inventory, directed putaway, and lot capture. Surfaces land as the WMS phases ship."
      />
    </section>
  );
}
