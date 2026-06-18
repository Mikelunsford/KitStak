import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EntityPicker } from '@/components/ui/EntityPicker';
import { QuickCreateProjectModal } from '@/components/quick-create/QuickCreateProjectModal';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { projectsKeys } from '@/lib/queryKeys/projects';
import { listProjects } from '@/lib/services/projectsService';
import type { Project } from '@/lib/types/sales';

/**
 * ProjectPicker. Typeahead combobox over the org's projects (projects-api),
 * with a "+ New project" button beside the search field, gated on projects.project.write
 * capability (F-UIUX-ENTITYPICKER-01). The customer_id narrowing is performed
 * client-side because the list route does not yet expose a customer filter; a
 * project created inline inherits that customer link. Public props are unchanged
 * from the prior native-select version.
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
  placeholder = 'Search projects.',
  filter,
}: ProjectPickerProps) {
  const { can } = useCapabilities();
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<Project | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: projectsKeys.list({}),
    queryFn: () => listProjects(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const options = useMemo(() => {
    const all = data ?? [];
    const merged =
      justCreated && !all.some((p) => p.id === justCreated.id)
        ? [justCreated, ...all]
        : all;
    if (filter?.customer_id) {
      return merged.filter((p) => p.customer_id === filter.customer_id);
    }
    return merged;
  }, [data, justCreated, filter?.customer_id]);

  return (
    <>
      <EntityPicker<Project>
        value={value}
        onChange={(id) => onChange(id)}
        options={options}
        getOptionId={(p) => p.id}
        getOptionLabel={(p) => (p.name ? `${p.number} · ${p.name}` : p.number)}
        label={label}
        required={required}
        disabled={disabled}
        loading={isLoading}
        placeholder={placeholder}
        allowCreate={can('projects.project.write')}
        createLabel="New project"
        onCreate={() => setCreateOpen(true)}
      />
      <QuickCreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        customerId={filter?.customer_id ?? null}
        onCreated={(project) => {
          setJustCreated(project);
          onChange(project.id);
          setCreateOpen(false);
        }}
      />
    </>
  );
}
