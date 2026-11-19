'use client';
import { useState } from 'react';

/** Step screenshot (public/guides/<marketplace>-<step>.png); hidden until the image exists. */
export function GuideShots({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="w-full rounded-xl border border-ink/10" loading="lazy" onError={() => setOk(false)} />;
}
