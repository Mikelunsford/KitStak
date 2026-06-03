// LeadsKanbanPage. CRM Sell surface. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + kit Button replace the hand-rolled header
// and the link-as-button CTA. The five-column kanban (aligned with the lead
// state machine) stays bespoke; there is no kit equivalent for a board, and the
// client-side grouping + the deferred drag-drop are unchanged.

import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useLeads } from '@/lib/hooks/useLeads';
import { leadStateMachine, type LeadState } from '@/lib/workflow/crm';

/**
 * Leads kanban. Five columns aligned with the lead state machine. Reads the
 * full list once and groups client-side; the SPA hides drag-drop until the
 * patch endpoint lands a transition wire (Wave 3 follow-up).
 */
export function LeadsKanbanPage() {
  const query = useLeads({});
  const columns: LeadState[] = [...leadStateMachine.states];

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-6 px-8 py-10">
      <PageHeader
        eyebrow="Sell / Leads"
        title="Leads"
        actions={
          <Link to="/crm/leads/new">
            <Button variant="primary">New lead</Button>
          </Link>
        }
      />
      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {columns.map((col) => {
            const inCol = (query.data ?? []).filter((l) => l.status === col);
            return (
              <div key={col} className="bg-bg-2 border border-line flex flex-col gap-2">
                <h2 className="px-3 py-2 font-display tracking-wider text-sm border-b border-line">
                  {col.toUpperCase()} ({inCol.length})
                </h2>
                <ul className="flex flex-col gap-2 p-2 min-h-32">
                  {inCol.map((l) => (
                    <li
                      key={l.id}
                      className="border border-line bg-bg-1 p-2 text-sm font-sans"
                    >
                      <Link to={`/crm/leads/${l.id}`} className="underline">
                        {l.display_name}
                      </Link>
                      <div className="text-ink-dim text-xs">
                        {l.company_name ?? ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
