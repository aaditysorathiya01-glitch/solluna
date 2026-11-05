/** Renders the orchestrator's client-update format (**Label:** lines and "- " bullets) safely, without HTML injection. */
export function Markdownish({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        const bullet = line.startsWith('- ');
        const content = bullet ? line.slice(2) : line;
        const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={j} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
        );
        return bullet ? <div key={i} className="flex gap-2 pl-2 text-ink-2"><span className="text-sun">•</span><span>{parts}</span></div> : <div key={i}>{parts}</div>;
      })}
    </div>
  );
}
