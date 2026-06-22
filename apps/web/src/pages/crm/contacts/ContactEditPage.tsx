import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { useContact } from '@/lib/hooks/useContact';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { updateContact } from '@/lib/services/contactsService';
import { ContactPatchSchema, type ContactPatch } from '@/lib/types/crm';

export function ContactEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useContact(id);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const c = query.data;
      setFirstName(c.first_name);
      setLastName(c.last_name ?? '');
      setTitle(c.title ?? '');
      setEmail(c.email ?? '');
      setPhone(c.phone ?? '');
      setIsPrimary(c.is_primary);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: ContactPatch) => updateContact(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contactsKeys.all });
      navigate(`/crm/contacts/${id}`);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to save contact.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      first_name: firstName,
      last_name: lastName.trim() || null,
      title: title.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      is_primary: isPrimary,
    };
    const parsed = ContactPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Contact not found.</p>;
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <PageHeader title="Edit contact" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
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
          placeholder="Optional"
        />
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Optional"
        />
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Optional"
        />
        <TextInput
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Optional"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-ink-dim tracking-wide uppercase">
            Primary contact
          </span>
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <Button type="submit" disabled={mutation.isPending} className="self-start">
          {mutation.isPending ? 'Saving.' : 'Save'}
        </Button>
      </form>
    </section>
  );
}
