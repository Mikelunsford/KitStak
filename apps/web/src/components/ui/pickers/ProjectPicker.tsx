import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { projectsKeys } from '@/lib/queryKeys/projects';
import { listProjects } from '@/lib/services/projectsService';

/**
 * ProjectPicker. Fetches projects list and optionally narrows to a customer.
 * The server list endpoint accepts a state filter; the customer_id narrowing
 * is performed client-side because the list route does not yet expose a
 * customer filter (tracked as follow-up; today's filter is cheap given small
 * list sizes for first operator).
 */
export interface ProjectPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  filter?: { customer_id?: string } | undefined;
}

export function ProjectPicker({
  value,
  onChange,
  label = 'Project',
  required = false,
  disabled = false,
  placeholder = 'Select a project.',
  filter,
}: ProjectPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: projectsKeys.list({}),
    queryFn: () => listProjects(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = useMemo(() => {
    const all = data ?? [];
    if (filter?.customer_id) {
      return all.filter((p) => p.customer_id === filter.customer_id);
    }
    return all;
  }, [data, filter?.customer_id]);

  return (
    <label className="flex flex-col gap-2">
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
          {required && <span className="text-accent ml-1">*</span>}
        </span>
      )}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        required={required}
        disabled={disabled || isLoading}
        className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="">{isLoading ? 'Loading.' : placeholder}</option>
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.number} {p.name ? `· ${p.name}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
