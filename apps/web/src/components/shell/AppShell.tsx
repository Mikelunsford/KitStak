import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Authenticated app chrome. Topbar across the top, Sidebar on the left,
 * route content in the main area. Public routes (/signin, /portal/signin,
 * /feature-unavailable) wrap their content directly in <main> and do NOT
 * use AppShell.
 *
 * Below the `md:` breakpoint Sidebar collapses into a slide-in drawer
 * controlled here; Topbar exposes a hamburger that opens it. Pathname
 * changes close the drawer defensively (covers programmatic navigation
 * and browser back/forward).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
