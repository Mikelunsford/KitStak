import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { createContact } from '@/lib/services/contactsService';
import { safeSameOriginPath } from '@/lib/safePath';
import {
  ContactCreateSchema,
  type Contact,
  type ContactCreate,
} from '@/lib/types/crm';

/**
 * ContactCreatePage. Closes G-CONTACT-FORM-01 (and the pre-existing
 * F-Wave2-CRM-03 follow-up). Every contact belongs to a customer per the 0007
 * schema, so the customer picker is required. customer_id is pre-fillable from
 * the query string so the CustomerDetailPage related-contacts section can land
 * here with the parent customer already chosen.
 */
export function ContactCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const prefilledCustomerId = searchParams.get('customer_id');
  // PR-6 / B6: when a customer page links here to create a related
  // contact, it appends `?return_to=/crm/customers/<id>` so we can
  // bounce the operator back to where they came from instead of
  // yanking them to the new contact detail page. Validated for
  // same-origin to prevent open-redirect.
  const returnTo = safeSameOriginPath(searchParams.get('return_to'));

  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ContactCreate) => createContact(body),
    onSuccess: (created: Contact) => {
      void qc.invalidateQueries({ queryKey: contactsKeys.all });
      // PR-6 / B6: prefer the validated return_to (same-origin path)
      // over the default contact-detail destination so a customer-page
      // entry round-trips back to that customer.
      navigate(returnTo ?? `/crm/contacts/${created.id}`);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to save contact.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) {
      setError('Customer is required.');
      return;
    }
    const draft = {
      customer_id: customerId,
      first_name: firstName,
      last_name: lastName.trim() || undefined,
      title: title.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      is_primary: isPrimary,
    };
    const parsed = ContactCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW CONTACT</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
          required
        />
        <TextInput
          label="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <TextInput
          label="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextInput
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label className="flex items-center gap-2 font-sans text-sm">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-ink-dim tracking-wide uppercase">
            Primary contact
          </span>
        </label>

        {error && <p className="text-accent font-sans text-sm">{error}</p>}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving.' : 'Save contact'}
        </Button>
      </form>
    </section>
  );
}
