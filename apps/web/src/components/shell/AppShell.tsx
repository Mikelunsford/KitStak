import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Topbar } from './Topbar';
import { TrialBanner } from './TrialBanner';
import { lazyWithReload } from '@/lib/lazyWithReload';

/**
 * Sidebar is lazy-split out of the eager shell (F-Wave12-INDEX-BUDGET-HEADROOM-01).
 * The sidebar config (sidebarModes.ts) and the navigation icon set are the
 * single largest eager contributor to the SPA index chunk: roughly fifty
 * lucide-react icons plus the per-pillar route metadata. Pulling Sidebar behind
 * a lazy boundary moves that weight into its own chunk and reclaims index
 * headroom under the 40 kB size-limit budget so later phases (WMS B0 onward)
 * can add navigation weight without raising the budget.
 *
 * The chunk still loads on the first authenticated render (Sidebar is always
 * mounted), so by the time the operator interacts with the nav it is present.
 * The fallback below renders a fixed `w-56` rail at the `md:` breakpoint that
 * matches the real rail's footprint, so first paint shows no layout shift; the
 * nav links simply fill in a beat later. Below `md` the rail is a closed
 * drawer, so the fallback is visually empty there.
 */
const Sidebar = lazyWithReload(() =>
  import('./Sidebar').then((m) => ({ default: m.Sidebar })),
);

/**
 * CommandBar is lazy-split for the same index-budget reason as Sidebar
 * (F-UIUX-PALETTE-VERBS-01). The palette gained action verbs gated by
 * useCapabilities, which pulls the capability matrix in; behind a lazy boundary
 * that weight (plus the palette's own code) lives in its own chunk instead of
 * the eager index chunk. It is mounted only while open, so the chunk loads on
 * the first Cmd/Ctrl-K, not on every authenticated render.
 */
const CommandBar = lazyWithReload(() =>
  import('./CommandBar').then((m) => ({ default: m.CommandBar })),
);

/**
 * BackBar. A single global "back to the previous screen" control at the top of
 * the content area, replacing the per-page breadcrumb/eyebrow wayfinding that
 * was removed as noisy. Hidden on the dashboard (the home surface, nothing
 * meaningful to go back to). Uses router history so it mirrors the browser back.
 */
function BackBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (pathname === '/dashboard') return null;
  return (
    <div className="px-8 pt-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 font-sans text-sm text-ink-dim transition-colors hover:text-ink"
        data-testid="back-button"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </button>
    </div>
  );
}

function SidebarFallback() {
  // Mirror only the real rail's footprint-bearing classes (width, border,
  // md:flex direction) so the main column does not shift when the live rail
  // mounts. The interior classes (gap, padding, overflow) are intentionally
  // omitted; the placeholder has no children, and w-56 is the outer width
  // either way (border-box), so there is no horizontal layout shift.
  return (
    <nav
      className="hidden w-56 flex-col border-r border-line bg-bg md:flex"
      aria-hidden="true"
    />
  );
}

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
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Close the command bar on navigation. Selecting a result already calls the
  // close handler, but browser back/forward and programmatic navigation should
  // also dismiss it defensively.
  useEffect(() => {
    setCommandBarOpen(false);
  }, [pathname]);

  // Global Cmd/Ctrl-K toggle. Bound once for the whole authenticated shell so
  // the palette is reachable from any page. defaultPrevented guards against
  // hijacking the shortcut while another handler (none today) owns it.
  const closeCommandBar = useCallback(() => setCommandBarOpen(false), []);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (!isToggle || e.defaultPrevented) return;
      e.preventDefault();
      setCommandBarOpen((cur) => !cur);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TrialBanner />
      <Topbar
        onMenuClick={() => setMobileNavOpen(true)}
        onOpenCommandBar={() => setCommandBarOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar
            mobileOpen={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
          />
        </Suspense>
        <main className="flex-1 overflow-y-auto">
          <BackBar />
          {children}
        </main>
      </div>
      {commandBarOpen && (
        <Suspense fallback={null}>
          <CommandBar open onClose={closeCommandBar} />
        </Suspense>
      )}
    </div>
  );
}
