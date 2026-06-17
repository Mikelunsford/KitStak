import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';

import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { CREATE_ACTIONS, visibleCreateActions } from './createMenuActions';

/**
 * CreateMenu. Topbar quick-create dropdown, scoped to what the caller can both
 * perform (capability) and reach (entitlement). Lazy-loaded by Topbar so the
 * capability matrix and the org-flags hook stay out of the eager SPA index
 * chunk (the same 40 kB budget discipline that keeps the Sidebar lazy-split).
 * Renders nothing when the caller has no available create actions.
 */
export function CreateMenu() {
  const { can } = useCapabilities();
  const flags = useOrgFlags().data;
  const actions = visibleCreateActions(CREATE_ACTIONS, can, flags);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  // Close on navigation (selecting an item already closes; this covers browser
  // back/forward and programmatic navigation).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Dismiss on outside pointer-down and Escape; listeners attach only while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 border border-line px-2 py-1 text-sm text-ink hover:bg-bg-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create new"
        data-testid="create-menu"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden font-sans lg:inline">Create</span>
      </button>
      {open ? (
        <ul
          role="menu"
          className="absolute right-0 mt-1 w-56 border border-line bg-bg shadow-lg"
        >
          {actions.map((action) => (
            <li key={action.href}>
              <Link
                to={action.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-left text-sm text-ink hover:bg-bg-2"
              >
                {action.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
