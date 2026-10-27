import { useEffect, useState } from 'react';
import { Alert, Modal } from './ui.jsx';

/**
 * Owner-only: lock or open panel features. Each row is a switch — on means the
 * feature is open, off means locked. Features already locked for the whole
 * client (`inherited`) are shown locked and cannot be opened from here.
 */
function AccessEditor({ modules, inherited, draft, setDraft }) {
  const editable = modules.filter((m) => !inherited.includes(m.key));
  const toggle = (key) => setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  const lockedCount = modules.filter((m) => inherited.includes(m.key) || draft.includes(m.key)).length;

  return (
    <>
      <div className="access-bar">
        <span className="small muted">
          {lockedCount === 0 ? 'Everything is open' : `${lockedCount} of ${modules.length} locked`}
        </span>
        <div className="access-bar__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(editable.map((m) => m.key))}>
            Lock all
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft([])}>
            Open all
          </button>
        </div>
      </div>

      <ul className="access-list">
        {modules.map((m) => {
          const fromClient = inherited.includes(m.key);
          const isLocked = fromClient || draft.includes(m.key);
          return (
            <li key={m.key} className={isLocked ? 'is-locked' : ''}>
              <div className="access-list__text">
                <span className="access-list__label">{isLocked ? '🔒 ' : ''}{m.label}</span>
                <span className="access-list__hint">
                  {fromClient ? 'Locked for the whole client' : m.hint}
                </span>
              </div>
              <label className="switch" title={fromClient ? 'Unlock it on the client’s Feature access tab' : ''}>
                <input
                  type="checkbox"
                  checked={!isLocked}
                  disabled={fromClient}
                  onChange={() => toggle(m.key)}
                  aria-label={`${m.label}: ${isLocked ? 'locked' : 'open'}`}
                />
                <span className="switch__track"><span className="switch__thumb" /></span>
                <span className="switch__text">{isLocked ? 'Locked' : 'Open'}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/** The editor as a dialog — used for one login from the Logins list. */
export default function AccessModal({ open, title, intro, modules, locked = [], inherited = [], onClose, onSave }) {
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(locked.filter((key) => !inherited.includes(key)));
    setError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : null} Save access
          </button>
        </>
      }
    >
      {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
      {intro ? <p className="small muted" style={{ marginTop: 0 }}>{intro}</p> : null}
      <AccessEditor modules={modules} inherited={inherited} draft={draft} setDraft={setDraft} />
    </Modal>
  );
}

/** The editor in place on a page — used for a whole client on its Feature access tab. */
export function AccessPanel({ modules, locked = [], onSave }) {
  const [draft, setDraft] = useState(locked);
  const [saved, setSaved] = useState(locked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = !sameSet(draft, saved);

  useEffect(() => {
    setDraft(locked);
    setSaved(locked);
  }, [locked.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      setSaved(draft);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__body">
        {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
        <AccessEditor modules={modules} inherited={[]} draft={draft} setDraft={setDraft} />
      </div>
      <div className="card__foot access-foot">
        <span className="small muted">{dirty ? 'You have unsaved changes.' : 'Saved. Changes reach the client on their next page change.'}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--secondary" onClick={() => setDraft(saved)} disabled={!dirty || busy}>Undo</button>
          <button className="btn" onClick={save} disabled={!dirty || busy}>
            {busy ? <span className="spinner" /> : null} Save access
          </button>
        </div>
      </div>
    </div>
  );
}
