export function LogoMark() {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand to-brand/70 text-brand-foreground shadow-sm ring-1 ring-black/10 ring-inset"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
        <rect x="1.5" y="3" width="3" height="10" rx="1" opacity="0.55" />
        <path d="M6.5 3.9v8.2a.7.7 0 0 0 1.06.6l6.3-4.1a.7.7 0 0 0 0-1.2l-6.3-4.1a.7.7 0 0 0-1.06.6Z" />
      </svg>
    </span>
  );
}
