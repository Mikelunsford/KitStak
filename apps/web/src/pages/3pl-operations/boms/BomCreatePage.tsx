// BomCreatePage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL CRUD
// tail): PageHeader replaces the hand-rolled title and the item selects become
// the kit Select. The cap-gate early return and the redirect to the new BOM's
// detail page are preserved.
//
// R-W13-UX-02: the operator now picks the finished item once and stages the
// whole component list inline on this screen, instead of being forced to create
// the BOM with one component and add the rest on the detail page. A BOM has no
// single create endpoint (each component is its own bom_item row), so submit
// replays each staged component through createBomItem under one user action.
// The parent-equals-component guard and the positive-quantity rule move into
// the pure validateBomDrafts helper so the contract is unit-tested.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { useCreateBomItem } from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

import { BomCreateLinesEditor } from './BomCreateLinesEditor';
import {
  bomDraftsToCreateBodies,
  validateBomDrafts,
  type BomLineDraft,
} from './bomLineDraft';

export function BomCreatePage() {
  const navigate = useNavigate();
  const caps = useVioCapabilities();
  const create = useCreateBomItem();
  const { data: items } = useItemsList();

  const [parentItemId, setParentItemId] = useState('');
  const [lines, setLines] = useState<BomLineDraft[]>([]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!caps.can('stock.bom.write')) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <p className="text-ink">Forbidden.</p>
      </section>
    );
  }

  const parentOptions = (items ?? []).map((item) => ({
    id: item.id,
    label: `${item.sku} · ${item.name}`,
  }));
  // The component picker must not offer the finished item itself.
  const componentOptions = parentOptions.filter(
    (opt) => opt.id !== parentItemId,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parentItemId) {
      setFormError('Select a finished item.');
      return;
    }
    const validation = validateBomDrafts(parentItemId, lines);
    if (!validation.ok) {
      setFormError(validation.message ?? 'Fix the components before saving.');
      return;
    }
    setFormError('');
    // R-W13-UX-02: a BOM has no bulk create route, so replay each staged
    // component through createBomItem in entry order. Stop on the first
    // failure; createBomItem surfaces its error via the mutation state and
    // the operator can finish the rest on the detail page (the parent item
    // routes the BOM, so partially-saved components are reachable there).
    setSubmitting(true);
    const bodies = bomDraftsToCreateBodies(parentItemId, lines);
    let created = 0;
    try {
      for (const body of bodies) {
        await create.mutateAsync(body);
        created += 1;
      }
    } catch {
      setSubmitting(false);
      // Partial save: at least one component landed under its own bom_item row.
      // Route to the BOM detail (keyed by the parent item) so the operator
      // finishes the rest there. Re-submitting this screen would replay the
      // already-saved components under fresh idempotency keys and duplicate
      // them, so do not leave the operator on the create form with a full
      // batch staged. When nothing saved there is nothing to duplicate: stay
      // on the form with the drafts intact and the mutation error rendered.
      if (created > 0) {
        navigate(`/catalog/boms/${parentItemId}`);
      }
      return;
    }
    setSubmitting(false);
    navigate(`/catalog/boms/${parentItemId}`);
  }

  const pending = create.isPending || submitting;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader title="New BOM" />
      <p className="font-sans text-sm text-ink-dim">
        Pick the finished item, then add its components. You can add or edit
        components later from the BOM detail page.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-6 font-sans text-sm">
        <label className="flex max-w-xl flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Finished item
          </span>
          <Select
            value={parentItemId}
            onChange={(e) => setParentItemId(e.target.value)}
            disabled={pending}
          >
            <option value="">Select an item</option>
            {parentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>

        {/* R-W13-UX-02: stage components inline. Submitted with the finished
            item in one action via the loop in onSubmit. */}
        <BomCreateLinesEditor
          lines={lines}
          onChange={setLines}
          options={componentOptions}
          disabled={pending}
        />

        {formError ? <p className="text-accent">{formError}</p> : null}
        {create.error ? (
          <p className="text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Failed to create BOM.'}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
