// AccountServiceDefinitions (Wave 12 Phase A1). The per-account Rate Card
// overlay section on the account detail page: lists the account's service
// definitions and offers add / edit / delete, each gated on the matching
// threepl.account.service_definition.* capability. Extracted from
// AccountDetailPage to keep both files focused.
//
// Money is BIGINT _cents on the wire; rate is entered in whole cents and
// rendered via formatCents. service_kind defaults to "custom".

import { useState, type FormEvent } from 'react';
import { Layers } from 'lucide-react';

import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import {
  useAccountServices,
  useCreateAccountService,
  useUpdateAccountService,
  useDeleteAccountService,
} from '@/lib/hooks/useAccounts';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  AccountServiceDefinition,
  AccountServiceKind,
} from '@/lib/services/accountsService';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

const SERVICE_KINDS: ReadonlyArray<AccountServiceKind> = [
  'copack',
  'kit',
  'rework',
  'inspection',
  'labeling',
  'storage',
  'custom',
];

interface FormState {
  serviceKind: AccountServiceKind;
  name: string;
  rateCents: string;
  rateUom: string;
  currencyCode: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const EMPTY_FORM: FormState = {
  serviceKind: 'custom',
  name: '',
  rateCents: '',
  rateUom: '',
  currencyCode: '',
  effectiveFrom: '',
  effectiveTo: '',
};

function formStateFrom(svc: AccountServiceDefinition): FormState {
  return {
    serviceKind: svc.service_kind,
    name: svc.name,
    rateCents: svc.rate_cents == null ? '' : String(svc.rate_cents),
    rateUom: svc.rate_uom ?? '',
    currencyCode: svc.currency_code ?? '',
    effectiveFrom: svc.effective_from ?? '',
    effectiveTo: svc.effective_to ?? '',
  };
}

export function AccountServiceDefinitions({ accountId }: { accountId: string }) {
  const services = useAccountServices(accountId);
  const addService = useCreateAccountService(accountId);
  const editService = useUpdateAccountService(accountId);
  const removeService = useDeleteAccountService(accountId);
  const caps = useCapabilities();

  const canCreate = caps.can('threepl.account.service_definition.create');
  const canUpdate = caps.can('threepl.account.service_definition.update');
  const canDelete = caps.can('threepl.account.service_definition.delete');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  // Build the wire body from the form. Optional fields collapse empty strings
  // to null so the server clears them; rate is carried as whole cents.
  const buildBody = () => ({
    service_kind: form.serviceKind,
    name: form.name,
    rate_cents: form.rateCents.trim() === '' ? null : Number(form.rateCents),
    rate_uom: form.rateUom.trim() === '' ? null : form.rateUom.trim(),
    currency_code:
      form.currencyCode.trim() === '' ? null : form.currencyCode.trim().toUpperCase(),
    effective_from: form.effectiveFrom === '' ? null : form.effectiveFrom,
    effective_to: form.effectiveTo === '' ? null : form.effectiveTo,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body = buildBody();
    if (editingId) {
      editService.mutate(
        { serviceId: editingId, body },
        { onSuccess: resetForm },
      );
    } else {
      addService.mutate(body, { onSuccess: resetForm });
    }
  };

  const onEdit = (svc: AccountServiceDefinition) => {
    setEditingId(svc.id);
    setForm(formStateFrom(svc));
  };

  const onRemove = async (svc: AccountServiceDefinition) => {
    const ok = await destructiveConfirm({
      action: 'Delete this service definition',
      consequence: `"${svc.name}" will be removed from this account's rate card.`,
    });
    if (!ok) return;
    if (editingId === svc.id) resetForm();
    removeService.mutate(svc.id);
  };

  const rows = services.data ?? [];
  const pending = addService.isPending || editService.isPending;
  const mutationError = editingId ? editService.error : addService.error;

  return (
    <section>
      <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
        SERVICE DEFINITIONS
      </h2>

      {services.isLoading ? (
        <p className="text-ink-dim text-sm">Loading service definitions.</p>
      ) : services.error ? (
        <p className="text-accent text-sm">
          {services.error instanceof Error
            ? services.error.message
            : 'Failed to load service definitions.'}
        </p>
      ) : rows.length === 0 ? (
        <DetailSectionEmptyCoaching
          entity="service definition"
          explainer="Service definitions are this account's rate card: the per-service rates you bill this customer for co-pack, kitting, storage, and the rest."
          icon={Layers}
        />
      ) : (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">UOM</th>
              <th className="px-4 py-2">Effective</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((svc) => (
              <tr key={svc.id} className="border-t border-line">
                <td className="px-4 py-2 font-sans text-sm capitalize">
                  {svc.service_kind}
                </td>
                <td className="px-4 py-2 font-sans text-sm text-ink">{svc.name}</td>
                <td className="px-4 py-2 font-mono text-sm text-right">
                  {svc.rate_cents == null
                    ? ''
                    : formatCents(svc.rate_cents, svc.currency_code ?? 'USD')}
                </td>
                <td className="px-4 py-2 font-mono text-sm">{svc.rate_uom ?? ''}</td>
                <td className="px-4 py-2 font-sans text-xs text-ink-dim">
                  {svc.effective_from ?? ''}
                  {svc.effective_to ? ` to ${svc.effective_to}` : ''}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end">
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => onEdit(svc)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        onClick={() => onRemove(svc)}
                        disabled={removeService.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removeService.isError && (
        <p className="mt-2 text-accent font-sans text-sm">
          Remove failed:{' '}
          {removeService.error instanceof Error
            ? removeService.error.message
            : 'unknown error'}
        </p>
      )}

      {(canCreate || editingId) && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 border border-line p-4 mt-4">
          <h3 className="font-display tracking-wider text-ink">
            {editingId ? 'EDIT SERVICE' : 'ADD SERVICE'}
          </h3>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Kind
              </span>
              <Select
                value={form.serviceKind}
                onChange={(e) => set('serviceKind', e.target.value as AccountServiceKind)}
              >
                {SERVICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
            <TextInput
              label="Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
            <TextInput
              label="Rate (whole cents, e.g. 250 = $2.50)"
              value={form.rateCents}
              onChange={(e) => set('rateCents', e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="UOM"
              value={form.rateUom}
              onChange={(e) => set('rateUom', e.target.value)}
              placeholder="e.g. each, hour"
            />
            <TextInput
              label="Currency"
              value={form.currencyCode}
              onChange={(e) => set('currencyCode', e.target.value)}
              placeholder="USD"
            />
            <TextInput
              label="Effective from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => set('effectiveFrom', e.target.value)}
            />
            <TextInput
              label="Effective to"
              type="date"
              value={form.effectiveTo}
              onChange={(e) => set('effectiveTo', e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!form.name.trim() || pending}>
              {pending ? 'Saving.' : editingId ? 'Save changes' : 'Add service'}
            </Button>
            {editingId && (
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
          {mutationError && (
            <p className="text-accent font-sans text-sm">
              {mutationError instanceof Error ? mutationError.message : 'Save failed.'}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
