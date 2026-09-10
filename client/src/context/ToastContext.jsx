import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = { success: '✓', error: '✕', warning: '!', info: 'i' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type, title, message, duration = 4500) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, type, title, message }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message, 7000),
      warning: (title, message) => push('warning', title, message, 6000),
      info: (title, message) => push('info', title, message),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            <span className={`badge badge--${badgeTone(toast.type)}`}>{ICONS[toast.type]}</span>
            <div className="toast__body">
              <div className="toast__title">{toast.title}</div>
              {toast.message ? <div className="toast__msg">{toast.message}</div> : null}
            </div>
            <button className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function badgeTone(type) {
  if (type === 'success') return 'ok';
  if (type === 'error') return 'danger';
  if (type === 'warning') return 'warn';
  return 'info';
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
