import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { countdownText, countdownShort } from '../utils/format.js';

/**
 * Live ETTR countdown.
 *
 * The target (`ettrAt`) and the reference clock both come from the server —
 * `serverNow()` applies the measured offset between the server and this
 * browser — so a wrong local clock cannot change whether a ticket reads as
 * overdue. A resolved/closed ticket freezes at its resolution time.
 */
export default function Countdown({ ettrAt, frozen = false, frozenAt = null, short = false }) {
  const { serverNow } = useAuth();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (frozen) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [frozen]);

  if (!ettrAt) return <span className="muted">—</span>;

  const reference = frozen && frozenAt ? new Date(frozenAt) : serverNow();
  const ms = new Date(ettrAt).getTime() - reference.getTime();

  const tone = frozen
    ? 'frozen'
    : ms < 0
      ? 'overdue'
      : ms < 30 * 60 * 1000
        ? 'soon'
        : 'ok';

  return (
    <span className={`countdown countdown--${tone}`} title={frozen ? 'Countdown stopped at resolution' : undefined}>
      {short ? countdownShort(ms) : countdownText(ms)}
    </span>
  );
}
