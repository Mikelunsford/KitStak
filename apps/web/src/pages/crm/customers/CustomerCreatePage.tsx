import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/ui/PageHeader';
import { customersKeys } from '@/lib/queryKeys/customers';
import { createCustomer } from '@/lib/services/customersService';
import {
  CustomerCreateSchema,
  type Address,
  type CustomerCreate,
} from '@/lib/types/crm';
import {
  copyBillingToShipping,
  type AddressFields,
} from './copyBillingToShipping';

/**
 * Form for new customer. useState + Zod safeParse per the constitution; no
 * react-hook-form. Surfaces the rich-field shape CustomerCreateSchema accepts
 * (tax_id, default_currency_code, default_payment_terms_days, billing_address,
 * shipping_address). `default_payment_terms_days` landed in migration 0049
 * and closes F-Wave7-CRM-SCHEMA-01.
 */
export function CustomerCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<'company' | 'individual'>('company');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState('USD');
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState('');

  // Billing address grouped inputs.
  const [billLine1, setBillLine1] = useState('');
  const [billLine2, setBillLine2] = useState('');
  const [billCity, setBillCity] = useState('');
  const [billRegion, setBillRegion] = useState('');
  const [billPostal, setBillPostal] = useState('');
  const [billCountry, setBillCountry] = useState('');

  // Shipping address grouped inputs.
  const [shipLine1, setShipLine1] = useState('');
  const [shipLine2, setShipLine2] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipRegion, setShipRegion] = useState('');
  const [shipPostal, setShipPostal] = useState('');
  const [shipCountry, setShipCountry] = useState('');
  // F-Wave9-AUDIT-V3-WAVE-E-01 (item 3): "Same as billing" toggle.
  // When checked, we copy the billing fields into shipping ONCE; we
  // do not keep re-syncing on every billing keystroke, because that
  // would silently clobber a manual shipping edit the operator made
  // after toggling on. The shipping field onChange handlers below
  // un-check the box whenever the operator types into a shipping
  // input, so the form re-anchors to "shipping owns its own state"
  // the moment manual editing resumes.
  const [sameAsBilling, setSameAsBilling] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function onToggleSameAsBilling(next: boolean) {
    setSameAsBilling(next);
    if (!next) return;
    const fields: AddressFields = {
      line1: billLine1,
      line2: billLine2,
      city: billCity,
      region: billRegion,
      postal: billPostal,
      country: billCountry,
    };
    const copied = copyBillingToShipping(fields);
    setShipLine1(copied.line1);
    setShipLine2(copied.line2);
    setShipCity(copied.city);
    setShipRegion(copied.region);
    setShipPostal(copied.postal);
    setShipCountry(copied.country);
  }

  function onEditShipping<T>(setter: (v: T) => void) {
    return (value: T) => {
      if (sameAsBilling) setSameAsBilling(false);
      setter(value);
    };
  }

  const mutation = useMutation({
    mutationFn: (body: CustomerCreate) => createCustomer(body),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: customersKeys.all });
      navigate(`/crm/customers/${created.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create.'),
  });

  // Build an Address only if any field was filled, otherwise omit so the
  // schema's optional/nullable check is satisfied with undefined instead of
  // an empty object.
  function buildAddress(
    line1: string,
    line2: string,
    city: string,
    region: string,
    postal: string,
    country: string,
  ): Address | undefined {
    const parts = [line1, line2, city, region, postal, country].map((p) => p.trim());
    if (parts.every((p) => p === '')) return undefined;
    const a: Address = {};
    if (parts[0]) a.line1 = parts[0];
    if (parts[1]) a.line2 = parts[1];
    if (parts[2]) a.city = parts[2];
    if (parts[3]) a.region = parts[3];
    if (parts[4]) a.postal = parts[4];
    if (parts[5]) a.country = parts[5];
    return a;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const billing = buildAddress(
      billLine1,
      billLine2,
      billCity,
      billRegion,
      billPostal,
      billCountry,
    );
    const shipping = buildAddress(
      shipLine1,
      shipLine2,
      shipCity,
      shipRegion,
      shipPostal,
      shipCountry,
    );
    const termsTrimmed = defaultPaymentTermsDays.trim();
    let termsValue: number | null | undefined;
    if (termsTrimmed === '') {
      termsValue = null;
    } else {
      const parsedTerms = Number(termsTrimmed);
      if (!Number.isInteger(parsedTerms) || parsedTerms < 0) {
        setError('Default payment terms must be a non-negative whole number of days.');
        return;
      }
      termsValue = parsedTerms;
    }
    const draft = {
      display_name: displayName,
      kind,
      primary_email: primaryEmail || undefined,
      primary_phone: primaryPhone || undefined,
      tax_id: taxId || undefined,
      default_currency_code: defaultCurrencyCode || undefined,
      default_payment_terms_days: termsValue,
      billing_address: billing,
      shipping_address: shipping,
      tags: [],
    };
    const parsed = CustomerCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="CRM / Customers" title="New customer" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Display name</span>
          <input
            type="text"
            name="display_name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'company' | 'individual')}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            <option value="company">Company</option>
            <option value="individual">Individual</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary email</span>
          <input
            type="email"
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary phone</span>
          <input
            type="tel"
            value={primaryPhone}
            onChange={(e) => setPrimaryPhone(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Tax id</span>
          <input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Default currency</span>
          <input
            type="text"
            value={defaultCurrencyCode}
            onChange={(e) => setDefaultCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="USD"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Default payment terms (days)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={defaultPaymentTermsDays}
            onChange={(e) => setDefaultPaymentTermsDays(e.target.value)}
            placeholder="Optional"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>

        <fieldset className="flex flex-col gap-2 border border-line p-3">
          <legend className="text-sm text-ink-dim px-1">Billing address</legend>
          <input
            type="text"
            value={billLine1}
            onChange={(e) => setBillLine1(e.target.value)}
            placeholder="Line 1"
            className="bg-bg-2 border border-line px-3 py-2"
          />
          <input
            type="text"
            value={billLine2}
            onChange={(e) => setBillLine2(e.target.value)}
            placeholder="Line 2"
            className="bg-bg-2 border border-line px-3 py-2"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={billCity}
              onChange={(e) => setBillCity(e.target.value)}
              placeholder="City"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={billRegion}
              onChange={(e) => setBillRegion(e.target.value)}
              placeholder="State / region"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={billPostal}
              onChange={(e) => setBillPostal(e.target.value)}
              placeholder="Postal code"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={billCountry}
              onChange={(e) => setBillCountry(e.target.value)}
              placeholder="Country"
              className="bg-bg-2 border border-line px-3 py-2"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2 border border-line p-3">
          <legend className="text-sm text-ink-dim px-1">Shipping address</legend>
          {/* F-Wave9-AUDIT-V3-WAVE-E-01 (item 3): Same-as-billing toggle.
              Copies billing fields once on toggle-on; the shipping
              onChange handlers below un-check whenever the operator
              edits a shipping field manually so the copy is never
              re-applied silently. */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sameAsBilling}
              onChange={(e) => onToggleSameAsBilling(e.target.checked)}
            />
            <span className="text-sm text-ink-dim">Same as billing</span>
          </label>
          <input
            type="text"
            value={shipLine1}
            onChange={(e) => onEditShipping(setShipLine1)(e.target.value)}
            placeholder="Line 1"
            className="bg-bg-2 border border-line px-3 py-2"
          />
          <input
            type="text"
            value={shipLine2}
            onChange={(e) => onEditShipping(setShipLine2)(e.target.value)}
            placeholder="Line 2"
            className="bg-bg-2 border border-line px-3 py-2"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={shipCity}
              onChange={(e) => onEditShipping(setShipCity)(e.target.value)}
              placeholder="City"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={shipRegion}
              onChange={(e) => onEditShipping(setShipRegion)(e.target.value)}
              placeholder="State / region"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={shipPostal}
              onChange={(e) => onEditShipping(setShipPostal)(e.target.value)}
              placeholder="Postal code"
              className="bg-bg-2 border border-line px-3 py-2"
            />
            <input
              type="text"
              value={shipCountry}
              onChange={(e) => onEditShipping(setShipCountry)(e.target.value)}
              placeholder="Country"
              className="bg-bg-2 border border-line px-3 py-2"
            />
          </div>
        </fieldset>

        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {mutation.isPending ? 'CREATING.' : 'CREATE'}
        </button>
      </form>
    </section>
  );
}
