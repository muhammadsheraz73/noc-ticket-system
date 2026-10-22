import { useEffect, useRef, useState } from 'react';

/** "PKR 12,500.00" → prefix "PKR ", number 12500, 2 decimals, suffix "". */
const NUMERIC = /^(\D*?)(-?[\d,]*\d(?:\.\d+)?)(\D*)$/;

function parse(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { prefix: '', number: value, decimals: Number.isInteger(value) ? 0 : 2, suffix: '' };
  }
  if (typeof value !== 'string') return null;
  const match = value.match(NUMERIC);
  if (!match) return null;
  const digits = match[2].replace(/,/g, '');
  return {
    prefix: match[1],
    number: Number(digits),
    decimals: digits.includes('.') ? digits.split('.')[1].length : 0,
    suffix: match[3],
  };
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Rolls a number (or a formatted number string) up to its value; anything else renders as-is. */
export default function CountUp({ value, duration = 900 }) {
  const parsed = parse(value);
  const target = parsed?.number;
  const [shown, setShown] = useState(parsed && !reducedMotion() ? 0 : target);
  const fromRef = useRef(0);

  useEffect(() => {
    if (target === undefined || Number.isNaN(target)) return undefined;
    if (reducedMotion()) {
      setShown(target);
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const current = from + (target - from) * eased;
      setShown(current);
      fromRef.current = current;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  if (!parsed || Number.isNaN(target)) return value ?? null;

  const text = Number(shown ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
  });
  return `${parsed.prefix}${text}${parsed.suffix}`;
}
