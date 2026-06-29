// Builder dashboard (ADR 0006 P3): the launcher for the two engines. The
// Estimate Engine classifies and prices a job into a real quote; the Job Builder
// turns an approved quote into a buildable job. Only engines the org can reach
// appear (the Job Builder rides the 3PL plugin), matching the prototype's
// "only engines we have built appear here" ethos. Reconciled to the live design
// system. The engine registry + resolution is a pure module (builderEngines).

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { availableEngines } from './builderEngines';

export function BuilderDashboard() {
  const orgFlags = useOrgFlags();
  const engines = availableEngines(orgFlags.data);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Builder"
        meta="Engines that scaffold a project end to end. Launch one to get started."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {engines.map((e) => {
          const Icon = e.icon;
          return (
            <Link
              key={e.id}
              to={e.to}
              className="group flex flex-col border border-line bg-bg-2 p-5 transition-colors hover:border-line-strong"
            >
              <span className="mb-3 inline-flex h-11 w-11 items-center justify-center border border-line text-accent">
                <Icon className="h-6 w-6" />
              </span>
              <span className="font-display text-lg tracking-wide text-ink">{e.title}</span>
              <span className="mt-1 flex-1 font-sans text-sm text-ink-dim">{e.description}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 font-sans text-sm text-accent">
                Launch
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
