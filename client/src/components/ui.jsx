import { useEffect, useRef } from 'react';

/* --------------------------------------------------------------- badges */
export function Badge({ tone = 'neutral', dot = false, children }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot ? <span className="badge__dot" /> : null}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- states */
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <span className="spinner spinner--dark spinner--lg" />
      <span>{label}</span>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <table className="table">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((__, c) => (
              <td key={c}>
                <div className="skeleton" style={{ width: c === 0 ? '60%' : '85%' }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EmptyState({ icon = '📭', title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {message ? <div>{message}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }) {
  return (
    <div className={`alert alert--${tone}`}>
      {title ? <strong>{title}</strong> : null}
      {title && children ? ' — ' : null}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- fields */
export function Field({ label, required, hint, error, htmlFor, children, full }) {
  return (
    <div className={`field${full ? ' form-grid--full' : ''}`}>
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="field__req">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <div className="field__error">{error}</div> : null}
      {!error && hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput({ error, ...props }) {
  return <input className={`input${error ? ' has-error' : ''}`} {...props} />;
}

export function Select({ error, children, ...props }) {
  return (
    <select className={`select${error ? ' has-error' : ''}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ error, ...props }) {
  return <textarea className={`textarea${error ? ' has-error' : ''}`} {...props} />;
}

/* ---------------------------------------------------------------- modals */
export function Modal({ open, title, onClose, children, footer, size = '' }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onMouseDown={(event) => {
        if (event.target === backdropRef.current) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div className={`modal${size ? ` modal--${size}` : ''}`}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Confirmation dialog used before every destructive action. */
export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? undefined : onCancel}
      size="sm"
      footer={
        <>
          <button className="btn btn--secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn btn--${tone}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------ pagination */
export function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.pages <= 1) return null;
  const { page, pages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <div className="pagination">
      <span className="pagination__info">
        Showing {from}–{to} of {total}
      </span>
      <button className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹ Previous
      </button>
      <span className="small muted">
        Page {page} of {pages}
      </span>
      <button className="btn btn--secondary btn--sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next ›
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */
export function Stat({ label, value, hint, tone = '', to, onClick }) {
  const content = (
    <>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </>
  );
  const className = `stat${tone ? ` stat--${tone}` : ''}`;

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }}>
        {content}
      </button>
    );
  }
  if (to) {
    return (
      <a className={className} href={to}>
        {content}
      </a>
    );
  }
  return <div className={className}>{content}</div>;
}

export function DefItem({ label, value, mono, children }) {
  return (
    <div className="deflist__item">
      <div className="deflist__label">{label}</div>
      <div className={`deflist__value${mono ? ' deflist__value--mono' : ''}`}>
        {children ?? (value === '' || value === null || value === undefined ? <span className="muted">—</span> : value)}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`tab${active === tab.key ? ' is-active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? ` (${tab.count})` : ''}
        </button>
      ))}
    </div>
  );
}
