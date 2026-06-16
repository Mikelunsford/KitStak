import {
  InputHTMLAttributes,
  forwardRef,
  type ForwardedRef,
  type ReactElement,
} from 'react';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

// Named render function so unit tests can invoke the component directly the way
// they call a plain function component (element-tree walk, no jsdom), instead of
// reaching into the forwardRef internal `.render` property
// (F-Wave13-FORWARDREF-TEST-HARDENING-01). forwardRef wraps it below; runtime
// behavior is unchanged.
export function renderTextInput(
  { label, error, className = '', id, ...rest }: TextInputProps,
  ref?: ForwardedRef<HTMLInputElement>,
): ReactElement {
  const inputId = id ?? rest.name;
  return (
    <label className="flex flex-col gap-2" htmlFor={inputId}>
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent ${className}`}
        {...rest}
      />
      {error && (
        <span className="font-sans text-sm text-danger">{error}</span>
      )}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(renderTextInput);
TextInput.displayName = 'TextInput';
