// Builder dashboard engine registry + resolution (ADR 0006 P3). Pure module
// (no hooks, no apiClient) so the resolution logic is unit-testable without the
// supabase singleton. The dashboard component reads org flags and renders these.

import { Calculator, Hammer, type LucideIcon } from 'lucide-react';

import { FEATURE_FLAGS } from '@/lib/constants';

export interface BuilderEngine {
  id: string;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  // When set, the card shows only if the org has this plugin flag enabled.
  requiresFlag?: string;
}

export const ENGINES: ReadonlyArray<BuilderEngine> = [
  {
    id: 'estimate',
    title: 'Estimate Engine',
    description:
      'Classify a job, price it with the matching engine from an editable rate card, and produce a real, sendable quote.',
    to: '/estimates/new',
    icon: Calculator,
  },
  {
    id: 'job',
    title: 'Job Builder',
    description:
      'Turn an approved quote into a buildable job: BOM, receiving, labels, scope of work, a timeline checked against MABD, and an approval jacket.',
    to: '/3pl-operations/job-builder',
    icon: Hammer,
    requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
  },
];

// The engines the org can reach (an engine with a requiresFlag shows only when
// that plugin is enabled). Pure.
export function availableEngines(
  flags: Record<string, boolean>,
  engines: ReadonlyArray<BuilderEngine> = ENGINES,
): BuilderEngine[] {
  return engines.filter((e) => !e.requiresFlag || flags[e.requiresFlag] === true);
}
