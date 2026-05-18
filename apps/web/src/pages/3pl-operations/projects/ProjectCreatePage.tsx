import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateProject } from '@/lib/hooks/useProjects';

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const create = useCreateProject();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await create.mutateAsync({ number, name, currency_code: 'USD', budget_cents: 0 });
    navigate(`/3pl-operations/projects/${r.id}`);
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW PROJECT</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Project number"
          value={number} onChange={(e) => setNumber(e.target.value)} required
        />
        <TextInput
          label="Name"
          value={name} onChange={(e) => setName(e.target.value)} required
        />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
