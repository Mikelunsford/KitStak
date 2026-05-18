import { useState } from 'react';
import { ChevronDown, LogOut, Menu, UserCircle2 } from 'lucide-react';

import { useAuth } from '@/auth/AuthContext';
import { useBrandingContext } from '@/whitelabel/BrandingProvider';
import { useMe } from '@/lib/hooks/useMe';
import { useSwitchOrg } from '@/lib/hooks/useSwitchOrg';
import { Logo } from '@/components/ui/Logo';

/**
 * Topbar. persistent top chrome.
 *
 *   [ logo + workspace name ]    [ workspace switcher ] [ profile menu ]
 *
 * Workspace switcher reads memberships from useMe() and posts to
 * /auth-api/sessions/switch-org. Wave 1: the auth-api endpoint ships in
 * Wave 2; the mutation is wired now and will become live the moment the
 * function deploys (TODO marker in useSwitchOrg).
 *
 * App name fallback chain per REBRAND-MAP § 8:
 *   branding.app_name_override -> active org display_name -> "Kitstak"
 * Never default to a previous tenant's name.
 */

export interface TopbarProps {
  /** Mobile hamburger handler. AppShell wires this for `< md`. */
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps = {}) {
  const { state, signOut } = useAuth();
  const isAuthed = state.status === 'authenticated';
  const me = useMe({ enabled: isAuthed });
  const branding = useBrandingContext();
  const switchOrg = useSwitchOrg();

  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const memberships = me.data?.memberships ?? [];
  const activeOrgId = me.data?.active_org_id;
  const activeOrg =
    memberships.find((m) => m.org_id === activeOrgId) ?? memberships[0];

  const appName =
    branding.branding?.app_name_override ??
    activeOrg?.display_name ??
    'Kitstak';

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-line bg-bg px-4">
      <div className="flex items-center gap-3 font-semibold">
        {onMenuClick ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="p-1 text-ink-dim hover:bg-bg-2 hover:text-ink md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}
        <Logo size="compact" />
        <span className="hidden font-sans text-sm text-ink-dim tracking-wide md:inline">
          {appName}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Workspace switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            className="flex items-center gap-1 border border-line px-2 py-1 text-sm hover:bg-bg-2"
            aria-haspopup="menu"
            aria-expanded={orgMenuOpen}
            disabled={!isAuthed || me.isLoading || memberships.length === 0}
          >
            <span className="font-sans font-medium text-ink">
              {activeOrg?.display_name ??
                (me.isLoading ? 'Loading...' : 'No workspace')}
            </span>
            <ChevronDown className="h-4 w-4 text-ink-dim" />
          </button>
          {orgMenuOpen && memberships.length > 0 ? (
            <ul
              role="menu"
              className="absolute right-0 mt-1 w-56 border border-line bg-bg shadow-lg"
            >
              {memberships.map((m) => {
                const active = m.org_id === activeOrgId;
                return (
                  <li key={m.org_id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setOrgMenuOpen(false);
                        if (!active) {
                          switchOrg.mutate(m.org_id);
                        }
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg-2"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium text-ink">
                          {m.display_name}
                        </span>
                        <span className="text-xs text-ink-dim">{m.role}</span>
                      </span>
                      {active ? (
                        <span className="text-xs uppercase tracking-wide text-ink-dim">
                          Active
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {/* Profile menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((v) => !v)}
            className="flex items-center gap-1 p-1 hover:bg-bg-2"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
          >
            <UserCircle2 className="h-7 w-7 text-ink-dim" />
          </button>
          {profileMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 mt-1 w-56 border border-line bg-bg p-2 shadow-lg"
            >
              <div className="px-2 py-1">
                <p className="text-xs uppercase tracking-wide text-ink-dim">
                  Signed in as
                </p>
                <p className="truncate text-sm font-medium text-ink">
                  {state.status === 'authenticated' ? state.user.email : '.'}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  void signOut();
                }}
                className="mt-1 flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-bg-2"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
