import { Disclosure } from 'kitstak-ui';

export function Collapsed() {
  return (
    <Disclosure label="Additional details">
      <dl className="flex flex-col gap-1 font-sans text-sm text-ink-dim">
        <div className="flex gap-2">
          <dt className="font-mono text-xs uppercase tracking-wide">Reference</dt>
          <dd className="tabular-nums text-ink">INV-3092</dd>
        </div>
      </dl>
    </Disclosure>
  );
}

export function Expanded() {
  return (
    <Disclosure label="Additional details" defaultOpen>
      <dl className="flex flex-col gap-1 font-sans text-sm text-ink-dim">
        <div className="flex gap-2">
          <dt className="font-mono text-xs uppercase tracking-wide">Reference</dt>
          <dd className="tabular-nums text-ink">PO-2025-118</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-mono text-xs uppercase tracking-wide">Source quote</dt>
          <dd className="tabular-nums text-ink">QTE-1180</dd>
        </div>
      </dl>
    </Disclosure>
  );
}
