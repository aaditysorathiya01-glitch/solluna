import Link from 'next/link';
import { Logo } from './Logo';

export const CONTACT = { email: 'solluna.play@gmail.com', city: 'Anjar, Kachchh, Gujarat', legalName: 'Aaditya Jitendrabhai Sorathia (Proprietor), trading as Solluna', gstin: '24OPVPS8924H1ZQ' };

const NAV = [
  ['/services', 'Services'],
  ['/#pricing', 'Pricing'],
  ['/about', 'About'],
  ['/faq', 'FAQ'],
  ['/contact', 'Contact'],
] as const;

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  return (
    <nav className={`mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6 ${dark ? '' : 'border-b border-ink/10'}`}>
      <Logo light={dark} />
      <div className="flex items-center gap-1 sm:gap-2">
        <div className="hidden items-center gap-1 md:flex">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={`rounded-full px-3 py-2 text-sm ${dark ? 'text-ivory/75 hover:text-ivory' : 'text-ink-3 hover:text-ink'}`}>{label}</Link>
          ))}
        </div>
        <Link href="/login" className={`btn ${dark ? 'text-ivory/90 hover:text-ivory' : 'text-ink-2 hover:text-ink'}`}>Sign in</Link>
        <Link href="/register" className="btn-gold">Get started</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink text-sm text-ivory/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo light />
          <p className="max-w-xs text-ivory/50">Amazon &amp; Flipkart marketplace management for Indian sellers.</p>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ivory/40">Company</p>
          <ul className="space-y-2">
            <li><Link className="hover:text-ivory" href="/about">About us</Link></li>
            <li><Link className="hover:text-ivory" href="/services">Services</Link></li>
            <li><Link className="hover:text-ivory" href="/#pricing">Pricing</Link></li>
            <li><Link className="hover:text-ivory" href="/faq">FAQ</Link></li>
            <li><Link className="hover:text-ivory" href="/contact">Contact</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ivory/40">Policies</p>
          <ul className="space-y-2">
            <li><Link className="hover:text-ivory" href="/terms">Terms &amp; Conditions</Link></li>
            <li><Link className="hover:text-ivory" href="/privacy">Privacy Policy</Link></li>
            <li><Link className="hover:text-ivory" href="/refund-policy">Refund &amp; Cancellation</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ivory/40">Contact</p>
          <ul className="space-y-2">
            <li><a className="hover:text-ivory" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
            <li>{CONTACT.city}</li>
            <li className="text-ivory/40">GSTIN {CONTACT.gstin}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ivory/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-ivory/40 sm:px-6">© {new Date().getFullYear()} {CONTACT.legalName} · solluna.co.in · Amazon and Flipkart are trademarks of their respective owners; SOLLUNA is an independent service provider.</p>
      </div>
    </footer>
  );
}

/** Shell for content pages: light header, title band, prose body, footer. */
export function PageShell({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-white"><SiteHeader /></header>
      <section className="bg-ivory-2">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          {eyebrow && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-sun-3">{eyebrow}</p>}
          <h1 className="max-w-3xl font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
          {intro && <p className="mt-4 max-w-2xl text-lg text-ink-3">{intro}</p>}
        </div>
      </section>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose-solluna max-w-3xl space-y-5 text-[15px] leading-7 text-ink-2">{children}</div>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-4 font-display text-2xl text-ink">{children}</h2>;
}
