import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { contactsKeys } from '@/lib/queryKeys/contacts';
import { listContacts } from '@/lib/services/contactsService';

export function ContactsListPage() {
  const [search] = useSearchParams();
  const customerId = search.get('customer_id') ?? undefined;
  const [q, setQ] = useState('');
  const filters = {
    ...(customerId ? { customer_id: customerId } : {}),
    ...(q ? { q } : {}),
  };
  const query = useQuery({
    queryKey: contactsKeys.list(filters as Record<string, unknown>),
    queryFn: () => listContacts(filters),
    staleTime: 30_000,
  });

  return (
    <section className="px-8 py-10 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">CONTACTS</h1>
        <Link to={customerId ? `/crm/contacts/new?customer_id=${customerId}` : '/crm/contacts/new'} className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New contact</Link>
      </header>
      <input
        type="text"
        placeholder="Search by first name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="bg-bg-2 border border-line px-3 py-2 font-sans"
      />
      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left font-display tracking-wider text-sm">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Primary</th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2 font-sans">
                  <Link to={`/crm/contacts/${c.id}`} className="underline">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                  </Link>
                </td>
                <td className="px-4 py-2 font-sans">{c.email ?? ''}</td>
                <td className="px-4 py-2 font-sans">{c.title ?? ''}</td>
                <td className="px-4 py-2 font-sans">{c.is_primary ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
