import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { countdownText } from '../utils/format.js';

/**
 * Renders the standardized ticket text.
 *
 * The text itself is produced by the server. Only the `Time Left:` line is
 * re-rendered here each second so the operator sees a live countdown — every
 * other character is exactly what the server generated.
 */
export default function TicketPreview({ text, ettrAt, frozen, frozenAt, live = true }) {
  const { serverNow } = useAuth();
  const [tick, setTick] = useState(0);

  const ticking = live && Boolean(ettrAt) && !frozen;

  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const rendered = useMemo(() => {
    if (!text) return '';
    if (!live || !ettrAt) return text;

    const reference = frozen && frozenAt ? new Date(frozenAt) : serverNow();
    const ms = new Date(ettrAt).getTime() - reference.getTime();

    return text.replace(/^Time Left: \*.*\*$/m, `Time Left: *${countdownText(ms)}*`);
    // `tick` drives the once-a-second refresh of the countdown line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ettrAt, frozen, frozenAt, live, serverNow, tick]);

  if (!rendered) return null;

  return (
    <div className="ticket-preview">
      {rendered.split('\n').map((line, index) => (
        <div key={index}>{decorate(line)}</div>
      ))}
    </div>
  );
}

/** Render the `*bold*` markers of the ticket format as actual emphasis. */
function decorate(line) {
  if (/^-{5,}$/.test(line)) return <span className="ticket-preview__sep">{line}</span>;

  const parts = line.split(/(\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <span key={index} className="ticket-preview__bold">
          {part.slice(1, -1)}
        </span>
      );
    }
    const [, label, rest] = part.match(/^([A-Za-z #|]+:)([\s\S]*)$/) || [];
    if (label) {
      return (
        <span key={index}>
          <span className="ticket-preview__label">{label}</span>
          {rest}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

/** Copy-to-clipboard button used next to the preview. */
export function CopyTicketButton({ text, onCopied }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.(true);
    } catch {
      // Clipboard API needs a secure context; fall back to a temporary textarea.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      onCopied?.(ok);
    }
  };

  return (
    <button className="btn btn--secondary btn--sm" onClick={copy} disabled={!text}>
      📋 Copy ticket
    </button>
  );
}
