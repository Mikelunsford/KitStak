import type { ReactNode } from 'react';

// Presentational primitives for the Estimate Engine wizard, on the live design
// system: semantic tokens (accent / ink / line / bg), square corners, no shadow.

interface SegOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegOption<T>>;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="inline-flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`border px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'border-accent bg-accent text-on-primary'
                : 'border-line bg-bg-2 text-ink-dim hover:border-accent'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dim">
      {children}
      {hint ? (
        <span
          className="inline-flex h-4 w-4 cursor-help items-center justify-center border border-line text-[10px] text-ink-faint"
          title={hint}
        >
          i
        </span>
      ) : null}
    </span>
  );
}

export interface StepDef {
  n: number;
  label: string;
}

interface StepperProps {
  steps: ReadonlyArray<StepDef>;
  current: number;
  onGo: (n: number) => void;
}

export function Stepper({ steps, current, onGo }: StepperProps) {
  return (
    <div className="mb-8 flex gap-2 border-y border-line py-4">
      {steps.map((st) => {
        const done = current > st.n;
        const active = current === st.n;
        return (
          <button
            key={st.n}
            type="button"
            onClick={() => onGo(st.n)}
            className="flex flex-1 items-center gap-2.5 px-2 py-1 text-left transition hover:bg-bg-2"
          >
            <span
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center border text-sm font-medium ${
                done || active ? 'border-accent bg-accent text-on-primary' : 'border-line text-ink-faint'
              }`}
            >
              {done ? '✓' : st.n}
            </span>
            <span className="flex flex-col">
              <span className={`text-[10px] uppercase tracking-wider ${active ? 'text-accent' : 'text-ink-faint'}`}>
                Step {st.n}
              </span>
              <span className={`text-sm ${active ? 'font-semibold text-ink' : done ? 'text-ink-dim' : 'text-ink-faint'}`}>
                {st.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface NumberStepperProps {
  value: string;
  onDec: () => void;
  onInc: () => void;
  onChange: (v: string) => void;
}

export function NumberStepper({ value, onDec, onInc, onChange }: NumberStepperProps) {
  return (
    <div className="flex items-center border border-line bg-bg">
      <button
        type="button"
        onClick={onDec}
        className="h-8 w-7 text-lg leading-none text-ink-dim hover:text-accent"
        aria-label="Decrease"
      >
        {'−'}
      </button>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="h-8 w-14 border-x border-line bg-transparent text-center font-mono text-sm text-ink outline-none"
      />
      <button
        type="button"
        onClick={onInc}
        className="h-8 w-7 text-lg leading-none text-ink-dim hover:text-accent"
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}
