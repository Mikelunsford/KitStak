// MemberDetailPage. KitForce pillar. F-UIUX-HUB-TABS-MEMBER-01 turns the member
// record from a leaf into a tabbed hub (matching the customer and vendor hubs):
// an Overview tab carrying the member's own data plus its HISTORY timeline, then
// one tab each for the member's assignments, time entries, and shifts.
//
// The breadcrumbs, the PageHeader with its lifecycle actions, and the two
// deactivate/reactivate error lines stay ABOVE the tabs: they are the member's
// primary actions and stay visible on every tab.
//
// Preserved verbatim: the kitforce.member.update gate on Edit, the
// kitforce.member.deactivate gate on Deactivate/Reactivate, the deactivate
// destructiveConfirm (reactivate fires directly), the kitforce.member.read_rate
// gate on the default-rate field (Overview) and on any time-entry rate, and the
// AuditTimeline.
//
// Related lists are read-only. KitForce assignments, time entries, and shifts
// are all created via inline forms on their LIST pages, not via dedicated create
// routes that accept a member_id prefill, so none of the three related sections
// use RelatedSection (its required CTA would be misleading). Each renders a plain
// titled section with a coaching empty state and no CTA, mirroring the read-only
// invoices list on ProjectDetailPage.

import { Link, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs, type TabSpec } from '@/components/ui/Tabs';
import {
  useMember,
  useDeactivateMember,
  useReactivateMember,
  useAssignmentsList,
  useTimeEntriesList,
  useShiftsList,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import {
  MemberOverviewPanel,
  MemberAssignmentsPanel,
  MemberTimeEntriesPanel,
  MemberShiftsPanel,
} from './MemberRelatedTabs';

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? '';

  const member = useMember(id);
  const deactivate = useDeactivateMember(memberId);
  const reactivate = useReactivateMember(memberId);

  const caps = useVioCapabilities();
  const canReadRate = caps.can('kitforce.member.read_rate');
  const canDeactivate = caps.can('kitforce.member.deactivate');
  const canUpdate = caps.can('kitforce.member.update');

  const assignments = useAssignmentsList(memberId ? { member_id: memberId } : {});
  const timeEntries = useTimeEntriesList(memberId ? { member_id: memberId } : {});
  const shifts = useShiftsList(memberId ? { member_id: memberId } : {});

  if (member.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (member.error || !member.data) {
    return <p className="px-8 py-12 text-accent">Member not found.</p>;
  }
  const d = member.data;

  const isActive = d.status === 'active';

  async function onDeactivate() {
    if (
      !(await destructiveConfirm({
        action: 'Deactivate this member',
        consequence:
          'The member moves to inactive and stops appearing in active rosters. Time entries already recorded are kept.',
      }))
    )
      return;
    deactivate.mutate({});
  }

  const tabs: TabSpec[] = [
    {
      key: 'overview',
      label: 'Overview',
      panel: (
        <MemberOverviewPanel member={d} memberId={id ?? null} canReadRate={canReadRate} />
      ),
    },
    {
      key: 'assignments',
      label: 'Assignments',
      panel: (
        <MemberAssignmentsPanel
          rows={assignments.data ?? []}
          isLoading={assignments.isLoading}
        />
      ),
    },
    {
      key: 'time-entries',
      label: 'Time entries',
      panel: (
        <MemberTimeEntriesPanel
          rows={timeEntries.data ?? []}
          isLoading={timeEntries.isLoading}
          canReadRate={canReadRate}
        />
      ),
    },
    {
      key: 'shifts',
      label: 'Shifts',
      panel: (
        <MemberShiftsPanel rows={shifts.data ?? []} isLoading={shifts.isLoading} />
      ),
    },
  ];

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Members', to: '/kitforce/members' },
          { label: d.member_number ?? d.display_name },
        ]}
      />
      <PageHeader
        title={d.display_name}
        meta={<StatusBadge status={d.status} />}
        actions={
          <>
            {canUpdate && (
              <Link to={`/kitforce/members/${memberId}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
            {isActive && canDeactivate && (
              <Button
                variant="ghost"
                onClick={onDeactivate}
                disabled={deactivate.isPending}
              >
                Deactivate
              </Button>
            )}
            {!isActive && canDeactivate && (
              <Button
                variant="secondary"
                onClick={() => reactivate.mutate({})}
                disabled={reactivate.isPending}
              >
                Reactivate
              </Button>
            )}
          </>
        }
      />
      {deactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {deactivate.error instanceof Error
            ? deactivate.error.message
            : 'Deactivate failed.'}
        </p>
      ) : null}
      {reactivate.error ? (
        <p className="font-sans text-sm text-accent">
          {reactivate.error instanceof Error
            ? reactivate.error.message
            : 'Reactivate failed.'}
        </p>
      ) : null}

      <Tabs aria-label="Member detail" tabs={tabs} />
    </section>
  );
}
