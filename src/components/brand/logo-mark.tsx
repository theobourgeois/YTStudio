export function LogoMark() {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand to-brand/70 text-brand-foreground shadow-sm ring-1 ring-black/10 ring-inset"
    >
      {/* Vaudio's V: level-meter pills stepping down and up (the app icon's, see scripts/make-icon.ts). */}
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
        <rect x="1.6" y="3.2" width="2" height="5.4" rx="1" />
        <rect x="4.35" y="5.3" width="2" height="5.4" rx="1" opacity="0.9" />
        <rect x="7.1" y="7.4" width="2" height="5.4" rx="1" />
        <rect x="9.85" y="5.3" width="2" height="5.4" rx="1" opacity="0.9" />
        <rect x="12.6" y="3.2" width="2" height="5.4" rx="1" />
      </svg>
    </span>
  );
}
