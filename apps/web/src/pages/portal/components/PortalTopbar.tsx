// PortalTopbar. Persistent top chrome for every /portal/* page.
//
// F-Wave9-PORTAL-NAV-01: the standalone /portal/invoices, /portal/quotes,
// and /portal/projects pages existed before this PR but were unreachable
// from the SPA — the dashboard's three sections rendered inline tables
// without a way to drill into the dedicated list. This component lives
// at the top of every portal page and gives the customer:
//
//   Dashboard | Invoices | Quotes | Projects        Sign out
//
// Active route gets visual emphasis (accent underline). Mirrors the
// operator-side Topbar pattern without depending on the AppShell or
// workspace switcher (portal routes are guard:'portal' layout:
// 'unauthenticated' — no AppShell wraps them).
//
// Brand discipline: navy/ink tokens, Bebas Neue display font for the
// section labels, Inter Tight body font for the email line. No emoji, no
// em dash, no double hyphen.

import { useNavigate, NavLink } from 'react-router-dom';

import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/auth/AuthContext';

interface PortalNavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: ReadonlyArray<PortalNavItem> = [
  { to: '/portal', label: 'Dashboard' },
  { to: '/portal/invoices', label: 'Invoices' },
  { to: '/portal/quotes', label: 'Quotes' },
  { to: '/portal/projects', label: 'Projects' },
];

export function PortalTopbar() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  const onSignOut = async () => {
    await signOut();
    navigate('/portal/signin', { replace: true });
  };

  const email = state.status === 'authenticated' ? state.user.email : null;

  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Logo size="compact" />
          <nav aria-label="Portal sections" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/portal'}
                    className={({ isActive }) =>
                      [
                        'inline-flex items-center px-3 py-2 font-display text-sm tracking-wider uppercase',
                        'border-b-2 transition-colors',
                        isActive
                          ? 'border-accent text-ink'
                          : 'border-transparent text-ink-dim hover:text-ink hover:border-line',
                      ].join(' ')
                    }
                    data-testid={`portal-nav-${item.label.toLowerCase()}`}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email ? (
            <span className="hidden truncate font-sans text-xs text-ink-dim md:inline">
              {email}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void onSignOut();
            }}
            className="border border-line bg-bg px-3 py-1.5 font-sans text-sm text-ink hover:bg-bg-2"
            data-testid="portal-sign-out"
          >
            Sign out
          </button>
        </div>
      </div>
      {/* Mobile nav: visible below md. Same items, simpler horizontal scroll. */}
      <nav
        aria-label="Portal sections (mobile)"
        className="border-t border-line bg-bg-2 md:hidden"
      >
        <ul className="flex items-center gap-1 overflow-x-auto px-4 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/portal'}
                className={({ isActive }) =>
                  [
                    'inline-flex shrink-0 items-center px-3 py-1.5 font-display text-xs tracking-wider uppercase',
                    'border-b-2',
                    isActive
                      ? 'border-accent text-ink'
                      : 'border-transparent text-ink-dim',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
