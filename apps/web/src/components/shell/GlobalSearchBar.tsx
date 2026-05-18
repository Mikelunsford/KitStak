// GlobalSearchBar. Topbar slot.
//
// Renders a search input. On submit, navigates to /search?q=... where the
// GlobalSearchResultsPage renders the grouped result set. Live-search is
// debounced 250ms and shows a dropdown preview of the top result per group.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useGlobalSearch } from '@/lib/hooks/useCrossCutting';

export function GlobalSearchBar() {
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), 250);
    return () => window.clearTimeout(handle);
  }, [value]);

  const query = useGlobalSearch(debounced, { enabled: debounced.length > 0 });

  const previews: Array<{ label: string; href: string; group: string }> = [];
  const groups = query.data?.groups ?? {};
  for (const [group, items] of Object.entries(groups)) {
    if (items && items.length > 0) {
      const first = items[0];
      if (first) {
        previews.push({
          label: first.title,
          href: first.href,
          group,
        });
      }
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim().length === 0) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(value.trim())}`);
  }

  return (
    <form onSubmit={submit} className="relative" role="search">
      <div className="flex items-center gap-1 border border-line bg-bg-2 px-2 py-1">
        <Search className="h-4 w-4 text-ink-dim" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Search customers, quotes, invoices."
          className="w-64 bg-transparent text-sm text-ink placeholder:text-ink-dim focus:outline-none"
          aria-label="Global search"
        />
      </div>
      {open && debounced.length > 0 && previews.length > 0 ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 mt-1 border border-line bg-bg shadow-lg"
        >
          {previews.map((p) => (
            <li key={`${p.group}-${p.href}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  navigate(p.href);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg-2"
              >
                <span className="font-medium text-ink">{p.label}</span>
                <span className="text-xs uppercase tracking-wide text-ink-dim">
                  {p.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
