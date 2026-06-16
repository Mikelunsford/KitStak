import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useVendor, useUpdateVendor } from '@/lib/hooks/useVendors';
import { VendorPatchSchema } from '@/lib/types/vendors_inventory_ops';
import type { Vendor } from '@/lib/types/vendors_inventory_ops';

export function VendorEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useVendor(id);
  const update = useUpdateVendor(id ?? '');

  const [displayName, setDisplayName] = useState('');
  const [vendorNumber, setVendorNumber] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setDisplayName(query.data.display_name);
      setVendorNumber(query.data.vendor_number ?? '');
      setEmail(query.data.email ?? '');
      setPhone(query.data.phone ?? '');
      setCurrency(query.data.default_currency_code);
      setPaymentTermsDays(String(query.data.default_payment_terms_days));
    }
  }, [query.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const termsParsed = Number(paymentTermsDays.trim());
    if (!Number.isInteger(termsParsed) || termsParsed < 0) {
      setError('Payment terms must be a non-negative whole number of days.');
      return;
    }
    const draft = {
      display_name: displayName,
      vendor_number: vendorNumber || null,
      email: email || null,
      phone: phone || null,
      default_currency_code: currency,
      default_payment_terms_days: termsParsed,
    };
    const parsed = VendorPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    // Zod has validated the shape; cast to the service Partial type.
    const patch: Partial<Vendor> = parsed.data as Partial<Vendor>;
    update.mutate(patch, {
      onSuccess: () => navigate(`/purchasing/vendors/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Vendor not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="Edit vendor" eyebrow="Purchasing / Vendors" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Vendor number</span>
          <input
            type="text"
            value={vendorNumber}
            onChange={(e) => setVendorNumber(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Currency (ISO)</span>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Payment terms (days)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error ? update.error.message : 'Failed to save.'}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={update.isPending}
          className="self-start"
        >
          {update.isPending ? 'SAVING.' : 'SAVE'}
        </Button>
      </form>
    </section>
  );
}
