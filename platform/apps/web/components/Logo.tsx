import Link from 'next/link';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="SOLLUNA home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="9" fill="#C9962B" />
        <path d="M22.5 6.5a11 11 0 1 0 3 15A9 9 0 0 1 22.5 6.5Z" fill={light ? '#FAF7F0' : '#12131C'} />
      </svg>
      <span className={`font-display text-xl tracking-[0.18em] ${light ? 'text-ivory' : 'text-ink'}`}>SOLLUNA</span>
    </Link>
  );
}
