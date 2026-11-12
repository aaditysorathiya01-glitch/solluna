import Link from 'next/link';

/** SOLLUNA mark (owner's logo, 12 Nov 2026): transparent PNG in public/brand. */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="SOLLUNA home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/solluna-mark.png" alt="" aria-hidden width={14} height={32} className="h-8 w-auto" />
      <span className={`font-display text-xl tracking-[0.18em] ${light ? 'text-ivory' : 'text-ink'}`}>SOLLUNA</span>
    </Link>
  );
}
