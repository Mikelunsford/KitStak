import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Inbox, X } from 'lucide-react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useIsPlatformStaff } from '@/lib/hooks/useFeedback';
import {
  SIDEBAR_MODES,
  findActiveMode,
  isModeVisible,
  visibleRoutesForMode,
} from './sidebarModes';

/**
 * Sidebar. Static section rail (Section Dashboards).
 *
 * Each task section is a single icon + label that links straight to its Section
 * Dashboard. The section's sub-areas live on that dashboard's hub, so the rail
 * no longer expands inline: the former caret/accordion, the per-section sub-link
 * list, and the type-to-filter box (which only made sense with inline links) are
 * all gone. This is the operator-requested simplification on top of the
 * header-opens-dashboard mechanic.
 *
 * A section renders only when the active role can see it (isModeVisible) and it
 * has at least one entitled route, so add-on sections stay hidden until their
 * plugin is on. The active section is highlighted via findActiveMode, so a deep
 * sub-route (e.g. /crm/leads) still lights up its section (SELL).
 *
 * Below the md breakpoint this is a slide-in drawer driven by AppShell; at md
 * and up it stays a fixed w-56 rail.
 */

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps = {}) {
  const orgFlags = useOrgFlags();
  const flags = orgFlags.data;
  const { pathname } = useLocation();
  const { role, can } = useCapabilities();
  // Platform-staff probe gates the dedicated staff "Feedback inbox" rail link
  // below (fail-closed while the probe loads). Never 403s; pure render gate.
  const isStaff = useIsPlatformStaff().data ?? false;
  const activeMode = useMemo(() => findActiveMode(pathname), [pathname]);

  const sections = SIDEBAR_MODES.filter((mode) =>
    isModeVisible(mode, role, can),
  ).filter((mode) => visibleRoutesForMode(mode, flags, can).length > 0);

  const onNavClick = () => {
    if (onClose) onClose();
  };

  const dashboardActive = pathname === '/dashboard';
  const feedbackInboxActive =
    pathname === '/admin/feedback' ||
    pathname.startsWith('/admin/feedback/');

  const navContent = (
    <>
      <Link
        to="/dashboard"
        onClick={onNavClick}
        aria-current={dashboardActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 border-l-2 px-3 py-2 font-sans text-sm tracking-wide',
          dashboardActive
            ? 'border-accent bg-bg-2 text-ink'
            : 'border-transparent text-ink-dim hover:bg-bg-2 hover:text-ink',
        )}
      >
        <Home className="h-4 w-4" />
        DASHBOARD
      </Link>

      {sections.map((mode) => {
        const Icon = mode.icon;
        const isActive = activeMode === mode.key;
        return (
          <Link
            key={mode.key}
            to={mode.homePath}
            onClick={onNavClick}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 border-l-2 px-3 py-2 font-display text-base uppercase tracking-wider',
              isActive
                ? 'border-accent bg-bg-2 text-ink'
                : 'border-transparent text-ink hover:bg-bg-2',
            )}
          >
            <Icon className="h-4 w-4" />
            {mode.label}
          </Link>
        );
      })}

      {isStaff ? (
        <Link
          to="/admin/feedback"
          onClick={onNavClick}
          aria-current={feedbackInboxActive ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2 border-l-2 px-3 py-2 font-display text-base uppercase tracking-wider',
            feedbackInboxActive
              ? 'border-accent bg-bg-2 text-ink'
              : 'border-transparent text-ink hover:bg-bg-2',
          )}
        >
          <Inbox className="h-4 w-4" />
          FEEDBACK INBOX
        </Link>
      ) : null}
    </>
  );

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      ) : null}

      <nav
        className="hidden w-56 flex-col gap-0.5 overflow-y-auto border-r border-line bg-bg px-2 py-4 md:flex"
        aria-label="Primary"
      >
        {navContent}
      </nav>

      <nav
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-bg shadow-xl transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
        aria-hidden={!mobileOpen}
      >
        <div className="flex items-center justify-end px-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="p-1 text-ink-dim hover:bg-bg-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4 pt-2">
          {navContent}
        </div>
      </nav>
    </>
  );
}
