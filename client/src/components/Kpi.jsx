import CountUp from './CountUp.jsx';

/** One summary tile: icon, label, a single-line value and a short hint. */
export default function Kpi({ icon: Icon, tone, label, value, prefix, hint, title, active = false, onClick }) {
  const body = (
    <>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        <span className={`kpi__icon kpi__icon--${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
      </div>
      <div className="kpi__value" title={title}>
        {prefix ? <span className="kpi__prefix">{prefix}</span> : null}
        <CountUp value={value} />
      </div>
      <div className="kpi__hint">{hint}</div>
    </>
  );
  const className = `kpi kpi--${tone}${active ? ' is-active' : ''}${onClick ? ' kpi--clickable' : ''}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={active}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  );
}
