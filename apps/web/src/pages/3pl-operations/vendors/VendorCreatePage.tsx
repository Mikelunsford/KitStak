import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCreateVendor } from '@/lib/hooks/useVendors';

const FormSchema = z.object({
  display_name: z.string().min(1, 'Required'),
  vendor_number: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  default_currency_code: z.string().length(3),
  default_payment_terms_days: z.number().int().min(0),
});

type Errors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

export function VendorCreatePage() {
  const navigate = useNavigate();
  const create = useCreateVendor();
  const [display, setDisplay] = useState('');
  const [num, setNum] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [terms, setTerms] = useState(30);
  const [errors, setErrors] = useState<Errors>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      display_name: display,
      vendor_number: num,
      email: email || undefined,
      default_currency_code: currency,
      default_payment_terms_days: terms,
    });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path[0] as keyof Errors] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    const created = await create.mutateAsync({
      ...parsed.data,
      vendor_number: parsed.data.vendor_number ?? null,
      email: parsed.data.email ?? null,
    });
    navigate(`/3pl-operations/vendors/${created.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW VENDOR</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <Field label="Display name" error={errors.display_name}>
          <input
            type="text" value={display} onChange={(e) => setDisplay(e.target.value)}
            className="border border-line bg-bg-2 px-3 py-2 text-ink"
          />
        </Field>
        <Field label="Vendor number" error={errors.vendor_number}>
          <input
            type="text" value={num} onChange={(e) => setNum(e.target.value)}
            className="border border-line bg-bg-2 px-3 py-2 text-ink"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="border border-line bg-bg-2 px-3 py-2 text-ink"
          />
        </Field>
        <Field label="Currency (ISO)" error={errors.default_currency_code}>
          <input
            type="text" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="border border-line bg-bg-2 px-3 py-2 text-ink"
          />
        </Field>
        <Field label="Payment terms (days)" error={errors.default_payment_terms_days as string | undefined}>
          <input
            type="number" value={terms} onChange={(e) => setTerms(Number(e.target.value))}
            className="border border-line bg-bg-2 px-3 py-2 text-ink"
          />
        </Field>

        {create.error ? (
          <p className="text-accent">Failed to create vendor.</p>
        ) : null}

        <button
          type="submit"
          disabled={create.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-sans text-sm"
        >
          {create.isPending ? 'Saving.' : 'Create'}
        </button>
      </form>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-dim">{label}</span>
      {children}
      {error ? <span className="text-accent text-xs">{error}</span> : null}
    </label>
  );
}
