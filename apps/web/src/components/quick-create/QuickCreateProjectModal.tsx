// QuickCreateProjectModal. Minimal inline create for a project, opened from the
// "+ New project" row on ProjectPicker (F-UIUX-ENTITYPICKER-01). Scope is the
// required fields only (number, name). Budget, dates, job type, and currency
// stay on the full /projects/new page. POSTs through the existing createProject
// service (Idempotency-Key minted by apiClient, org from the JWT), then hands
// the created record back so the parent picker can auto-select it.
//
// number is operator-supplied because projects-api requires it (no auto-number
// today, unlike quotes and sales orders). An optional customerId is threaded
// through so a project created from a customer-filtered picker inherits the
// customer link.

import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateProject } from '@/lib/hooks/useProjects';
import type { Project } from '@/lib/types/sales';

export interface QuickCreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
  initialName?: string;
  /** Seed the customer link when the picker is filtered to a customer. */
  customerId?: string | null;
}

export function QuickCreateProjectModal({
  open,
  onClose,
  onCreated,
  initialName = '',
  customerId = null,
}: QuickCreateProjectModalProps): JSX.Element | null {
  const create = useCreateProject();
  const [number, setNumber] = useState('');
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setNumber('');
    setName(initialName);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  if (!open) return null;

  const numberTrimmed = number.trim();
  const nameTrimmed = name.trim();
  const valid = numberTrimmed !== '' && nameTrimmed !== '';
  const pending = create.isPending;
  const errorMessage = create.error instanceof Error ? create.error.message : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      // currency_code and budget_cents carry the schema defaults; the full
      // /projects/new page is where those get set deliberately.
      const project = await create.mutateAsync({
        number: numberTrimmed,
        name: nameTrimmed,
        customer_id: customerId,
        currency_code: 'USD',
        budget_cents: 0,
      });
      onCreated(project);
    } catch {
      // Error surfaces via the inline banner below.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-create-project-form" disabled={pending || !valid}>
            {pending ? 'Saving.' : 'Save project'}
          </Button>
        </>
      }
    >
      <form id="quick-create-project-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Project number"
          name="number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="PRJ-2026-0001"
          required
          autoFocus
        />
        <TextInput
          label="Name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Spring co-pack run"
          required
        />
        {errorMessage && (
          <p className="font-sans text-sm text-danger">{errorMessage}</p>
        )}
      </form>
    </Modal>
  );
}
