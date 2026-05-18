import { InputHTMLAttributes, forwardRef } from 'react';

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, error, className = '', id, ...rest }, ref) {
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
  },
);
