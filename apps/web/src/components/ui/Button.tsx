import { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const styles: Record<Variant, string> = {
  primary:
    'bg-accent text-ink hover:bg-accent-bright disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'bg-bg-2 text-ink border border-line hover:border-line-strong disabled:opacity-50',
  ghost: 'bg-transparent text-ink hover:bg-bg-2 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonProps) {
  const base =
    'px-5 py-2.5 font-sans font-medium tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />;
}
