import { useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, DefItem, Field, TextInput } from '../components/ui.jsx';
import { ROLE_LABELS, formatDateTime } from '../utils/format.js';

export default function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [ai, setAi] = useState(null);
  const [health, setHealth] = useState(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/meta').then(({ data }) => setMeta(data)).catch(() => {});
    api.get('/ai/status').then(({ data }) => setAi(data)).catch(() => {});
    api.get('/health').then(({ data }) => setHealth(data)).catch(() => {});
  }, []);

  const changePassword = async (event) => {
    event.preventDefault();
    setErrors({});

    if (next !== confirm) {
      setErrors({ confirm: 'The two passwords do not match' });
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated', 'Use the new password next time you sign in.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not change the password', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Settings" subtitle="Your account, and how this system is configured." />

      <div className="grid grid--2">
        <div className="card">
          <div className="card__head"><h2>My account</h2></div>
          <div className="card__body">
            <div className="deflist">
              <DefItem label="Name" value={user.name} />
              <DefItem label="Email" value={user.email} mono />
              <DefItem label="Role"><Badge tone="info">{ROLE_LABELS[user.role]}</Badge></DefItem>
              <DefItem label="Phone" value={user.phone} />
              <DefItem label="Last sign-in" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'first session'} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2>Change password</h2></div>
          <div className="card__body">
            <form onSubmit={changePassword}>
              <Field label="Current password" required error={errors.currentPassword}>
                <TextInput type="password" value={current} autoComplete="current-password" required
                  onChange={(event) => setCurrent(event.target.value)} error={errors.currentPassword} />
              </Field>
              <Field label="New password" required error={errors.newPassword} hint="At least 8 characters.">
                <TextInput type="password" value={next} autoComplete="new-password" required minLength={8}
                  onChange={(event) => setNext(event.target.value)} error={errors.newPassword} />
              </Field>
              <Field label="Confirm new password" required error={errors.confirm}>
                <TextInput type="password" value={confirm} autoComplete="new-password" required
                  onChange={(event) => setConfirm(event.target.value)} error={errors.confirm} />
              </Field>
              <button className="btn" type="submit" disabled={busy || !current || !next}>
                {busy ? <span className="spinner" /> : null} Update password
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2>System configuration</h2></div>
          <div className="card__body">
            <div className="deflist">
              <DefItem label="API status">
                <Badge tone={health ? 'ok' : 'danger'}>{health ? 'Online' : 'Unreachable'}</Badge>
              </DefItem>
              <DefItem label="Version" value={health?.version} />
              <DefItem label="Operational timezone" value={meta?.timezone} />
              <DefItem label="Server time" value={meta ? formatDateTime(meta.serverTime) : ''} />
              <DefItem label="Invoice currency" value={meta?.currency} />
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              Ticket times, ETTR and Time Left are all calculated in the operational timezone using server time.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2>AI assistant</h2>
            <div className="card__head-actions">
              <Badge tone={ai?.available ? 'ok' : 'neutral'}>{ai?.status ?? '…'}</Badge>
            </div>
          </div>
          <div className="card__body">
            {ai?.available ? (
              <>
                <Alert tone="ok" title="AI is configured">Model: {ai.model}</Alert>
                <div className="small muted">
                  AI suggests an issue category, priority, summary, troubleshooting steps and a customer response.
                  It never blocks ticket creation and every suggestion can be overridden.
                </div>
              </>
            ) : (
              <>
                <Alert tone="info" title="AI is not active">{ai?.reason || 'Checking…'}</Alert>
                <div className="small muted">
                  Set <code>ANTHROPIC_API_KEY</code> in <code>server/.env</code> and restart the API to enable it.
                  The key stays on the server and is never sent to the browser.
                </div>
              </>
            )}
          </div>
        </div>

        {isAdmin && meta ? (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card__head"><h2>Issue types</h2></div>
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Default ETTR</th><th>Description</th><th>Status</th></tr></thead>
                  <tbody>
                    {meta.issueTypes.map((type) => (
                      <tr key={type._id}>
                        <td className="strong">{type.name}</td>
                        <td className="num">{type.defaultEttrMinutes} min</td>
                        <td className="small">{type.description || '—'}</td>
                        <td><Badge tone={type.isActive ? 'ok' : 'neutral'}>{type.isActive ? 'Active' : 'Inactive'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
