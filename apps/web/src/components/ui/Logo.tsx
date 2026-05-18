type LogoProps = {
  size?: 'compact' | 'default' | 'hero';
  className?: string;
};

const dimensions = {
  compact: { barW: 32, barH: 8, gap: 4, textSize: 'text-2xl' },
  default: { barW: 44, barH: 12, gap: 8, textSize: 'text-3xl' },
  hero: { barW: 88, barH: 24, gap: 16, textSize: 'text-6xl' },
} as const;

export function Logo({ size = 'default', className = '' }: LogoProps) {
  const d = dimensions[size];

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="flex flex-col" style={{ gap: d.gap }}>
        <div
          className="bg-accent"
          style={{ width: d.barW, height: d.barH }}
          aria-hidden="true"
        />
        <div
          className="bg-accent opacity-70"
          style={{ width: d.barW, height: d.barH }}
          aria-hidden="true"
        />
      </div>
      <span className={`font-display ${d.textSize} text-ink tracking-[0.08em]`}>
        KITSTAK
      </span>
    </div>
  );
}
